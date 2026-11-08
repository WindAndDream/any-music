//! Account-owned CDP sessions. Official pages generate authentication and search requests.
//! Only public login projections and allowlisted business response bodies cross IPC.
mod browser_identity;
pub(crate) mod commands;
mod detail;
mod import;
mod packet;
mod profile;
pub(crate) mod projection;
mod search;
pub(crate) mod verification;
use crate::{browser::cdp::Cdp, browser::process::AccountProcess, state::RuntimeState};
use packet::Packet;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::sync::{mpsc, oneshot};
use tokio_util::sync::CancellationToken;

type Reply = oneshot::Sender<Result<Value, String>>;
enum Action {
    Sms(Option<String>, CancellationToken, Reply),
    Profile(CancellationToken, Reply),
    SearchFailure(String, String, Reply),
    RefreshCredentials(Reply),
    Search(
        search::Request,
        CancellationToken,
        oneshot::Sender<Result<Packet, String>>,
    ),
    Detail(
        detail::Request,
        CancellationToken,
        oneshot::Sender<Result<Packet, String>>,
    ),
    Close(String),
}
#[derive(Default)]
struct PrivateState {
    login: Value,
    cookies: Value,
    agent: String,
    profile: Value,
    profile_error: Option<String>,
    verification_id: Option<String>,
    verification_response: Option<Value>,
    failure: Option<String>,
    page_ready: bool,
    shutdown_failure: Option<String>,
}
struct Run {
    cancel: CancellationToken,
    public: Arc<Mutex<PrivateState>>,
    actions: mpsc::Sender<Action>,
    task: tauri::async_runtime::JoinHandle<()>,
}
#[derive(Default)]
pub struct Manager {
    runs: Mutex<HashMap<String, Run>>,
    queries: Mutex<HashMap<String, String>>,
    handoffs: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
}
impl Manager {
    pub(crate) async fn handoff(&self, id: &str) -> tokio::sync::OwnedMutexGuard<()> {
        let lock = self
            .handoffs
            .lock()
            .unwrap()
            .entry(id.into())
            .or_default()
            .clone();
        lock.lock_owned().await
    }
    /// Called under the same browser lifecycle lock as account mutations.
    pub fn ensure(
        &self,
        state: &RuntimeState,
        id: &str,
        browser: Option<&str>,
    ) -> Result<(), String> {
        self.launch(state, id, browser, None).map(|_| ())
    }
    fn launch(
        &self,
        state: &RuntimeState,
        id: &str,
        browser: Option<&str>,
        verification: Option<(String, String)>,
    ) -> Result<bool, String> {
        let account = state.account(id)?;
        let usage = state.use_account(id, "账号浏览器")?;
        if !cfg!(desktop) {
            return Err("此设备不支持系统浏览器账号会话。".into());
        }
        if account.platform_id != "douyin" || !account.enabled {
            return Err("抖音账号不可用。".into());
        }
        let mut runs = self.runs.lock().unwrap();
        if let Some(run) = runs.get(id) {
            if !run.cancel.is_cancelled() {
                return Ok(false);
            }
            return Err("旧账号浏览器正在退出，请稍后重试。".into());
        }
        let (kind, path) = browser_identity::resolve(
            &state.directory.join("profiles"),
            id,
            browser,
            &account.user_agent,
        )?;
        let mut routes = state.proxy_routes(&account)?;
        let active = state.active_proxy(&account);
        let start = routes.iter().position(|(id, _)| *id == active).unwrap_or(0);
        routes.rotate_left(start);
        let profile_root = state.directory.join("profiles");
        let visible = browser.is_some() || verification.is_some();
        let process =
            AccountProcess::start(&profile_root, id, &path, routes[0].1.as_deref(), visible)?;
        process.remember_browser(&kind)?;
        let cancel = CancellationToken::new();
        let public = Arc::new(Mutex::new(PrivateState {
            login: json!({"status":"waiting","keepPolling":true,"message":"正在加载官方登录页面…"}),
            verification_id: verification.as_ref().map(|(id, _)| id.clone()),
            ..Default::default()
        }));
        let (actions, receiver) = mpsc::channel(16);
        let stopped = cancel.clone();
        let data = public.clone();
        let start_query = verification
            .map(|(_, query)| query)
            .or_else(|| browser.and_then(|_| self.queries.lock().unwrap().get(id).cloned()));
        let active_proxies = state.active_proxies.clone();
        let account_id = id.to_owned();
        let task = tauri::async_runtime::spawn(async move {
            let _usage = usage;
            let mut receiver = receiver;
            let mut process = Some(process);
            let mut failure = None;
            for (index, (proxy_id, proxy_url)) in routes.iter().enumerate() {
                if stopped.is_cancelled() {
                    break;
                }
                let current = if let Some(process) = process.take() {
                    Ok(process)
                } else {
                    AccountProcess::start(
                        &profile_root,
                        &account_id,
                        &path,
                        proxy_url.as_deref(),
                        visible,
                    )
                };
                let result = match current {
                    Ok(process) => {
                        if let Some(proxy_id) = proxy_id {
                            active_proxies
                                .lock()
                                .unwrap()
                                .insert(account_id.clone(), proxy_id.clone());
                        }
                        worker(process, &stopped, &data, &mut receiver, start_query.clone()).await
                    }
                    Err(error) => Err(error),
                };
                match result {
                    Err(error)
                        if index + 1 < routes.len()
                            && !stopped.is_cancelled()
                            && crate::network::proxy_routing::is_browser_proxy_failure(&error) =>
                    {
                        let mut public = data.lock().unwrap();
                        let verification_id = public.verification_id.clone();
                        *public = PrivateState {
                            verification_id,
                            login: json!({"status":"waiting","keepPolling":true,"message":"主连接不可用，正在尝试备用代理…"}),
                            ..Default::default()
                        };
                    }
                    Err(error) => {
                        failure = Some(error);
                        break;
                    }
                    Ok(()) => break,
                }
            }
            if let Some(error) = failure {
                active_proxies.lock().unwrap().remove(&account_id);
                let mut data = data.lock().unwrap();
                data.login = json!({"status":"blocked","message":error});
                data.failure = Some(error);
            }
            stopped.cancel();
        });
        runs.insert(
            id.into(),
            Run {
                cancel,
                public,
                actions,
                task,
            },
        );
        Ok(true)
    }
    pub async fn stop(&self, id: &str) -> Result<(), String> {
        let run = self.runs.lock().unwrap().remove(id);
        if let Some(run) = run {
            run.cancel.cancel();
            run.task
                .await
                .map_err(|_| "network-error:账号浏览器退出任务中断。".to_string())?;
            let failure = run.public.lock().unwrap().shutdown_failure.clone();
            if let Some(error) = failure {
                return Err(error);
            }
        }
        Ok(())
    }
    pub fn cancel(&self, id: &str) {
        if let Some(run) = self.runs.lock().unwrap().get(id) {
            run.cancel.cancel();
        }
    }
    pub fn forget(&self, id: &str) {
        self.queries.lock().unwrap().remove(id);
        self.handoffs.lock().unwrap().remove(id);
    }
    pub async fn reap(&self, id: &str) -> Result<(), String> {
        let cancelled = self
            .runs
            .lock()
            .unwrap()
            .get(id)
            .is_some_and(|r| r.cancel.is_cancelled());
        if cancelled {
            self.stop(id).await?;
        }
        Ok(())
    }
    pub async fn shutdown(&self) {
        let ids = self
            .runs
            .lock()
            .unwrap()
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        for id in ids {
            let _ = self.stop(&id).await;
        }
    }
    pub fn status(&self, id: &str) -> Result<Value, String> {
        let runs = self.runs.lock().unwrap();
        let run = runs.get(id).ok_or("账号浏览器会话已结束，请重新登录。")?;
        let value = run.public.lock().unwrap().login.clone();
        Ok(value)
    }
    pub fn credentials(&self, id: &str) -> Result<(Value, String), String> {
        let runs = self.runs.lock().unwrap();
        let run = runs
            .get(id)
            .filter(|r| !r.cancel.is_cancelled())
            .ok_or("账号会话已取消。")?;
        let data = run.public.lock().unwrap();
        if data.login["status"] != "signed-in" {
            return Err("官方账号登录尚未确认。".into());
        }
        Ok((data.cookies.clone(), data.agent.clone()))
    }
    pub fn user_id(&self, id: &str) -> Result<String, String> {
        let runs = self.runs.lock().unwrap();
        let run = runs
            .get(id)
            .filter(|run| !run.cancel.is_cancelled())
            .ok_or("账号会话已取消。")?;
        let data = run.public.lock().unwrap();
        if !projection::authenticated_profile(&data.profile) {
            return Err("平台账号身份尚未确认。".into());
        }
        data.profile["user"]["uid"]
            .as_str()
            .map(str::to_owned)
            .or_else(|| {
                data.profile["user"]["uid"]
                    .as_u64()
                    .map(|id| id.to_string())
            })
            .ok_or_else(|| "invalid-response:平台未返回用户 ID。".into())
    }
    fn needs_profile_refresh(&self, id: &str) -> bool {
        self.runs.lock().unwrap().get(id).is_some_and(|run| {
            run.public
                .lock()
                .unwrap()
                .profile_error
                .as_ref()
                .is_some_and(|error| {
                    !error.starts_with("not-authenticated:")
                        && !error.starts_with("verification-required:")
                })
        })
    }
    pub async fn refresh_credentials(&self, id: &str) -> Result<(), String> {
        let cancel = CancellationToken::new();
        self.ready_page(id, &cancel).await?;
        self.action(id, Action::RefreshCredentials, &cancel).await?;
        Ok(())
    }
    async fn ready_page(&self, id: &str, cancel: &CancellationToken) -> Result<(), String> {
        let work = async {
            loop {
                {
                    let runs = self.runs.lock().unwrap();
                    let run = runs
                        .get(id)
                        .ok_or("operation-cancelled:账号浏览器会话已结束。")?;
                    let data = run.public.lock().unwrap();
                    if let Some(error) = &data.failure {
                        return Err(error.clone());
                    }
                    if run.cancel.is_cancelled() {
                        return Err("operation-cancelled:账号浏览器会话已结束。".into());
                    }
                    if data.page_ready {
                        return Ok(());
                    }
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        };
        tokio::select! { _=cancel.cancelled()=>Err("operation-cancelled:账号浏览器启动已取消。".into()), result=tokio::time::timeout(Duration::from_secs(30),work)=>result.map_err(|_| "request-timeout:账号验证页面启动超时。".to_string()).and_then(|v|v) }
    }
    async fn ready(&self, id: &str, cancel: &CancellationToken) -> Result<(), String> {
        let wait = async {
            loop {
                let failure = self
                    .runs
                    .lock()
                    .unwrap()
                    .get(id)
                    .and_then(|run| run.public.lock().unwrap().failure.clone());
                if let Some(error) = failure {
                    return Err(error);
                }
                {
                    let runs = self.runs.lock().unwrap();
                    if let Some(run) = runs.get(id) {
                        let data = run.public.lock().unwrap();
                        if let Some(error) = &data.profile_error {
                            return Err(error.clone());
                        }
                    }
                }
                let status = self.status(id)?;
                match status["status"].as_str() {
                    Some("signed-in") => return Ok(()),
                    Some("expired") => {
                        return Err(
                            "verification-required:登录二维码已过期，请重新生成或打开官方浏览器。"
                                .into(),
                        );
                    }
                    Some("blocked" | "verification-required") => {
                        return Err("verification-required:请完成此账号的官方登录验证。".into());
                    }
                    _ => tokio::time::sleep(Duration::from_millis(100)).await,
                }
            }
        };
        tokio::select! { _=cancel.cancelled()=>Err("operation-cancelled:请求已取消。".into()), result=tokio::time::timeout(Duration::from_secs(20),wait)=>result.map_err(|_|"request-timeout:无法确认此抖音账号的登录状态，请重试。".to_string()).and_then(|v|v) }
    }
    async fn profile(
        &self,
        id: &str,
        cancel: &CancellationToken,
        started: bool,
    ) -> Result<Value, String> {
        if cancel.is_cancelled() {
            return Err("operation-cancelled:请求已取消。".into());
        }
        if started {
            self.ready(id, cancel).await?;
        } else {
            // A fresh explicit probe must be able to recover a previous rejection/challenge.
            self.ready_page(id, cancel).await?;
        }
        // Only the request that started this browser may consume its fresh bootstrap
        // response. Later explicit checks use a fresh auxiliary page to detect logout/expiry.
        if started {
            if cancel.is_cancelled() {
                return Err("operation-cancelled:请求已取消。".into());
            }
            let runs = self.runs.lock().unwrap();
            let run = runs
                .get(id)
                .filter(|run| !run.cancel.is_cancelled())
                .ok_or("operation-cancelled:账号浏览器会话已结束。")?;
            let data = run.public.lock().unwrap();
            if projection::authenticated_profile(&data.profile) {
                return Ok(json!({"status":200,"body":serde_json::to_vec(&data.profile).unwrap()}));
            }
        }
        let token = cancel.clone();
        self.action(id, |reply| Action::Profile(token, reply), cancel)
            .await
    }
    async fn action(
        &self,
        id: &str,
        build: impl FnOnce(Reply) -> Action,
        cancel: &CancellationToken,
    ) -> Result<Value, String> {
        let (sender, stop) = {
            let runs = self.runs.lock().unwrap();
            let run = runs
                .get(id)
                .filter(|r| !r.cancel.is_cancelled())
                .ok_or("operation-cancelled:账号浏览器已关闭，请重新打开。")?;
            (run.actions.clone(), run.cancel.clone())
        };
        let (reply, answer) = oneshot::channel();
        sender
            .try_send(build(reply))
            .map_err(|_| "limit-exceeded:账号操作队列已满。")?;
        tokio::select! {_=cancel.cancelled()=>Err("operation-cancelled:请求已取消。".into()),_=stop.cancelled()=>Err("operation-cancelled:账号浏览器已结束。".into()),result=tokio::time::timeout(Duration::from_secs(22),answer)=>result.map_err(|_|"request-timeout:账号页面操作超时。".to_string()).and_then(|r|r.map_err(|_|"network-error:账号浏览器连接中断。".to_string())).and_then(|r|r)}
    }
    pub async fn sms(
        &self,
        id: &str,
        code: Option<String>,
        cancel: &CancellationToken,
    ) -> Result<Value, String> {
        let token = cancel.clone();
        self.action(id, |reply| Action::Sms(code, token, reply), cancel)
            .await
    }
    pub(crate) async fn search(
        &self,
        id: &str,
        request: search::Request,
        cancel: &CancellationToken,
    ) -> Result<Packet, String> {
        for _ in 0..9 {
            let result = self.search_once(id, request.clone(), cancel).await;
            if let Err(error) = &result
                && crate::network::proxy_routing::is_browser_proxy_failure(error)
            {
                self.ready(id, cancel).await?;
                if request.offset > 0 {
                    return Err(
                        "pagination-unavailable:代理已切换，请刷新列表以重新建立分页。".into(),
                    );
                }
                continue;
            }
            return result;
        }
        Err("network-error:主代理与备用代理均不可用。".into())
    }
    async fn search_once(
        &self,
        id: &str,
        request: search::Request,
        cancel: &CancellationToken,
    ) -> Result<Packet, String> {
        self.ready(id, cancel).await?;
        if request.import.is_none() {
            self.queries
                .lock()
                .unwrap()
                .insert(id.into(), request.query.clone());
        }
        let (sender, stop) = {
            let runs = self.runs.lock().unwrap();
            let run = runs
                .get(id)
                .filter(|r| !r.cancel.is_cancelled())
                .ok_or("operation-cancelled:账号浏览器已关闭，请重新打开。")?;
            (run.actions.clone(), run.cancel.clone())
        };
        let (reply, answer) = oneshot::channel();
        sender
            .try_send(Action::Search(request, cancel.clone(), reply))
            .map_err(|_| "limit-exceeded:账号操作队列已满。")?;
        tokio::select! {
            _=cancel.cancelled()=>Err("operation-cancelled:请求已取消。".into()),
            _=stop.cancelled()=>Err("operation-cancelled:账号浏览器已结束。".into()),
            result=tokio::time::timeout(Duration::from_secs(25),answer)=>result
                .map_err(|_|"request-timeout:账号搜索操作超时。".to_string())
                .and_then(|r|r.map_err(|_|"network-error:账号浏览器连接中断。".to_string())).and_then(|r|r)
        }
    }
    async fn detail(
        &self,
        id: &str,
        request: detail::Request,
        cancel: &CancellationToken,
    ) -> Result<Packet, String> {
        for _ in 0..9 {
            let result = self.detail_once(id, request.clone(), cancel).await;
            if let Err(error) = &result
                && crate::network::proxy_routing::is_browser_proxy_failure(error)
            {
                self.ready(id, cancel).await?;
                continue;
            }
            return result;
        }
        Err("network-error:主代理与备用代理均不可用。".into())
    }
    async fn detail_once(
        &self,
        id: &str,
        request: detail::Request,
        cancel: &CancellationToken,
    ) -> Result<Packet, String> {
        self.ready(id, cancel).await?;
        let (sender, stop) = {
            let runs = self.runs.lock().unwrap();
            let run = runs
                .get(id)
                .filter(|run| !run.cancel.is_cancelled())
                .ok_or("operation-cancelled:账号浏览器已关闭。")?;
            (run.actions.clone(), run.cancel.clone())
        };
        let (reply, answer) = oneshot::channel();
        sender
            .try_send(Action::Detail(request, cancel.clone(), reply))
            .map_err(|_| "limit-exceeded:账号操作队列已满。")?;
        tokio::select! {
            _ = cancel.cancelled() => Err("operation-cancelled:作品读取已取消。".into()),
            _ = stop.cancelled() => Err("operation-cancelled:账号浏览器已结束。".into()),
            result = tokio::time::timeout(Duration::from_secs(25), answer) => result
                .map_err(|_| {
                    // A queued/active detail must also release its target after the waiter times out.
                    cancel.cancel();
                    "request-timeout:作品读取超时。".to_string()
                })
                .and_then(|result| result.map_err(|_| "network-error:账号浏览器连接中断。".to_string()))
                .and_then(|result| result),
        }
    }
    pub fn close(&self, id: &str, listing: &str) {
        if let Some(run) = self.runs.lock().unwrap().get(id) {
            let _ = run.actions.try_send(Action::Close(listing.into()));
        }
    }
}
pub async fn page_action(
    cdp: &mut Cdp,
    session: &str,
    action: &str,
    code: Option<&str>,
) -> Result<Value, String> {
    let source = include_str!("douyin_browser/page-actions.js").replacen("export default ", "", 1);
    let result=cdp.call(Some(session),"Runtime.evaluate",json!({"expression":format!("({source})({}, {})",json!(action),json!(code)),"returnByValue":true,"awaitPromise":true,"userGesture":true})).await?;
    if result.get("exceptionDetails").is_some() {
        return Err("官方页面控件已改变，请在账号浏览器中完成操作。".into());
    }
    Ok(result["result"]["value"].clone())
}
pub async fn target(cdp: &mut Cdp, hidden: bool) -> Result<(String, String), String> {
    let target = cdp
        .call(
            None,
            "Target.createTarget",
            if hidden {
                json!({"url":"about:blank","background":true,"hidden":true})
            } else {
                json!({"url":"about:blank","background":false,"newWindow":true})
            },
        )
        .await?["targetId"]
        .as_str()
        .ok_or("无法创建账号页面。")?
        .to_owned();
    attach_target(cdp, target).await
}

async fn attach_target(cdp: &mut Cdp, target: String) -> Result<(String, String), String> {
    let session = cdp
        .call(
            None,
            "Target.attachToTarget",
            json!({"targetId":target,"flatten":true}),
        )
        .await?["sessionId"]
        .as_str()
        .ok_or("无法连接账号页面。")?
        .to_owned();
    cdp.call(
        Some(&session),
        "Network.enable",
        json!({"maxTotalBufferSize":16777216,"maxResourceBufferSize":12582912,"enableDurableMessages":true}),
    )
    .await?;
    cdp.call(Some(&session), "Page.enable", json!({})).await?;
    Ok((target, session))
}

/// The owned headed process already opens one blank tab. Attach before navigating so
/// response capture is ready, without leaving that tab behind and creating a second window.
async fn startup_target(
    cdp: &mut Cdp,
    has_startup_window: bool,
) -> Result<(String, String), String> {
    if !has_startup_window {
        return target(cdp, true).await;
    }
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let targets = cdp.call(None, "Target.getTargets", json!({})).await?;
        let id = targets["targetInfos"]
            .as_array()
            .and_then(|targets| {
                targets
                    .iter()
                    .find(|target| target["type"] == "page" && target["url"] == "about:blank")
            })
            .and_then(|target| target["targetId"].as_str());
        if let Some(id) = id {
            return attach_target(cdp, id.to_owned()).await;
        }
        if Instant::now() >= deadline {
            return Err("无法找到账号浏览器的初始页面。".into());
        }
        // DevToolsActivePort can be ready before Chromium publishes its startup tab.
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}
pub async fn body(cdp: &mut Cdp, session: &str, id: &str, limit: usize) -> Result<Vec<u8>, String> {
    use base64::Engine;
    let mut result = cdp
        .call(
            Some(session),
            "Network.getResponseBody",
            json!({"requestId":id}),
        )
        .await?;
    let base64 = result["base64Encoded"] == true;
    let Value::String(text) = result["body"].take() else {
        return Err("invalid-response:页面响应正文无效。".into());
    };
    if text.len() > if base64 { limit * 4 / 3 + 4 } else { limit } {
        return Err("limit-exceeded:页面响应超过读取预算。".into());
    }
    let bytes = if base64 {
        base64::engine::general_purpose::STANDARD
            .decode(&text)
            .map_err(|_| "invalid-response:页面响应编码无效。")?
    } else {
        text.into_bytes()
    };
    if bytes.len() > limit {
        return Err("limit-exceeded:页面响应超过读取预算。".into());
    }
    Ok(bytes)
}

async fn validate_browser_profile(cdp: &mut Cdp, value: &Value, status: u16) -> Result<(), String> {
    match projection::validate_profile(value, status) {
        Err(error) if error.starts_with("not-authenticated:") => {
            let cookies = cdp.call(None, "Storage.getCookies", json!({})).await?;
            Err(projection::authentication_error(projection::has_login(
                &projection::cookie_store(&cookies)?,
            )))
        }
        result => result,
    }
}
const PROFILE_WAIT: Duration = Duration::from_secs(5);

/// A homepage may stop issuing self-profile responses after a website change.
/// Keep that compatibility navigation bounded and avoid interrupting a login challenge.
fn needs_profile_navigation(data: &PrivateState, elapsed: Duration, navigated: bool) -> bool {
    !navigated
        && elapsed >= PROFILE_WAIT
        && data.profile.is_null()
        && data.login.get("qrImage").is_none()
        && data.login.get("verification").is_none()
        && matches!(data.login["status"].as_str(), Some("waiting" | "scanned"))
}
async fn worker(
    mut process: AccountProcess,
    cancel: &CancellationToken,
    data: &Arc<Mutex<PrivateState>>,
    actions: &mut mpsc::Receiver<Action>,
    start_query: Option<String>,
) -> Result<(), String> {
    let mut cdp = process.connect(cancel).await?;
    let result = worker_connected(&mut process, &mut cdp, cancel, data, actions, start_query).await;
    // All paths (including CDP/page failures) finish the old tree before releasing Profile.
    if cancel.is_cancelled() {
        // Revoked work has no browser state to commit. Stop the owned tree immediately,
        // while still waiting for all Profile handles before acknowledging cancellation.
        process.terminate();
    } else {
        let _ = tokio::time::timeout(
            Duration::from_secs(2),
            cdp.call(None, "Browser.close", json!({})),
        )
        .await;
    }
    if process.wait_for_exit(Duration::from_secs(5)).await.is_err() {
        process.terminate();
        if let Err(error) = process.wait_for_exit(Duration::from_secs(5)).await {
            data.lock().unwrap().shutdown_failure = Some(error.clone());
            return Err(error);
        }
    }
    result
}
async fn worker_connected(
    process: &mut AccountProcess,
    cdp: &mut Cdp,
    cancel: &CancellationToken,
    data: &Arc<Mutex<PrivateState>>,
    actions: &mut mpsc::Receiver<Action>,
    start_query: Option<String>,
) -> Result<(), String> {
    let version = cdp.call(None, "Browser.getVersion", json!({})).await?;
    data.lock().unwrap().agent = version["userAgent"]
        .as_str()
        .ok_or("无法读取浏览器身份。")?
        .into();
    // On Windows the inactive desktop hides ordinary headed windows without changing
    // document visibility/focus. Visible handoff keeps auxiliary search targets hidden.
    let hidden_targets = process.visible || !cfg!(target_os = "windows");
    let (_, session) = startup_target(cdp, cfg!(target_os = "windows") || process.visible).await?;
    // Observe from startup: the user may submit while account state is still loading.
    let mut verification_capture = start_query
        .as_ref()
        .map(|query| verification::Capture::new(&session, query));
    let navigation = cdp
        .call(
            Some(&session),
            "Page.navigate",
            json!({"url":search::HOME_URL}),
        )
        .await?;
    if let Some(error) = navigation["errorText"].as_str() {
        return Err(format!("network-error:{error}"));
    }
    data.lock().unwrap().page_ready = true;
    let started = Instant::now();
    let mut login_clicked = false;
    let mut confirmed = false;
    let mut profile_navigation = false;
    let mut fallback_navigation = false;
    let mut profile_started = Instant::now();
    let mut requests = HashMap::<String, (String, u16)>::new();
    let mut login_events = profile::LoginEvents::new(&session);
    let mut searches = search::Pages::new(hidden_targets);
    let mut verification_query = None;
    let mut cooldown: Option<Instant> = None;
    let mut sms_pending: Option<Instant> = None;
    let mut tick = tokio::time::interval(Duration::from_secs(1));
    let mut last_activity = Instant::now();
    loop {
        if let Some(response) = verification_capture
            .as_mut()
            .and_then(verification::Capture::take_response)
        {
            data.lock().unwrap().verification_response = Some(response);
        }
        tokio::select! {
            _=cancel.cancelled()=>break,
            action=actions.recv()=>{
                let Some(action)=action else{break};
                last_activity = Instant::now();
                match action{
                    Action::RefreshCredentials(reply)=>{
                        // Manual verification can replace risk/session cookies after login.
                        // Read them at handoff time; private values never cross product IPC.
                        let result=async{
                            let view=cdp.call(Some(&session),"Runtime.evaluate",json!({"expression":include_str!("douyin_browser/inspect-search-page.js"),"returnByValue":true})).await?;
                            if view["result"]["value"]=="verification-required"{return Err("verification-required:官方页面仍要求安全验证，请完成后再确认。".into())}
                            if view["result"]["value"]=="login-required"{
                                let cookies=cdp.call(None,"Storage.getCookies",json!({})).await?;
                                return Err(projection::authentication_error(projection::has_login(&projection::cookie_store(&cookies)?)))
                            }
                            let profile=profile::refresh(cdp,hidden_targets,cancel,&mut searches,verification_capture.as_mut(),&mut login_events).await?;
                            let cookies=cdp.call(None,"Storage.getCookies",json!({})).await?;
                            if !projection::has_login(&projection::cookie_store(&cookies)?){return Err("not-authenticated:官方页面登录已失效，请重新登录。".into())}
                            let mut data=data.lock().unwrap();data.cookies=cookies;data.profile=profile;data.profile_error=None;data.login=json!({"status":"signed-in"});
                            Ok(Value::Null)
                        }.await;
                        let _=reply.send(result);
                    }
                    Action::Profile(stop,reply)=>{
                        let operation=cancel.child_token();
                        let result={
                            let work=profile::refresh(cdp,hidden_targets,&operation,&mut searches,verification_capture.as_mut(),&mut login_events);
                            tokio::pin!(work);
                            tokio::select!{result=&mut work=>result,_=stop.cancelled()=>{operation.cancel();work.await}}
                        };
                        if let Ok(profile)=&result{
                            let cookies=cdp.call(None,"Storage.getCookies",json!({})).await?;
                            let mut data=data.lock().unwrap();data.profile=profile.clone();data.profile_error=None;
                            if projection::has_login(&projection::cookie_store(&cookies)?){data.cookies=cookies;data.login=json!({"status":"signed-in"});}
                        }
                        // Keep connection/format failures retryable; they do not erase identity.
                        if let Err(error)=&result
                            && (error.starts_with("not-authenticated:") || error.starts_with("verification-required:")) {
                                let mut data=data.lock().unwrap();data.profile=Value::Null;data.profile_error=Some(error.clone());
                                if error.starts_with("not-authenticated:"){data.cookies=Value::Null;}
                        }
                        let _=reply.send(result.map(|profile|json!({"status":200,"body":serde_json::to_vec(&profile).unwrap()})));
                    }
                    Action::SearchFailure(listing,code,reply)=>{
                        let result=searches.report_failure(cdp,&listing,&code).await;
                        let _=reply.send(result);
                    }
                    Action::Sms(code,stop,reply)=>{
                        let verification=data.lock().unwrap().login["verification"].clone();
                        let result=async{
                            if stop.is_cancelled(){return Err("本次登录已取消。".into())}
                            if sms_pending.is_some(){return Err("请等待上一项短信操作完成。".into())}
                            if !verification["methods"].as_array().is_some_and(|ways|ways.iter().any(|way|way["id"]=="mobile_sms_verify" && way["inApp"]==true)){return Err("当前账号没有短信验证挑战。".into())}
                            if code.as_ref().is_some_and(|code|code.len()!=6 || !code.bytes().all(|b|b.is_ascii_digit())){return Err("请输入六位数字验证码。".into())}
                            if code.is_some() && verification["selectedMethod"]!="mobile_sms_verify"{return Err("请先选择接收短信验证码。".into())}
                            if code.is_none() && cooldown.is_some_and(|at|at>Instant::now()){return Err("请等待短信重发倒计时。".into())}
                            let result=tokio::select!{_=stop.cancelled()=>return Err("本次登录已取消。".into()),_=cancel.cancelled()=>return Err("账号会话已结束。".into()),result=page_action(cdp,&session,if code.is_some(){"submit"}else{"send"},code.as_deref())=>result}?;
                            if result["ok"]!=true{return Err("无法唯一识别短信控件，请在账号浏览器中操作。".into())}
                            sms_pending=Some(Instant::now());if code.is_none(){cooldown=Some(Instant::now()+Duration::from_secs(60));}
                            data.lock().unwrap().login["message"]=if code.is_none(){"正在等待官方短信发送确认…"}else{"正在等待官方短信验证结果…"}.into();
                            Ok(data.lock().unwrap().login.clone())
                        }.await;
                        let _=reply.send(result);
                    }
                    Action::Search(request,stop,reply)=>{
                        let work=searches.load(cdp,request,&stop);
                        let result=tokio::select!{_=cancel.cancelled()=>Err("operation-cancelled:账号会话已结束。".into()),result=work=>result};
                        if result.is_ok() && !stop.is_cancelled() && !cancel.is_cancelled() {
                            let cookies = cdp.call(None,"Storage.getCookies",json!({})).await?;
                            data.lock().unwrap().cookies = cookies;
                        }
                        let proxy_failure = result.as_ref().err().filter(|error| crate::network::proxy_routing::is_browser_proxy_failure(error)).cloned();
                        if proxy_failure.is_some() {
                            let mut public = data.lock().unwrap();
                            public.page_ready = false;
                            public.login = json!({"status":"waiting","keepPolling":true,"message":"正在切换备用代理…"});
                        }
                        let _=reply.send(result);
                        if let Some(error) = proxy_failure { return Err(error); }
                    }
                    Action::Detail(request,stop,reply)=>{
                        let operation = cancel.child_token();
                        let result = {
                            let work = detail::load(cdp,request,hidden_targets,&operation,&mut searches);
                            tokio::pin!(work);
                            tokio::select! {
                                result = &mut work => result,
                                _ = stop.cancelled() => { operation.cancel(); work.await },
                            }
                        };
                        if result.is_ok() && !stop.is_cancelled() && !cancel.is_cancelled() {
                            let cookies = cdp.call(None,"Storage.getCookies",json!({})).await?;
                            data.lock().unwrap().cookies = cookies;
                        }
                        let proxy_failure = result.as_ref().err().filter(|error| crate::network::proxy_routing::is_browser_proxy_failure(error)).cloned();
                        if proxy_failure.is_some() {
                            let mut public = data.lock().unwrap();
                            public.page_ready = false;
                            public.login = json!({"status":"waiting","keepPolling":true,"message":"正在切换备用代理…"});
                        }
                        let _ = reply.send(result);
                        if let Some(error) = proxy_failure { return Err(error); }
                    }
                    Action::Close(id)=>{searches.close(cdp,&id).await;}
                }
            }
            event=async { match login_events.pop() { Some(event)=>Some(event), None=>cdp.events.recv().await } }=>{
                let Some(event)=event else{return Err(cdp.disconnect_reason())};
                if let Some(capture) = &mut verification_capture {
                    capture.retain(cdp, &event).await?;
                    }
                if event["sessionId"]!=session{
                    tokio::select!{_=cancel.cancelled()=>break,_=searches.observe(cdp,&event)=>{}}
                    continue
                }
                login_events.observe(&event)?;
                let params=&event["params"];let id=params["requestId"].as_str().unwrap_or("");
                match event["method"].as_str(){
                    Some("Network.responseReceived")=>{if let Some(kind)=projection::response_endpoint(params){if requests.len()>=32{return Err("登录响应超过读取预算。".into())}requests.insert(id.into(),(kind.into(),params["response"]["status"].as_u64().unwrap_or(200) as u16));}},
                    Some("Network.loadingFailed")=>{
                        requests.remove(id);
                        if let Some(error) = params["errorText"].as_str()
                            && crate::network::proxy_routing::is_browser_proxy_failure(error) {
                            return Err(format!("network-error:{error}"));
                        }
                    },
                    Some("Network.loadingFinished")=>{
                        let Some((kind,status))=requests.remove(id) else{continue};
                        let bytes=match body(cdp,&session,id,1048576).await {
                            Ok(bytes)=>bytes,
                            // Official login may navigate before its final polling response is read.
                            // Trust only a later authenticated profile + native cookie confirmation.
                            Err(error) if error.contains("response-body-unavailable:")=>continue,
                            Err(error)=>return Err(error),
                        };
                        let value:Value=serde_json::from_slice(&bytes).map_err(|_|"官方登录响应格式改变。")?;
                        if kind=="profile"{
                            let error=validate_browser_profile(cdp,&value,status).await.err();
                            let mut data=data.lock().unwrap();data.profile=value;
                            if let Some(error)=&error && error.starts_with("verification-required:"){
                                data.login=json!({"status":"verification-required","keepPolling":true,"message":"账号需要完成安全验证，请打开官方浏览器。"});
                            }
                            data.profile_error=error;
                            continue
                        }
                        if data.lock().unwrap().login["status"]=="signed-in"{continue}
                        let Some(mut public)=projection::project(&kind,&value) else{return Err("官方登录状态尚未识别，请在账号浏览器中查看。".into())};
                        if public.get("smsResult").is_some(){
                            sms_pending=None;
                            let mut data=data.lock().unwrap();
                            if public["accepted"]==true{
                                if kind=="send"{data.login["verification"]["selectedMethod"]="mobile_sms_verify".into();data.login["verification"]["maskedMobile"]=public["maskedMobile"].clone();cooldown=Some(Instant::now()+Duration::from_secs(public["retryAfter"].as_u64().unwrap_or(60)));}
                                data.login["message"]=if kind=="send"{"短信已发送，请输入验证码。"}else{"验证已通过，等待官方最终登录确认。"}.into();
                            }else{data.login["message"]="短信操作未通过，请检查验证码或等待重发。".into();}
                            continue;
                        }
                        if public["status"]=="signed-in"{confirmed=true;public=json!({"status":"scanned","message":"官方已确认，正在读取账号凭证…"});}
                        public["keepPolling"]=true.into();
                        let mut data=data.lock().unwrap();
                        if public["status"]=="waiting" && public.get("qrImage").is_none()&& let Some(image)=data.login.get("qrImage"){public["qrImage"]=image.clone();}
                        // Repeated check_qrconnect responses must not reset the selected SMS method.
                        if public.get("verification").is_some() && data.login.get("verification").is_some(){public["verification"]=data.login["verification"].clone();}
                        data.login=public;
                    }
                    _=>{}
                }
            }
            _=tick.tick()=>{
                searches.reap(cdp).await;
                if process.window_seen(){return Err("观察到账号浏览器窗口出现，已结束隐藏会话。请主动打开系统浏览器完成验证。".into())}
                if process.exited()?{return Err("network-error:账号浏览器已关闭，请重新打开验证。".into())}
                let signed_in=data.lock().unwrap().login["status"]=="signed-in";
                // Hidden authenticated browsers can be reopened from the same Profile.
                // Reclaim the entire account process tree after browser activity stops.
                if signed_in && !process.visible && verification_capture.is_none()
                    && last_activity.elapsed() >= Duration::from_secs(120) { break; }
                if !signed_in && started.elapsed()>Duration::from_secs(600){return Err("本次登录已超时，请重新生成二维码。".into())}
                if !signed_in{
                    if confirmed && !profile_navigation{
                        profile_navigation=true;
                        fallback_navigation=false;
                        profile_started=Instant::now();
                        if start_query.is_none(){
                            {let mut data=data.lock().unwrap();data.profile=Value::Null;data.profile_error=None;}
                            cdp.call(Some(&session),"Page.navigate",json!({"url":search::HOME_URL})).await?;
                        }else{
                            // A guest response observed before QR confirmation is no longer current.
                            let mut data=data.lock().unwrap();
                            if !projection::authenticated_profile(&data.profile){data.profile=Value::Null;data.profile_error=None;}
                        }
                    }
                    let fallback=!requests.values().any(|(kind,_)|kind=="profile") && needs_profile_navigation(&data.lock().unwrap(),profile_started.elapsed(),fallback_navigation);
                    if fallback{
                        fallback_navigation=true;
                        // Account checks must not replace the visible search or a completed challenge.
                        match profile::refresh(cdp,hidden_targets,cancel,&mut searches,verification_capture.as_mut(),&mut login_events).await{
                            Ok(profile)=>{let mut data=data.lock().unwrap();data.profile=profile;data.profile_error=None;}
                            Err(error)=>{data.lock().unwrap().profile_error=Some(error);}
                        }
                    }
                    let profile_valid={let data=data.lock().unwrap();data.profile_error.is_none() && projection::authenticated_profile(&data.profile)};
                    if profile_valid{
                        let cookies=cdp.call(None,"Storage.getCookies",json!({})).await?;
                        if projection::has_login(&projection::cookie_store(&cookies)?){
                            {let mut data=data.lock().unwrap();data.cookies=cookies;data.profile_error=None;data.login=json!({"status":"signed-in"});}
                            if let Some(query)=&start_query{
                                verification_query = Some(query.clone());
                            }
                            continue
                        }
                    }
                    if !login_clicked && !confirmed && started.elapsed()>Duration::from_secs(3) && data.lock().unwrap().login.get("qrImage").is_none(){
                        let cookies=cdp.call(None,"Storage.getCookies",json!({})).await?;
                        // Give an existing session time to bootstrap; do not open a guest login modal over it.
                        if !projection::has_login(&projection::cookie_store(&cookies)?) && page_action(cdp,&session,"login",None).await?["ok"]==true{login_clicked=true;}
                    }
                    if sms_pending.is_some_and(|at|at.elapsed()>Duration::from_secs(15)){sms_pending=None;data.lock().unwrap().login["message"]="短信操作未收到确认，请在账号浏览器查看后重试。".into();}
                    if data.lock().unwrap().login.get("verification").is_some(){
                        let view=page_action(cdp,&session,"inspect",None).await?;
                        let mut data=data.lock().unwrap();data.login["verification"]["retryAfter"]=json!(cooldown.map(|at|at.saturating_duration_since(Instant::now()).as_secs().saturating_add(1)).unwrap_or(0).max(view["retryAfter"].as_u64().unwrap_or(0)));
                        if view["maskedMobile"].as_str().is_some_and(|v|!v.is_empty()){data.login["verification"]["maskedMobile"]=view["maskedMobile"].clone();}
                    }
                }
                if let Some(query) = &verification_query {
                    // Preserve event capture while controls load. A visible challenge is
                    // left for the user; resume the pending submission after it disappears.
                    if verification::submit_pending(cdp, &session, query).await? {
                        verification_query = None;
                    }
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::{SinkExt, StreamExt};
    use tokio::sync::oneshot;
    use tokio_tungstenite::tungstenite::Message;

    #[test]
    fn profile_rejection_uses_current_browser_cookies_while_unknown_failures_do_not_probe_credentials()
     {
        tauri::async_runtime::block_on(async {
            for has_login in [true, false] {
                let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
                let address = listener.local_addr().unwrap();
                let (release, wait) = oneshot::channel();
                let task = tauri::async_runtime::spawn(async move {
                    let (stream, _) = listener.accept().await.unwrap();
                    let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
                    let message = ws.next().await.unwrap().unwrap();
                    let command: Value = serde_json::from_str(message.to_text().unwrap()).unwrap();
                    assert_eq!(command["method"], "Storage.getCookies");
                    let cookies = if has_login {
                        vec![
                            json!({"name":"sessionid_ss","value":"fixture","domain":".douyin.com","path":"/","httpOnly":true}),
                        ]
                    } else {
                        vec![]
                    };
                    ws.send(Message::Text(
                        json!({"id":command["id"],"result":{"cookies":cookies}})
                            .to_string()
                            .into(),
                    ))
                    .await
                    .unwrap();
                    let _ = wait.await;
                });
                let mut cdp = Cdp::connect(&format!("ws://{address}"), &CancellationToken::new())
                    .await
                    .unwrap();
                let error = validate_browser_profile(&mut cdp, &json!({"status_code":8}), 200)
                    .await
                    .unwrap_err();
                assert!(error.starts_with(if has_login {
                    "verification-required:"
                } else {
                    "not-authenticated:"
                }));
                for (profile, status, expected) in [
                    (json!({"status_code":0}), 200, "invalid-response:"),
                    (json!({"status_code":500}), 503, "upstream-error:"),
                    (json!({"status_code":2483}), 401, "verification-required:"),
                ] {
                    assert!(
                        validate_browser_profile(&mut cdp, &profile, status)
                            .await
                            .unwrap_err()
                            .starts_with(expected)
                    );
                }
                release.send(()).unwrap();
                task.await.unwrap();
            }
        });
    }
    #[test]
    fn explicit_profile_retry_bypasses_stale_rejection_and_qr_expiry_never_means_account_logout() {
        tauri::async_runtime::block_on(async {
            let manager = Manager::default();
            let data = Arc::new(Mutex::new(PrivateState {
                login: json!({"status":"verification-required"}),
                profile_error: Some("verification-required:old challenge".into()),
                page_ready: true,
                ..Default::default()
            }));
            let (actions, mut receiver) = mpsc::channel(1);
            let (release, wait) = oneshot::channel();
            manager.runs.lock().unwrap().insert(
                "account".into(),
                Run {
                    cancel: CancellationToken::new(),
                    public: data.clone(),
                    actions,
                    task: tauri::async_runtime::spawn(async move {
                        let _ = wait.await;
                    }),
                },
            );
            let cancel = CancellationToken::new();
            assert!(
                manager
                    .ready("account", &cancel)
                    .await
                    .unwrap_err()
                    .starts_with("verification-required:")
            );
            let probe = manager.profile("account", &cancel, false);
            let respond = async {
                let Some(Action::Profile(_, reply)) = receiver.recv().await else {
                    panic!("fresh probe expected")
                };
                reply.send(Ok(json!({"status":200,"body":serde_json::to_vec(&json!({"status_code":0,"user":{"uid":"12"}})).unwrap()}))).unwrap();
            };
            let (result, _) = tokio::join!(probe, respond);
            assert!(result.is_ok());
            {
                let mut data = data.lock().unwrap();
                data.profile_error = None;
                data.login = json!({"status":"expired"});
            }
            assert!(
                manager
                    .ready("account", &cancel)
                    .await
                    .unwrap_err()
                    .starts_with("verification-required:")
            );
            release.send(()).unwrap();
            manager.stop("account").await.unwrap();
            assert!(
                manager
                    .action("account", Action::RefreshCredentials, &cancel)
                    .await
                    .unwrap_err()
                    .starts_with("operation-cancelled:")
            );
        });
    }
    #[test]
    fn visible_startup_reuses_one_blank_tab_before_navigation() {
        tauri::async_runtime::block_on(async {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let task = tauri::async_runtime::spawn(async move {
                let (stream, _) = listener.accept().await.unwrap();
                let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
                let mut calls = Vec::new();
                let mut queries = 0;
                while calls.last().is_none_or(|method| method != "Page.enable") {
                    let message = socket.next().await.unwrap().unwrap();
                    let command: Value = serde_json::from_str(message.to_text().unwrap()).unwrap();
                    let method = command["method"].as_str().unwrap().to_owned();
                    let result = match method.as_str() {
                        "Target.getTargets" => {
                            queries += 1;
                            if queries == 1 {
                                json!({"targetInfos":[]})
                            } else {
                                json!({"targetInfos":[
                                    {"targetId":"worker","type":"service_worker","url":"about:blank"},
                                    {"targetId":"startup","type":"page","url":"about:blank"}
                                ]})
                            }
                        }
                        "Target.attachToTarget" => {
                            assert_eq!(command["params"]["targetId"], "startup");
                            assert_eq!(command["params"]["flatten"], true);
                            json!({"sessionId":"page"})
                        }
                        "Network.enable" | "Page.enable" => {
                            assert_eq!(command["sessionId"], "page");
                            json!({})
                        }
                        other => panic!("startup must reuse the existing tab: {other}"),
                    };
                    socket
                        .send(Message::Text(
                            json!({"id":command["id"],"result":result})
                                .to_string()
                                .into(),
                        ))
                        .await
                        .unwrap();
                    calls.push(method);
                }
                calls
            });
            let mut cdp = Cdp::connect(&format!("ws://{address}"), &CancellationToken::new())
                .await
                .unwrap();
            assert_eq!(
                startup_target(&mut cdp, true).await.unwrap(),
                ("startup".into(), "page".into())
            );
            let calls = task.await.unwrap();
            assert_eq!(
                calls,
                [
                    "Target.getTargets",
                    "Target.getTargets",
                    "Target.attachToTarget",
                    "Network.enable",
                    "Page.enable"
                ]
            );
        });
    }
    #[test]
    fn homepage_profile_fallback_is_bounded_and_does_not_interrupt_login() {
        let mut data = PrivateState {
            login: json!({"status":"waiting"}),
            ..Default::default()
        };
        assert!(!needs_profile_navigation(
            &data,
            Duration::from_secs(4),
            false
        ));
        assert!(needs_profile_navigation(&data, PROFILE_WAIT, false));
        assert!(!needs_profile_navigation(&data, PROFILE_WAIT, true));
        for login in [
            json!({"status":"waiting","qrImage":"fixture"}),
            json!({"status":"verification-required","verification":{}}),
            json!({"status":"blocked"}),
            json!({"status":"signed-in"}),
        ] {
            data.login = login;
            assert!(!needs_profile_navigation(&data, PROFILE_WAIT, false));
        }
        data.login = json!({"status":"waiting"});
        data.profile = json!({"status_code":0,"user":{}});
        assert!(!needs_profile_navigation(&data, PROFILE_WAIT, false));
    }

    #[test]
    fn startup_profile_response_avoids_reload_but_later_checks_and_cancellation_do_not_reuse_it() {
        tauri::async_runtime::block_on(async {
            let manager = Manager::default();
            let profile = json!({"status_code":0,"user":{"nickname":"fixture"}});
            let (actions, mut receiver) = mpsc::channel(1);
            let (release, wait) = oneshot::channel();
            manager.runs.lock().unwrap().insert(
                "account".into(),
                Run {
                    cancel: CancellationToken::new(),
                    public: Arc::new(Mutex::new(PrivateState {
                        login: json!({"status":"signed-in"}),
                        profile: profile.clone(),
                        page_ready: true,
                        ..Default::default()
                    })),
                    actions,
                    task: tauri::async_runtime::spawn(async move {
                        let _ = wait.await;
                    }),
                },
            );
            let cancel = CancellationToken::new();
            let result = manager.profile("account", &cancel, true).await.unwrap();
            assert_eq!(result["body"], json!(serde_json::to_vec(&profile).unwrap()));
            assert!(
                receiver.try_recv().is_err(),
                "startup must not reload the homepage"
            );
            let cancelled = CancellationToken::new();
            cancelled.cancel();
            assert!(
                manager
                    .profile("account", &cancelled, true)
                    .await
                    .unwrap_err()
                    .starts_with("operation-cancelled:")
            );
            assert!(receiver.try_recv().is_err());
            let check = manager.profile("account", &cancel, false);
            let respond = async {
                let Some(Action::Profile(_, reply)) = receiver.recv().await else {
                    panic!("a later check must request a fresh official response");
                };
                reply
                    .send(Err("not-authenticated:fixture logout".into()))
                    .unwrap();
            };
            let (result, _) = tokio::join!(check, respond);
            assert!(result.unwrap_err().starts_with("not-authenticated:"));
            release.send(()).unwrap();
            manager.stop("account").await.unwrap();
        });
    }
    #[test]
    fn opening_waits_for_page_setup_and_stopping_waits_for_profile_cleanup() {
        tauri::async_runtime::block_on(async {
            let manager = Manager::default();
            let data = Arc::new(Mutex::new(PrivateState {
                login: json!({"status":"waiting"}),
                page_ready: true,
                ..Default::default()
            }));
            let (actions, _) = mpsc::channel(1);
            let (release, wait) = oneshot::channel();
            let stopped = data.clone();
            manager.runs.lock().unwrap().insert(
                "account".into(),
                Run {
                    cancel: CancellationToken::new(),
                    public: data,
                    actions,
                    task: tauri::async_runtime::spawn(async move {
                        let _ = wait.await;
                        stopped.lock().unwrap().shutdown_failure =
                            Some("request-timeout:旧账号浏览器尚未完全退出，请稍后重试。".into());
                    }),
                },
            );
            // A visible window can be ready before login; opening it must not wait for a scan.
            manager
                .ready_page("account", &CancellationToken::new())
                .await
                .unwrap();
            let stopping = manager.stop("account");
            tokio::pin!(stopping);
            tokio::select! {
                _ = &mut stopping => panic!("Profile handoff returned before worker cleanup"),
                _ = tokio::task::yield_now() => {}
            }
            release.send(()).unwrap();
            assert!(stopping.await.unwrap_err().starts_with("request-timeout:"));
            assert!(
                manager
                    .ready_page("account", &CancellationToken::new())
                    .await
                    .unwrap_err()
                    .starts_with("operation-cancelled:")
            );
        });
    }
}
