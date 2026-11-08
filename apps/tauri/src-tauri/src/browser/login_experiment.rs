//! Development-only browser login laboratory. It never reads or mutates product accounts/vaults.
mod process;
use crate::{browser::cdp::Cdp, browser::douyin_browser::projection};
use process::Process;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{State, WebviewWindow};
use tokio::sync::{mpsc, oneshot};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Mode {
    HeadedHidden,
    Headless,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub run_id: String,
    pub mode: Mode,
    pub phase: String,
    pub browser: String,
    pub version: String,
    pub login: Value,
    pub browser_login: bool,
    pub rust_session: String,
    pub sms_requested: bool,
    pub sms_verified: bool,
    pub window_observation: String,
    pub visible_fallback: bool,
    pub cleanup: String,
}
type ActionReply = oneshot::Sender<Result<(), String>>;
enum Action {
    Sms(Option<String>, ActionReply),
    Visible(ActionReply),
}
struct Run {
    id: String,
    public: Arc<Mutex<Snapshot>>,
    cancel: CancellationToken,
    actions: mpsc::Sender<Action>,
    task: tauri::async_runtime::JoinHandle<()>,
}
#[derive(Default)]
pub struct Manager {
    current: tokio::sync::Mutex<Option<Run>>,
}
pub fn enabled() -> bool {
    cfg!(all(debug_assertions, target_os = "windows"))
}
fn require_development() -> Result<(), String> {
    if enabled() {
        Ok(())
    } else {
        Err("登录试验仅在 Windows 开发版本中可用。".into())
    }
}
impl Manager {
    pub async fn start(&self, root: PathBuf, mode: Mode) -> Result<String, String> {
        require_development()?;
        let mut current = self.current.lock().await;
        if let Some(old) = current.take() {
            old.cancel.cancel();
            let _ = old.task.await;
        }
        let (browser_name, browser) = crate::browser::verification::find_browser("chrome")
            .map(|p| ("Chrome", p))
            .or_else(|_| crate::browser::verification::find_browser("edge").map(|p| ("Edge", p)))?;
        let id = uuid::Uuid::new_v4().to_string();
        let public = Arc::new(Mutex::new(Snapshot {
            run_id: id.clone(),
            mode,
            phase: "starting".into(),
            browser: browser_name.into(),
            version: String::new(),
            login: json!({"status":"waiting","message":"正在准备独立后台浏览器…"}),
            browser_login: false,
            rust_session: "not-checked".into(),
            sms_requested: false,
            sms_verified: false,
            window_observation: "not-observed".into(),
            visible_fallback: false,
            cleanup: "pending".into(),
        }));
        let cancel = CancellationToken::new();
        let (actions, receiver) = mpsc::channel(8);
        let state = public.clone();
        let stopped = cancel.clone();
        let directory = root.join(&id);
        let task = tauri::async_runtime::spawn(async move {
            let result = worker(&browser, &directory, mode, &state, &stopped, receiver).await;
            if let Err(message) = result {
                let mut state = state.lock().unwrap();
                state.phase = "failed".into();
                state.login = json!({"status":"blocked","message":message});
            }
            let mut cleanup_result = process::cleanup(&root, &directory);
            // Job termination is synchronous, but Chrome file handles may release slightly later.
            for _ in 0..10 {
                if cleanup_result.is_ok() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
                cleanup_result = process::cleanup(&root, &directory);
            }
            let mut state = state.lock().unwrap();
            state.cleanup = if cleanup_result.is_ok() {
                "complete"
            } else {
                "failed"
            }
            .into();
            state.login.as_object_mut().map(|v| v.remove("qrImage"));
            state
                .login
                .as_object_mut()
                .map(|v| v.remove("verification"));
            if stopped.is_cancelled() {
                state.phase = "cancelled".into();
                state.login = json!({"status":"expired","message":"试验已取消。"});
            }
        });
        *current = Some(Run {
            id: id.clone(),
            public,
            cancel,
            actions,
            task,
        });
        Ok(id)
    }
    pub async fn status(&self, id: &str) -> Result<Snapshot, String> {
        let current = self.current.lock().await;
        let run = current
            .as_ref()
            .filter(|run| run.id == id)
            .ok_or("试验已取消或替换。")?;
        let result = run.public.lock().unwrap().clone();
        Ok(result)
    }
    async fn action(&self, id: &str, code: Option<Option<String>>) -> Result<(), String> {
        require_development()?;
        let (tx, cancel) = {
            let current = self.current.lock().await;
            let run = current
                .as_ref()
                .filter(|run| run.id == id)
                .ok_or("试验已取消或替换。")?;
            (run.actions.clone(), run.cancel.clone())
        };
        let (reply, answer) = oneshot::channel();
        let action = match code {
            Some(code) => Action::Sms(code, reply),
            None => Action::Visible(reply),
        };
        tx.try_send(action)
            .map_err(|_| "试验已结束或有操作正在进行。")?;
        tokio::select! {_ = cancel.cancelled()=>Err("试验已取消。".into()),result=tokio::time::timeout(Duration::from_secs(40),answer)=>
        result.map_err(|_|"试验操作超时。".to_string()).and_then(|v|v.map_err(|_|"试验已结束。".to_string())).and_then(|v|v)}
    }
    pub async fn sms(&self, id: &str, code: Option<String>) -> Result<(), String> {
        self.action(id, Some(code)).await
    }
    pub async fn visible(&self, id: &str) -> Result<(), String> {
        self.action(id, None).await
    }
    pub async fn cancel(&self, id: &str) -> Result<Option<Snapshot>, String> {
        let mut current = self.current.lock().await;
        if current.as_ref().is_some_and(|run| run.id == id) {
            let run = current.take().unwrap();
            run.cancel.cancel();
            let _ = run.task.await;
            let snapshot = run.public.lock().unwrap().clone();
            return Ok(Some(snapshot));
        }
        Ok(None)
    }
    pub async fn shutdown(&self) {
        let mut current = self.current.lock().await;
        if let Some(run) = current.take() {
            run.cancel.cancel();
            let _ = run.task.await;
        }
    }
}
async fn page_action(
    cdp: &mut Cdp,
    session: &str,
    action: &str,
    code: Option<&str>,
) -> Result<Value, String> {
    let source = include_str!("douyin_browser/page-actions.js").replacen("export default ", "", 1);
    let expression = format!("({source})({}, {})", json!(action), json!(code));
    let result=cdp.call(Some(session),"Runtime.evaluate",json!({"expression":expression,"returnByValue":true,"awaitPromise":true,"userGesture":true})).await?;
    if result.get("exceptionDetails").is_some() {
        return Err("官方页面操作不兼容，请主动打开官方浏览器。".into());
    }
    Ok(result["result"]["value"].clone())
}
async fn attach(cdp: &mut Cdp, visible: bool, mode: Mode) -> Result<String, String> {
    let target = if visible {
        let ready = Instant::now();
        loop {
            let targets = cdp.call(None, "Target.getTargets", json!({})).await?;
            let target = targets["targetInfos"]
                .as_array()
                .and_then(|items| {
                    items.iter().find(|item| {
                        item["type"] == "page"
                            && item["url"]
                                .as_str()
                                .is_some_and(|url| url.starts_with("https://www.douyin.com/"))
                    })
                })
                .and_then(|item| item["targetId"].as_str())
                .map(str::to_owned);
            if let Some(target) = target {
                break target;
            }
            if ready.elapsed() > Duration::from_secs(10) {
                return Err("官方浏览器页面尚未准备好。".into());
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    } else {
        let params = match mode {
            Mode::HeadedHidden => json!({"url":"about:blank","hidden":true,"background":true}),
            Mode::Headless => json!({"url":"about:blank"}),
        };
        cdp.call(None, "Target.createTarget", params).await?["targetId"]
            .as_str()
            .ok_or("浏览器未提供隐藏页面。")?
            .to_owned()
    };
    let session = cdp
        .call(
            None,
            "Target.attachToTarget",
            json!({"targetId":target,"flatten":true}),
        )
        .await?["sessionId"]
        .as_str()
        .ok_or("无法附加试验页面。")?
        .to_owned();
    cdp.call(
        Some(&session),
        "Network.enable",
        json!({"maxTotalBufferSize":2097152,"maxResourceBufferSize":1048576}),
    )
    .await?;
    cdp.call(Some(&session), "Page.enable", json!({})).await?;
    cdp.call(
        Some(&session),
        "Emulation.setDeviceMetricsOverride",
        json!({"width":1280,"height":850,"deviceScaleFactor":1,"mobile":false}),
    )
    .await?;
    cdp.call(
        Some(&session),
        "Page.setInterceptFileChooserDialog",
        json!({"enabled":true}),
    )
    .await?;
    cdp.call(
        Some(&session),
        "Page.setDownloadBehavior",
        json!({"behavior":"deny"}),
    )
    .await?;
    if !visible {
        cdp.call(
            Some(&session),
            "Page.navigate",
            json!({"url":"https://www.douyin.com/"}),
        )
        .await?;
    }
    Ok(session)
}
fn blocked(public: &Arc<Mutex<Snapshot>>, message: &str) {
    let mut state = public.lock().unwrap();
    state.phase = "needs-browser".into();
    state.login = json!({"status":"blocked","message":message});
}
struct BrowserFlow {
    confirmed: bool,
    profile_navigation: bool,
    profile_url: Option<String>,
    profile_uifid: Option<String>,
    requests: HashMap<String, String>,
    login_clicked: bool,
    frozen: bool,
    pending_sms: Option<(String, Instant)>,
    cooldown: Option<Instant>,
}
fn sms_allowed(flow: &BrowserFlow, verification: &Value, code: Option<&str>) -> Result<(), String> {
    if flow.frozen || flow.pending_sms.is_some() {
        return Err("当前试验不允许重复提交。".into());
    }
    if verification["methods"].as_array().is_none_or(|ways| {
        !ways
            .iter()
            .any(|way| way["id"] == "mobile_sms_verify" && way["inApp"] == true)
    }) {
        return Err("当前页面没有软件内短信验证。".into());
    }
    if code.is_some_and(|code| code.len() != 6 || !code.bytes().all(|b| b.is_ascii_digit())) {
        return Err("请输入六位数字验证码。".into());
    }
    if code.is_some() && verification["selectedMethod"] != "mobile_sms_verify" {
        return Err("请先发送验证短信。".into());
    }
    if code.is_none() && flow.cooldown.is_some_and(|at| at > Instant::now()) {
        return Err("请等待短信重发倒计时。".into());
    }
    Ok(())
}
impl BrowserFlow {
    fn new() -> Self {
        Self {
            confirmed: false,
            profile_navigation: false,
            profile_url: None,
            profile_uifid: None,
            requests: HashMap::new(),
            login_clicked: false,
            frozen: false,
            pending_sms: None,
            cooldown: None,
        }
    }
}
async fn worker(
    browser: &std::path::Path,
    directory: &std::path::Path,
    mode: Mode,
    public: &Arc<Mutex<Snapshot>>,
    cancel: &CancellationToken,
    mut actions: mpsc::Receiver<Action>,
) -> Result<(), String> {
    let mut process = Process::start(browser, directory, mode, false)?;
    let mut cdp = process.connect(cancel).await?;
    let version = cdp.call(None, "Browser.getVersion", json!({})).await?;
    let agent = version["userAgent"]
        .as_str()
        .ok_or("无法读取浏览器版本。")?
        .to_owned();
    public.lock().unwrap().version = version["product"].as_str().unwrap_or("unknown").to_owned();
    let mut session = match attach(&mut cdp, false, mode).await {
        Ok(session) => Some(session),
        Err(_) => {
            blocked(
                public,
                "当前浏览器不支持所选隐藏页面，已停止自动操作。可以主动打开官方浏览器。",
            );
            None
        }
    };
    if session.is_some() {
        public.lock().unwrap().phase = "waiting".into();
    }
    let mut flow = BrowserFlow::new();
    let started = Instant::now();
    let mut tick = tokio::time::interval(Duration::from_secs(1));
    loop {
        tokio::select! {
            _=cancel.cancelled()=>return Ok(()),
            command=actions.recv()=>{
                let Some(command)=command else{return Ok(())};
                match command {
                    Action::Visible(reply)=>{
                        let result=async {
                            // New page/new attempt; never export or reuse a credential-bearing redirect URL.
                            drop(session.take());
                            process.stop();
                            cdp.stopped_for_replacement();
                            process=Process::start(browser,directory,mode,true)?;
                            cdp=process.connect(cancel).await?;
                            session=Some(attach(&mut cdp,true,mode).await?);
                            flow=BrowserFlow::new();
                            let mut state=public.lock().unwrap();state.visible_fallback=true;state.phase="visible".into();state.login=json!({"status":"waiting","message":"请在官方浏览器重新完成登录；当前尝试不计入隐藏模式成功。"});
                            Ok(())
                        }.await;
                        let _=reply.send(result);
                    }
                    Action::Sms(code,reply)=>{
                        let result=async {
                            let verification=public.lock().unwrap().login["verification"].clone();
                            sms_allowed(&flow,&verification,code.as_deref())?;
                            let action=if code.is_some(){"submit"}else{"send"};
                            if code.is_none(){flow.cooldown=Some(Instant::now()+Duration::from_secs(60));}
                            let result=page_action(&mut cdp,session.as_deref().ok_or("试验页面不可用。")?,action,code.as_deref()).await?;
                            if result["ok"]!=true{blocked(public,"无法唯一识别官方短信控件，已停止操作。请主动打开官方浏览器。");return Err("官方短信控件不兼容。".into())}
                            flow.pending_sms=Some((if code.is_some(){"validate"}else{"send"}.into(),Instant::now()));
                            Ok(())
                        }.await;
                        let _=reply.send(result);
                    }
                }
            }
            event=cdp.events.recv()=>{
                let Some(event)=event else {return Err("试验浏览器连接已关闭。".into())};
                if session.as_deref()!=event["sessionId"].as_str(){continue}
                if flow.frozen || public.lock().unwrap().login["status"]=="blocked"{continue}
                let params=&event["params"];
                let id=params["requestId"].as_str().unwrap_or("");
                match event["method"].as_str().unwrap_or("") {
                    "Network.requestWillBeSent"=>{
                        let url=params["request"]["url"].as_str().unwrap_or("");
                        if flow.confirmed && projection::endpoint(url)==Some("profile"){
                            flow.profile_url=Some(url.to_owned());
                            flow.profile_uifid=params["request"]["headers"].as_object().and_then(|headers|headers.iter().find(|(name,_)|name.eq_ignore_ascii_case("uifid"))).and_then(|(_,v)|v.as_str()).map(str::to_owned);
                        }
                    }
                    "Network.responseReceived"=>{
                        // CDP also reports CORS preflights under the same Passport URL. Their
                        // loadingFinished events have no retrievable application response body.
                        if let Some(kind)=projection::response_endpoint(params) {
                            if flow.requests.len()>=32{return Err("登录响应超过试验预算。".into())}
                            flow.requests.insert(id.into(),kind.into());
                        }
                    }
                    "Network.loadingFailed"=>{flow.requests.remove(id);}
                    "Network.loadingFinished"=>{
                        let Some(kind)=flow.requests.remove(id) else{continue};
                        if kind=="profile"{continue}
                        let body=match cdp.call(session.as_deref(),"Network.getResponseBody",json!({"requestId":id})).await {
                            Ok(body)=>body,Err(_)=>{blocked(public,"无法读取官方登录响应，已停止自动操作。请主动打开官方浏览器。");continue}
                        };
                        let raw=body["body"].as_str().filter(|v|v.len()<=1048576).ok_or("登录响应超过读取预算。")?;
                        let bytes=if body["base64Encoded"]==true {use base64::Engine;base64::engine::general_purpose::STANDARD.decode(raw).map_err(|_|"登录响应编码不兼容。")?}else{raw.as_bytes().to_vec()};
                        let value:Value=serde_json::from_slice(&bytes).map_err(|_|"官方登录响应格式不兼容。")?;
                        let Some(mut login)=projection::project(&kind,&value) else{blocked(public,"官方登录响应未识别，已停止自动操作。请主动打开官方浏览器。");continue};
                        if let Some(sms)=login["smsResult"].as_str(){
                            let matching=flow.pending_sms.as_ref().is_some_and(|(kind,_)|kind==sms);
                            if matching {flow.pending_sms=None;}
                            let mut state=public.lock().unwrap();
                            if login["accepted"]!=true{state.login["message"]="官方页面未接受短信操作，请检查验证码或等待重发倒计时。".into();}
                            else if sms=="send"{
                                state.sms_requested=true;
                                if state.login.get("verification").is_none(){state.login=json!({"status":"verification-required","verification":{"methods":[{"id":"mobile_sms_verify","label":"接收短信验证码","inApp":true}],"selectedMethod":"","maskedMobile":"","retryAfter":0,"codeLength":6}});}
                                state.login["verification"]["selectedMethod"]="mobile_sms_verify".into();
                                state.login["verification"]["maskedMobile"]=login["maskedMobile"].clone();
                                flow.cooldown=Some(Instant::now()+Duration::from_secs(login["retryAfter"].as_u64().unwrap_or(60)));
                            }else{state.sms_verified=true;state.login["message"]="短信验证已通过，等待官方最终登录确认。".into();}
                            continue;
                        }
                        if login["status"]=="signed-in"{flow.confirmed=true;flow.profile_url=None;login=json!({"status":"scanned","message":"官方已确认登录，正在检查 Cookie 与临时 Rust 会话…"});}
                        let mut state=public.lock().unwrap();
                        if login["status"]=="waiting" && login.get("qrImage").is_none()&& let Some(image)=state.login.get("qrImage"){login["qrImage"]=image.clone();}
                        state.login=login;
                    }
                    "Page.javascriptDialogOpening" | "Page.fileChooserOpened"=>blocked(public,"官方页面要求浏览器交互，请主动打开官方浏览器。"),
                    _=>{}
                }
            }
            _=tick.tick()=>{
                if process.exited(){return Err("试验浏览器已退出。".into())}
                if started.elapsed()>Duration::from_secs(600){return Err("试验达到十分钟预算，浏览器与临时 Profile 已结束。".into())}
                let visible=public.lock().unwrap().visible_fallback;
                if !visible && process.window_seen(){public.lock().unwrap().window_observation="window-observed".into();blocked(public,"观察到浏览器窗口出现，不满足严格隐藏要求。可主动打开官方浏览器继续诊断。");}
                if public.lock().unwrap().login["status"]=="blocked" {
                    if !flow.frozen {if let Some(session)=session.as_deref(){let _=cdp.call(Some(session),"Page.setWebLifecycleState",json!({"state":"frozen"})).await;}flow.frozen=true;public.lock().unwrap().phase="needs-browser".into();}
                    continue;
                }
                let Some(session)=session.as_deref() else{continue};
                if flow.pending_sms.as_ref().is_some_and(|(_,at)|at.elapsed()>Duration::from_secs(15)){blocked(public,"短信操作未在预算内返回确认，已停止重试。请主动打开官方浏览器。");continue}
                if !flow.login_clicked && started.elapsed()>Duration::from_secs(3) && public.lock().unwrap().login.get("qrImage").is_none(){
                    let result=match page_action(&mut cdp,session,"login",None).await { Ok(result)=>result, Err(_)=>{blocked(public,"官方登录入口操作不兼容，请主动打开官方浏览器。");continue} };
                    if result["ok"]==true{flow.login_clicked=true;}
                    else if started.elapsed()>Duration::from_secs(30){blocked(public,"未识别官方登录入口，已停止自动操作。请主动打开官方浏览器。");}
                }
                if flow.login_clicked && !flow.confirmed && started.elapsed()>Duration::from_secs(60) && public.lock().unwrap().login.get("qrImage").is_none() && public.lock().unwrap().login.get("verification").is_none(){blocked(public,"官方页面未提供可识别二维码，请主动打开官方浏览器。");continue}
                if public.lock().unwrap().login.get("verification").is_some(){
                    let view=match page_action(&mut cdp,session,"inspect",None).await {Ok(view)=>view,Err(_)=>{blocked(public,"官方验证页面操作不兼容，请主动打开官方浏览器。");continue}};
                    if view["ok"]!=true{blocked(public,"官方验证页面已改变，已停止自动操作。请主动打开官方浏览器。");continue}
                    let mut state=public.lock().unwrap();state.login["verification"]["maskedMobile"]=view["maskedMobile"].clone();
                    state.login["verification"]["retryAfter"]=json!(flow.cooldown.map(|at|at.saturating_duration_since(Instant::now()).as_secs().saturating_add(1)).unwrap_or(0).max(view["retryAfter"].as_u64().unwrap_or(0)));
                }
                if flow.confirmed {
                    let cookies=cdp.call(None,"Storage.getCookies",json!({})).await?;
                    let store=projection::cookie_store(&cookies)?;
                    if !projection::has_login(&store){continue}
                    public.lock().unwrap().browser_login=true;
                    if !flow.profile_navigation {flow.profile_navigation=true;cdp.call(Some(session),"Page.navigate",json!({"url":"https://www.douyin.com/user/self?showTab=favorite_collection"})).await?;}
                    if let Some(url)=flow.profile_url.take(){
                        let result=tokio::select!{_=cancel.cancelled()=>return Ok(()),result=check_rust_session(store,&agent,&url,flow.profile_uifid.as_deref())=>result};
                        let mut state=public.lock().unwrap();state.rust_session=result.into();state.phase="finished".into();state.login=json!({"status":"signed-in","message":"浏览器登录已确认；Rust 会话检查结果见下方。试验凭证不会保存。"});return Ok(());
                    }
                    if started.elapsed()>Duration::from_secs(570){public.lock().unwrap().rust_session="unavailable".into();return Err("浏览器登录已确认，但未获得可重放的自身资料请求。".into())}
                }
            }
        }
    }
}
/// Replay the browser's freshly signed self-profile read through the existing native transport.
/// This proves cookie handoff, not the portable adapter's independently generated a_bogus.
async fn check_rust_session(
    store: reqwest_cookie_store::CookieStore,
    agent: &str,
    url: &str,
    uifid: Option<&str>,
) -> &'static str {
    let client = reqwest::Client::builder()
        .cookie_provider(Arc::new(reqwest_cookie_store::CookieStoreMutex::new(store)))
        .user_agent(agent)
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(15))
        .build();
    let Ok(client) = client else {
        return "unavailable";
    };
    let mut request = client
        .get(url)
        .header("Referer", "https://www.douyin.com/")
        .header("Accept", "application/json, text/plain, */*");
    if let Some(uifid) = uifid {
        request = request.header("UIFID", uifid);
    }
    let Ok(mut response) = request.send().await else {
        return "unavailable";
    };
    if !response.status().is_success() {
        return "unavailable";
    }
    let mut bytes = Vec::new();
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) => {
                if bytes.len() + chunk.len() > 1048576 {
                    return "unavailable";
                }
                bytes.extend_from_slice(&chunk);
            }
            Ok(None) => break,
            Err(_) => return "unavailable",
        }
    }
    let Ok(value) = serde_json::from_slice::<Value>(&bytes) else {
        return "unavailable";
    };
    if projection::authenticated_profile(&value) {
        "signed-in"
    } else if matches!(value["status_code"].as_i64(), Some(8 | 9 | 10002)) {
        "signed-out"
    } else {
        "unavailable"
    }
}

fn require(window: &WebviewWindow) -> Result<(), String> {
    crate::browser::verification::require_main(window)?;
    require_development()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sms_guards_require_a_challenge_and_prevent_duplicate_or_early_retry() {
        let mut flow = BrowserFlow::new();
        let mut verification =
            json!({"methods":[{"id":"mobile_sms_verify","inApp":true}],"selectedMethod":""});
        assert!(sms_allowed(&flow, &Value::Null, None).is_err());
        assert!(sms_allowed(&flow, &verification, None).is_ok());
        assert!(sms_allowed(&flow, &verification, Some("123456")).is_err());
        verification["selectedMethod"] = "mobile_sms_verify".into();
        assert!(sms_allowed(&flow, &verification, Some("123456")).is_ok());
        assert!(sms_allowed(&flow, &verification, Some("bad")).is_err());
        flow.cooldown = Some(Instant::now() + Duration::from_secs(60));
        assert!(sms_allowed(&flow, &verification, None).is_err());
        assert!(sms_allowed(&flow, &verification, Some("123456")).is_ok());
        flow.pending_sms = Some(("validate".into(), Instant::now()));
        assert!(sms_allowed(&flow, &verification, Some("123456")).is_err());
        flow.pending_sms = None;
        flow.frozen = true;
        assert!(sms_allowed(&flow, &verification, Some("123456")).is_err());
    }
    #[test]
    fn stale_cancel_preserves_new_run_and_cancel_waits_for_teardown() {
        tauri::async_runtime::block_on(async {
            let manager = Manager::default();
            let public = Arc::new(Mutex::new(Snapshot {
                run_id: "new".into(),
                mode: Mode::Headless,
                phase: "waiting".into(),
                browser: "fixture".into(),
                version: String::new(),
                login: json!({"status":"waiting"}),
                browser_login: false,
                rust_session: "not-checked".into(),
                sms_requested: false,
                sms_verified: false,
                window_observation: "not-observed".into(),
                visible_fallback: false,
                cleanup: "pending".into(),
            }));
            let cancel = CancellationToken::new();
            let stopped = cancel.clone();
            let state = public.clone();
            let task = tauri::async_runtime::spawn(async move {
                stopped.cancelled().await;
                state.lock().unwrap().cleanup = "complete".into();
            });
            let (actions, _receiver) = mpsc::channel(1);
            *manager.current.lock().await = Some(Run {
                id: "new".into(),
                public,
                cancel,
                actions,
                task,
            });
            assert!(manager.cancel("old").await.unwrap().is_none());
            assert_eq!(manager.status("new").await.unwrap().cleanup, "pending");
            assert!(manager.status("old").await.is_err());
            assert_eq!(
                manager.cancel("new").await.unwrap().unwrap().cleanup,
                "complete"
            );
            assert!(manager.status("new").await.is_err());
        });
    }
}
#[tauri::command]
pub fn login_experiment_enabled(window: WebviewWindow) -> Result<bool, String> {
    crate::browser::verification::require_main(&window)?;
    Ok(enabled())
}
#[tauri::command]
pub async fn begin_login_experiment(
    window: WebviewWindow,
    state: State<'_, crate::state::RuntimeState>,
    mode: Mode,
) -> Result<String, String> {
    require(&window)?;
    state
        .experiments
        .start(state.directory.join("login-experiments"), mode)
        .await
}
#[tauri::command]
pub async fn poll_login_experiment(
    window: WebviewWindow,
    state: State<'_, crate::state::RuntimeState>,
    run_id: String,
) -> Result<Snapshot, String> {
    require(&window)?;
    state.experiments.status(&run_id).await
}
#[tauri::command]
pub async fn send_experiment_sms(
    window: WebviewWindow,
    state: State<'_, crate::state::RuntimeState>,
    run_id: String,
) -> Result<(), String> {
    require(&window)?;
    state.experiments.sms(&run_id, None).await
}
#[tauri::command]
pub async fn submit_experiment_sms(
    window: WebviewWindow,
    state: State<'_, crate::state::RuntimeState>,
    run_id: String,
    code: String,
) -> Result<(), String> {
    require(&window)?;
    state.experiments.sms(&run_id, Some(code)).await
}
#[tauri::command]
pub async fn cancel_login_experiment(
    window: WebviewWindow,
    state: State<'_, crate::state::RuntimeState>,
    run_id: String,
) -> Result<Option<Snapshot>, String> {
    require(&window)?;
    state.experiments.cancel(&run_id).await
}
#[tauri::command]
pub async fn open_experiment_browser(
    window: WebviewWindow,
    state: State<'_, crate::state::RuntimeState>,
    run_id: String,
) -> Result<(), String> {
    require(&window)?;
    state.experiments.visible(&run_id).await
}
