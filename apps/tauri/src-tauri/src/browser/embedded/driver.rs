//! A bounded CDP-subset endpoint backed by one account's embedded pages. Account actors keep
//! their command/event state machines; unsupported methods fail explicitly. Page reports are
//! reordered into request → response → finished transitions before reaching the reader.
use super::{Host, MAX_BODY, Page, Presentation, Store, expression_source};
use crate::browser::cdp::{Cdp, Frame};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

const INPUT: &str = include_str!("input.js");
const PRESENT: &str = include_str!("present.js");
/// Unconsumed bodies per page; consumers read matching bodies right after their event.
const MAX_BUFFERED: usize = 2 * MAX_BODY;
const MAX_BODIES: usize = 16;
const MAX_REQUESTS: usize = 512;
/// Expire scripts lost to navigation before the reader's own command budget.
const EVAL_BUDGET: Duration = Duration::from_secs(8);
/// A proxied navigation without a document reports a tunnel failure for route failover.
const PROXY_BUDGET: Duration = Duration::from_secs(15);
/// Show the whole page when no challenge can be recognized after the page is ready.
const CHALLENGE_FALLBACK: Duration = Duration::from_secs(12);

/// One account's embedded browser context, owned by a single native actor.
pub struct AccountPages {
    host: Arc<Host>,
    store: Store,
    pub visible: bool,
    presentation: Option<Presentation>,
    seed: Vec<tauri::webview::Cookie<'static>>,
    stop: CancellationToken,
    ended: Arc<AtomicBool>,
    task: Option<tauri::async_runtime::JoinHandle<()>>,
    _lock: std::fs::File,
}
impl AccountPages {
    /// `presentation` makes the first created page the account's user-facing page.
    pub fn open(
        host: Arc<Host>,
        store: Store,
        presentation: Option<Presentation>,
        seed: Vec<tauri::webview::Cookie<'static>>,
    ) -> Result<Self, String> {
        let lock = super::lock(&store)?;
        Ok(Self {
            host,
            store,
            visible: presentation.is_some(),
            presentation,
            seed,
            stop: CancellationToken::new(),
            ended: Arc::default(),
            task: None,
            _lock: lock,
        })
    }
    pub fn connect(&mut self) -> Cdp {
        let (outgoing, commands) = mpsc::channel(32);
        let (frames, incoming) = mpsc::channel(512);
        let (reports, received) = mpsc::channel(512);
        let driver = Driver {
            host: self.host.clone(),
            store: self.store.clone(),
            presentation: self.presentation,
            seed: std::mem::take(&mut self.seed),
            reports,
            frames,
            pages: HashMap::new(),
            agent: None,
            evals: HashMap::new(),
            next_eval: 0,
            presented: None,
            documents: 0,
        };
        let stop = self.stop.clone();
        let ended = self.ended.clone();
        self.task = Some(tauri::async_runtime::spawn(async move {
            driver.run(commands, received, stop).await;
            ended.store(true, Ordering::SeqCst);
        }));
        // Actor cancellation stops operations first; Browser.close still reaches the pages.
        Cdp::over(outgoing, incoming, CancellationToken::new())
    }
    pub fn closed(&self) -> bool {
        self.ended.load(Ordering::SeqCst)
    }
    /// Close every page and wait until the driver released them.
    pub async fn close(&mut self) {
        self.stop.cancel();
        if let Some(task) = self.task.take() {
            let _ = task.await;
        }
    }
}
impl Drop for AccountPages {
    fn drop(&mut self) {
        self.stop.cancel();
    }
}

#[derive(Clone, Copy)]
enum Shape {
    Value,
    Empty,
}
enum Waiter {
    Command(u64, Shape),
    Present,
}
struct Eval {
    label: String,
    waiter: Waiter,
    started: Instant,
}
struct PageState {
    page: Page,
    ready: bool,
    navigated: Option<Instant>,
    /// CSS viewport height of the current document, for native input coordinates.
    viewport: Option<f64>,
    bodies: Bodies,
    requested: HashSet<String>,
}
/// Oldest unconsumed bodies are evicted first; a consumer reads its body after the event.
#[derive(Default)]
struct Bodies {
    values: HashMap<String, String>,
    order: VecDeque<String>,
    buffered: usize,
}
impl Bodies {
    fn store(&mut self, id: String, body: String) -> bool {
        if body.len() > MAX_BUFFERED {
            return false;
        }
        while self.values.len() >= MAX_BODIES || self.buffered + body.len() > MAX_BUFFERED {
            let Some(old) = self.order.pop_front() else {
                break;
            };
            if let Some(old) = self.values.remove(&old) {
                self.buffered -= old.len();
            }
        }
        self.buffered += body.len();
        self.order.push_back(id.clone());
        self.values.insert(id, body);
        true
    }
    fn take(&mut self, id: &str) -> Option<String> {
        let body = self.values.remove(id)?;
        self.buffered -= body.len();
        self.order.retain(|current| current != id);
        Some(body)
    }
}
struct Presented {
    label: String,
    ready: Option<Instant>,
    isolated: bool,
    fallback: bool,
    pending: bool,
}

struct Driver {
    host: Arc<Host>,
    store: Store,
    presentation: Option<Presentation>,
    seed: Vec<tauri::webview::Cookie<'static>>,
    reports: mpsc::Sender<Value>,
    frames: mpsc::Sender<Frame>,
    pages: HashMap<String, PageState>,
    agent: Option<String>,
    evals: HashMap<u64, Eval>,
    next_eval: u64,
    presented: Option<Presented>,
    documents: u64,
}
impl Driver {
    async fn run(
        mut self,
        mut commands: mpsc::Receiver<Value>,
        mut reports: mpsc::Receiver<Value>,
        stop: CancellationToken,
    ) {
        let mut tick = tokio::time::interval(Duration::from_millis(500));
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let reason = loop {
            tokio::select! {
                biased;
                _ = stop.cancelled() => break "账号页面已关闭",
                command = commands.recv() => {
                    let Some(command) = command else { break "账号页面会话已结束" };
                    self.command(command).await;
                }
                report = reports.recv() => {
                    let Some(report) = report else { break "账号页面报告通道已关闭" };
                    self.report(report);
                }
                _ = tick.tick() => self.tick(),
            }
            if self.frames.is_closed() {
                break "账号页面会话已结束";
            }
        };
        for (_, state) in self.pages.drain() {
            self.host.close(&state.page);
        }
        let _ = self.frames.try_send(Err(reason));
    }
    fn send(&self, value: Value) {
        // The reader enforces its own business-event budget; a full transport is a lost page.
        let _ = self.frames.try_send(Ok(value));
    }
    fn reply(&self, id: u64, result: Value) {
        self.send(json!({"id": id, "result": result}));
    }
    /// Native driver errors are fixed product messages and may cross the reader boundary.
    fn fail(&self, id: u64, message: &str) {
        self.send(json!({"id": id, "error": {"message": message, "native": true}}));
    }
    fn event(&self, session: &str, method: &str, params: Value) {
        self.send(json!({"sessionId": session, "method": method, "params": params}));
    }

    async fn command(&mut self, command: Value) {
        let id = command["id"].as_u64().unwrap_or(0);
        let params = &command["params"];
        let session = command["sessionId"].as_str().map(str::to_owned);
        let method = command["method"].as_str().unwrap_or("");
        match method {
            "Target.createTarget" => match self.create(params["newWindow"] == true).await {
                Ok(label) => self.reply(id, json!({"targetId": label})),
                Err(error) => self.fail(id, &error),
            },
            "Target.attachToTarget" => {
                let target = params["targetId"].as_str().unwrap_or("");
                if self.pages.contains_key(target) {
                    self.reply(id, json!({"sessionId": target}));
                } else {
                    self.fail(id, "账号页面已关闭。");
                }
            }
            "Target.closeTarget" => {
                let target = params["targetId"].as_str().unwrap_or("").to_owned();
                self.close(&target);
                self.reply(id, json!({"success": true}));
            }
            "Target.getTargets" => {
                let infos = self
                    .pages
                    .keys()
                    .map(|label| json!({"targetId": label, "type": "page"}))
                    .collect::<Vec<_>>();
                self.reply(id, json!({"targetInfos": infos}));
            }
            // Media playback is disabled by the page bridge; responses are always observed.
            "Network.enable"
            | "Page.enable"
            | "Fetch.enable"
            | "Fetch.failRequest"
            | "Fetch.continueRequest" => self.reply(id, json!({})),
            "Page.navigate" => {
                let url = params["url"].as_str().unwrap_or("");
                let allowed = reqwest::Url::parse(url).is_ok_and(|url| url.scheme() == "https");
                let Some(state) = session.as_deref().and_then(|s| self.pages.get_mut(s)) else {
                    return self.fail(id, "账号页面已关闭。");
                };
                if !allowed {
                    return self.fail(id, "拒绝打开非 HTTPS 页面。");
                }
                match state.page.navigate(url) {
                    Ok(()) => {
                        let label = state.page.label.clone();
                        state.navigated = Some(Instant::now());
                        self.unload(&label);
                        self.reply(id, json!({"frameId": "main"}));
                    }
                    Err(error) => self.fail(id, &error),
                }
            }
            "Runtime.evaluate" => {
                let expression = params["expression"].as_str().unwrap_or("").to_owned();
                self.script(id, session.as_deref(), &expression, Shape::Value);
            }
            "Input.insertText" => {
                let text = params["text"].as_str().unwrap_or("");
                let expression = format!("({}).insert({})", input(), json!(text));
                self.script(id, session.as_deref(), &expression, Shape::Empty);
            }
            "Input.dispatchMouseEvent" => {
                let x = params["x"].as_f64().unwrap_or(-1.0);
                let y = params["y"].as_f64().unwrap_or(-1.0);
                // Official controls may ignore script clicks; prefer browser-trusted input.
                if params["type"] == "mouseReleased"
                    && x >= 0.0
                    && y >= 0.0
                    && let Some((page, viewport)) = session
                        .as_deref()
                        .and_then(|s| self.pages.get(s))
                        .filter(|state| state.ready)
                        .and_then(|state| Some((state.page.clone(), state.viewport?)))
                    && page.click(x, y, viewport).await
                {
                    return self.reply(id, json!({}));
                }
                let expression = match params["type"].as_str() {
                    Some("mouseWheel") => Some(format!(
                        "({}).wheel({x},{y},{})",
                        input(),
                        params["deltaY"].as_f64().unwrap_or(0.0)
                    )),
                    // One page-side click sequence completes on release.
                    Some("mouseReleased") => Some(format!("({}).click({x},{y})", input())),
                    _ => None,
                };
                match expression {
                    Some(expression) if x >= 0.0 && y >= 0.0 => {
                        self.script(id, session.as_deref(), &expression, Shape::Empty)
                    }
                    _ => self.reply(id, json!({})),
                }
            }
            "Storage.getCookies" => {
                let page = session
                    .as_deref()
                    .and_then(|s| self.pages.get(s))
                    .or_else(|| self.pages.values().next())
                    .map(|state| state.page.clone());
                match page {
                    Some(page) => match page.cookies().await {
                        Ok(cookies) => self.reply(id, cookies),
                        Err(error) => self.fail(id, &error),
                    },
                    None => self.fail(id, "账号页面已关闭。"),
                }
            }
            // Known after the first document; callers retry instead of blocking on page loads.
            "Browser.getVersion" => self.reply(id, json!({"userAgent": self.agent})),
            "Browser.close" => {
                let labels = self.pages.keys().cloned().collect::<Vec<_>>();
                for label in labels {
                    self.close(&label);
                }
                self.reply(id, json!({}));
            }
            "Network.getResponseBody" => {
                let request = params["requestId"].as_str().unwrap_or("");
                match session
                    .as_deref()
                    .and_then(|s| self.pages.get_mut(s))
                    .and_then(|state| state.bodies.take(request))
                {
                    Some(body) => self.reply(id, json!({"body": body, "base64Encoded": false})),
                    // Same upstream wording as CDP; the reader maps it to an unavailable body.
                    None => self.send(json!({"id": id, "error": {"message": "No resource with given identifier found"}})),
                }
            }
            _ => self.fail(id, "浏览器不支持当前操作。"),
        }
    }

    async fn create(&mut self, present: bool) -> Result<String, String> {
        if self.pages.len() >= 12 {
            return Err("limit-exceeded:账号页面过多，请关闭旧列表。".into());
        }
        let page = self
            .host
            .open(&self.store, self.reports.clone(), "about:blank")
            .await?;
        if !self.seed.is_empty() {
            // A new persistent context has no cookies; keep stored native credentials.
            let seed = std::mem::take(&mut self.seed);
            let empty = page
                .cookies()
                .await
                .is_ok_and(|cookies| cookies["cookies"].as_array().is_some_and(Vec::is_empty));
            if empty {
                page.set_cookies(seed).await;
            }
        }
        let label = page.label.clone();
        if present && let Some(mode) = self.presentation {
            self.host.present(&self.store.account, &page, mode);
            self.presented = Some(Presented {
                label: label.clone(),
                ready: None,
                isolated: false,
                fallback: false,
                pending: false,
            });
        }
        self.pages.insert(
            label.clone(),
            PageState {
                page,
                ready: false,
                navigated: None,
                viewport: None,
                bodies: Bodies::default(),
                requested: HashSet::new(),
            },
        );
        Ok(label)
    }

    fn close(&mut self, label: &str) {
        let Some(state) = self.pages.remove(label) else {
            return;
        };
        self.host.close(&state.page);
        self.settle(label);
        if self.presented.as_ref().is_some_and(|p| p.label == label) {
            self.presented = None;
        }
        self.event(
            label,
            "Target.detachedFromTarget",
            json!({"sessionId": label}),
        );
    }

    /// A document change destroys its scripts; resolve them like an empty result.
    fn unload(&mut self, label: &str) {
        self.settle(label);
        if let Some(state) = self.pages.get_mut(label) {
            state.ready = false;
            state.viewport = None;
            let aborted = state.requested.drain().collect::<Vec<_>>();
            for request in aborted {
                self.event(
                    label,
                    "Network.loadingFailed",
                    json!({"requestId": request, "errorText": "net::ERR_ABORTED"}),
                );
            }
        }
        if let Some(presented) = self.presented.as_mut().filter(|p| p.label == label) {
            presented.ready = None;
        }
    }
    fn settle(&mut self, label: &str) {
        let ids = self
            .evals
            .iter()
            .filter(|(_, eval)| eval.label == label)
            .map(|(id, _)| *id)
            .collect::<Vec<_>>();
        for id in ids {
            let eval = self.evals.remove(&id).unwrap();
            self.resolve(eval.waiter, None);
        }
    }

    fn script(&mut self, id: u64, session: Option<&str>, expression: &str, shape: Shape) {
        let Some(state) = session.and_then(|s| self.pages.get(s)) else {
            return self.fail(id, "账号页面已关闭。");
        };
        // A document still loading has no bridge yet. Report "not ready" instead of waiting.
        if !state.ready {
            return self.resolve(Waiter::Command(id, shape), None);
        }
        let page = state.page.clone();
        self.start(&page, expression, Waiter::Command(id, shape));
    }
    fn start(&mut self, page: &Page, expression: &str, waiter: Waiter) {
        self.next_eval += 1;
        let eval = self.next_eval;
        match page.evaluate(eval, expression) {
            Ok(()) => {
                self.evals.insert(
                    eval,
                    Eval {
                        label: page.label.clone(),
                        waiter,
                        started: Instant::now(),
                    },
                );
            }
            Err(error) => match waiter {
                Waiter::Command(id, _) => self.fail(id, &error),
                Waiter::Present => self.present_result(None),
            },
        }
    }
    /// `None` settles a script without a value; `Some(Err)` carries a page exception.
    fn resolve(&mut self, waiter: Waiter, outcome: Option<Result<Value, String>>) {
        match waiter {
            Waiter::Command(id, Shape::Empty) => self.reply(id, json!({})),
            Waiter::Command(id, Shape::Value) => match outcome {
                Some(Err(error)) => self.reply(
                    id,
                    json!({"result": {"type": "object"}, "exceptionDetails": {"text": error}}),
                ),
                Some(Ok(value)) => self.reply(id, json!({"result": {"value": value}})),
                None => self.reply(id, json!({"result": {"value": null}})),
            },
            Waiter::Present => self.present_result(outcome.and_then(Result::ok)),
        }
    }

    fn report(&mut self, report: Value) {
        let label = report["label"].as_str().unwrap_or("").to_owned();
        if !self.pages.contains_key(&label) {
            return;
        }
        let id = report["requestId"].as_str().unwrap_or("").to_owned();
        match report["kind"].as_str() {
            Some("navigation") => self.unload(&label),
            Some("hello") => {
                let state = self.pages.get_mut(&label).unwrap();
                state.ready = true;
                state.navigated = None;
                if self.agent.is_none()
                    && let Some(agent) = report["userAgent"].as_str()
                {
                    self.agent = Some(agent.to_owned());
                }
                if let Some(presented) = self.presented.as_mut().filter(|p| p.label == label) {
                    presented.ready.get_or_insert_with(Instant::now);
                }
            }
            Some("viewport") => {
                let height = report["height"]
                    .as_f64()
                    .filter(|h| h.is_finite() && *h > 0.0);
                self.pages.get_mut(&label).unwrap().viewport = height;
            }
            Some("request") if !id.is_empty() => self.request(&label, &id, &report),
            Some("exchange") if !id.is_empty() => {
                self.request(&label, &id, &report);
                let state = self.pages.get_mut(&label).unwrap();
                if !state.requested.remove(&id) {
                    return;
                }
                let status = report["status"].as_u64().unwrap_or(0);
                self.event(
                    &label,
                    "Network.responseReceived",
                    json!({"requestId": id, "type": report["type"], "frameId": "main",
                        "response": {"url": report["responseUrl"], "status": status}}),
                );
                self.finish(&label, &id, &report);
            }
            Some("failed") if !id.is_empty() => {
                let state = self.pages.get_mut(&label).unwrap();
                if state.requested.remove(&id) {
                    self.event(
                        &label,
                        "Network.loadingFailed",
                        json!({"requestId": id, "errorText": report["error"]}),
                    );
                }
            }
            Some("document") => {
                self.documents += 1;
                let id = format!("document-{}", self.documents);
                self.event(
                    &label,
                    "Network.responseReceived",
                    json!({"requestId": id, "type": "Document", "frameId": "main",
                        "response": {"url": report["url"], "status": report["status"]}}),
                );
                self.finish(&label, &id, &report);
            }
            Some("eval") => {
                let Some(eval) = report["id"]
                    .as_u64()
                    .and_then(|eval| self.evals.remove(&eval))
                else {
                    return;
                };
                if eval.label != label {
                    return;
                }
                let outcome = if report["ok"] == true {
                    Ok(report["value"].clone())
                } else {
                    Err(report["error"]
                        .as_str()
                        .unwrap_or("页面脚本异常")
                        .to_owned())
                };
                self.resolve(eval.waiter, Some(outcome));
            }
            _ => {}
        }
    }
    /// Emit each request once, also when its completion arrives first over async IPC.
    fn request(&mut self, label: &str, id: &str, report: &Value) {
        let state = self.pages.get_mut(label).unwrap();
        if state.requested.contains(id) || state.requested.len() >= MAX_REQUESTS {
            return;
        }
        state.requested.insert(id.to_owned());
        self.event(
            label,
            "Network.requestWillBeSent",
            json!({"requestId": id, "type": report["type"],
                "request": {"url": report["url"], "method": report["method"], "postData": report["postData"]}}),
        );
    }
    fn finish(&mut self, label: &str, id: &str, report: &Value) {
        let state = self.pages.get_mut(label).unwrap();
        let length = match (report["bodyState"].as_str(), report["body"].as_str()) {
            (Some("ok"), Some(body)) if state.bodies.store(id.to_owned(), body.to_owned()) => {
                body.len()
            }
            // Readers reject the declared size before asking for a body.
            (Some("ok" | "too-large"), _) => MAX_BODY + 1,
            _ => {
                return self.event(
                    label,
                    "Network.loadingFailed",
                    json!({"requestId": id, "errorText": "net::ERR_FAILED"}),
                );
            }
        };
        self.event(
            label,
            "Network.loadingFinished",
            json!({"requestId": id, "encodedDataLength": length}),
        );
    }

    fn tick(&mut self) {
        let expired = self
            .evals
            .iter()
            .filter(|(_, eval)| eval.started.elapsed() >= EVAL_BUDGET)
            .map(|(id, _)| *id)
            .collect::<Vec<_>>();
        for id in expired {
            let eval = self.evals.remove(&id).unwrap();
            self.resolve(eval.waiter, None);
        }
        if self.store.proxy.is_some() {
            let stalled = self
                .pages
                .iter_mut()
                .filter(|(_, state)| {
                    state
                        .navigated
                        .is_some_and(|at| at.elapsed() >= PROXY_BUDGET)
                })
                .map(|(label, state)| {
                    state.navigated = None;
                    label.clone()
                })
                .collect::<Vec<_>>();
            for label in stalled {
                self.event(
                    &label,
                    "Network.loadingFailed",
                    json!({"requestId": "navigation", "errorText": "net::ERR_PROXY_CONNECTION_FAILED"}),
                );
            }
        }
        let Some(presented) = &mut self.presented else {
            return;
        };
        if self.presentation != Some(Presentation::Challenge) || presented.pending {
            return;
        }
        let Some(state) = self.pages.get(&presented.label).filter(|s| s.ready) else {
            return;
        };
        presented.pending = true;
        let expression = format!("({})({})", expression_source(PRESENT), !presented.fallback);
        let page = state.page.clone();
        self.start(&page, &expression, Waiter::Present);
    }
    fn present_result(&mut self, value: Option<Value>) {
        let Some(presented) = &mut self.presented else {
            return;
        };
        presented.pending = false;
        let size = value
            .as_ref()
            .and_then(|v| Some((v["width"].as_f64()?, v["height"].as_f64()?)))
            .filter(|(w, h)| w.is_finite() && h.is_finite() && *w > 0.0 && *h > 0.0);
        if presented.fallback {
            return;
        }
        match size {
            Some(size) => {
                presented.isolated = true;
                self.host.reveal(&presented.label, Some(size));
            }
            None if presented.isolated => {
                presented.isolated = false;
                self.host.conceal(&presented.label);
            }
            None if presented
                .ready
                .is_some_and(|at| at.elapsed() >= CHALLENGE_FALLBACK)
                && !self.host.revealed(&presented.label) =>
            {
                // Website changes must not leave the user without a reachable challenge.
                presented.fallback = true;
                self.host.reveal(&presented.label, None);
            }
            None => {}
        }
    }
}

fn input() -> &'static str {
    expression_source(INPUT)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unconsumed_bodies_stay_bounded_and_consumed_bodies_are_released() {
        let mut bodies = Bodies::default();
        for index in 0..40 {
            assert!(bodies.store(format!("r{index}"), "x".repeat(1024)));
        }
        assert_eq!(bodies.values.len(), MAX_BODIES);
        assert!(bodies.take("r0").is_none());
        assert_eq!(bodies.take("r39").unwrap().len(), 1024);
        assert!(bodies.take("r39").is_none());
        assert!(bodies.store("large".into(), "x".repeat(MAX_BUFFERED - 10)));
        assert!(bodies.buffered <= MAX_BUFFERED);
        assert_eq!(bodies.values.len(), 1);
        assert!(!bodies.store("oversized".into(), "x".repeat(MAX_BUFFERED + 1)));
        assert_eq!(bodies.take("large").unwrap().len(), MAX_BUFFERED - 10);
        assert_eq!(bodies.buffered, 0);
    }

    #[test]
    fn page_scripts_are_expressions_without_statement_separators() {
        for script in [INPUT, PRESENT] {
            let expression = expression_source(script);
            assert!(expression.starts_with('(') && !expression.ends_with(';'));
        }
        assert_eq!(
            expression_source("// a\n// b\n;(() => 1)()\n"),
            "(() => 1)()"
        );
    }
}
