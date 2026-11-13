//! Fixed-resource isolated executor. Native channel/document identity binds every request;
//! package bytes, selected data, epoch and budgets never come from an executor assertion.
use super::{PluginAuthority, package_files::PackageFiles};
use am_plugin_runtime::{
    Caller, Clock, Field, HostObject, Level, Provenance, Selection, Value, Write, WriteRequest,
};
use serde_json::{Value as Json, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;

const DOCUMENT_CSP: &str = "default-src 'none'; script-src 'self'; worker-src 'self'; connect-src ipc: http://ipc.localhost; style-src 'none'; img-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const WORKER_CSP: &str = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'";
const HTML: &[u8] = b"<!doctype html><html><head><meta charset='utf-8'><title>Any Music isolated executor</title></head><body><script type='module' src='launcher.js'></script></body></html>";
// WebView2 may retain a closed environment briefly. Acceptance observers need a fresh
// debug port for each profile; release builds never enable this observer transport.
#[cfg(all(windows, feature = "s15-acceptance"))]
static OBSERVER_SEQUENCE: std::sync::atomic::AtomicU16 = std::sync::atomic::AtomicU16::new(10);
const LAUNCHER: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../target/s15-executor/launcher.js"
));
const WORKER: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../target/s15-executor/worker.js"
));

#[derive(Default)]
pub(crate) struct Executors {
    tasks: Mutex<BTreeMap<String, Arc<Task>>>,
    budget: Mutex<super::executor_budget::Budget>,
}
struct Task {
    authority: Arc<PluginAuthority>,
    caller: Caller,
    install: String,
    session: String,
    context: String,
    object: String,
    source: String,
    profile: std::path::PathBuf,
    declarative: Option<Json>,
    cancel: CancellationToken,
    transport_ready: std::sync::atomic::AtomicBool,
    #[cfg(windows)]
    transport_token: std::sync::atomic::AtomicI64,
    started: Instant,
    frame: Mutex<Frame>,
}
struct Frame {
    invocation: Json,
    bootstrap: bool,
    tx: Option<oneshot::Sender<Result<String, String>>>,
    responses: BTreeMap<String, (Vec<u8>, usize)>,
    requests: BTreeSet<String>,
}
impl Executors {
    pub(super) fn cancel_install(&self, id: &str) -> Result<(), String> {
        let tasks = self.tasks.lock().map_err(|_| "执行器不可用。")?;
        let mut failure = None;
        for task in tasks.values().filter(|t| t.install == id) {
            task.cancel.cancel();
            task.authority.cancel_network(id);
            // A failed close cannot acknowledge cancellation. Still close every other matching
            // session; grants/epochs stay unchanged and a retry can finish failed closures.
            if let Err(error) = task.authority.with(|r| r.host_end_session(&task.session)) {
                failure.get_or_insert(error);
            }
        }
        failure.map_or(Ok(()), Err)
    }
    pub(crate) fn stop_install(&self, id: &str) {
        if let Ok(tasks) = self.tasks.lock() {
            for task in tasks.values().filter(|t| t.install == id) {
                task.cancel.cancel();
            }
        }
    }
    pub(crate) fn stop_all(&self) {
        if let Ok(tasks) = self.tasks.lock() {
            for task in tasks.values() {
                task.cancel.cancel();
            }
        }
    }
}
fn scheme(slot: usize) -> String {
    format!("am-plugin-{slot}")
}
fn document(slot: usize) -> String {
    format!("https://{}.localhost/index.html", scheme(slot))
}
fn matches_document(window: &str, view: &str, url: &str, caller: &Caller) -> bool {
    window == caller.channel && view == caller.channel && url == caller.document
}

pub(crate) fn resources(
    slot: usize,
    caller: &str,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let path = request.uri().path();
    let asset = (caller == format!("plugin-executor-{slot}")
        && request.method() == "GET"
        && request.uri().query().is_none()
        && !request.headers().contains_key("service-worker"))
    .then_some(match path {
        "/index.html" => Some((HTML, "text/html; charset=utf-8", DOCUMENT_CSP)),
        "/launcher.js" => Some((LAUNCHER, "text/javascript; charset=utf-8", DOCUMENT_CSP)),
        "/worker.js" => Some((WORKER, "text/javascript; charset=utf-8", WORKER_CSP)),
        _ => None,
    })
    .flatten();
    let (bytes, mime, csp) = asset.unwrap_or((b"denied", "text/plain", "default-src 'none'"));
    tauri::http::Response::builder()
        .status(if asset.is_some() { 200 } else { 403 })
        .header("Content-Type", mime)
        .header("Content-Security-Policy", csp)
        .header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "no-store")
        .header("Cross-Origin-Resource-Policy", "same-origin")
        .header(
            "Permissions-Policy",
            "camera=(), microphone=(), geolocation=(), display-capture=()",
        )
        .body(bytes.to_vec())
        .expect("fixed resource response")
}
pub(crate) fn register(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    (0..3).fold(builder, |builder, slot| {
        builder.register_uri_scheme_protocol(scheme(slot), move |context, request| {
            resources(slot, context.webview_label(), request)
        })
    })
}
pub(crate) fn capability(slot: usize) -> String {
    json!({"identifier":format!("executor-{slot}"),"webviews":[format!("plugin-executor-{slot}")],"permissions":["allow-plugin-executor-relay"]}).to_string()
}

pub(crate) async fn execute(
    app: tauri::AppHandle,
    authority: Arc<PluginAuthority>,
    install: String,
    command: String,
    input_json: String,
) -> Result<String, String> {
    if !authority.admitted || authority.stopped.load(std::sync::atomic::Ordering::SeqCst) {
        return Err("当前 OS/WebView/Profile 尚未准入。".into());
    }
    let Prepared {
        slot,
        label,
        task,
        rx,
    } = prepare(
        &app,
        authority.clone(),
        install.clone(),
        command,
        input_json,
    )?;
    if let Some(catalog) = &task.declarative {
        let result = (|| {
            task.authority
                .with(|r| r.check_context(&task.caller, &task.context))?;
            let input = am_plugin_protocol::parse_json(
                task.frame.lock().map_err(|_| "帧不可用。")?.invocation["inputJson"]
                    .as_str()
                    .unwrap_or("")
                    .as_bytes(),
            )
            .map_err(|_| "输入无效。")?;
            let query = input["query"].as_str().unwrap_or_default().to_lowercase();
            let items: Vec<_> = catalog["items"]
                .as_array()
                .ok_or("目录无效。")?
                .iter()
                .filter(|i| {
                    i["title"]
                        .as_str()
                        .unwrap_or_default()
                        .to_lowercase()
                        .contains(&query)
                })
                .take(20)
                .cloned()
                .collect();
            let output = json!({"items":items,"pageNumber":1,"pageSize":20,"hasMore":false});
            let text = serde_json::to_string(&output).map_err(|_| "输出无效。")?;
            am_plugin_protocol::decode_value("WireTrackPage", text.as_bytes())
                .map_err(|_| "目录契约无效。")?;
            Ok(text)
        })();
        cleanup(&app, &label, &task);
        return result;
    }
    let build_app = app.clone();
    let window_label = label.clone();
    let allowed = document(slot);
    let directory = task.profile.clone();
    let (ready_tx, ready_rx) = oneshot::channel();
    let navigation_task = task.clone();
    let scheduled = app
        .run_on_main_thread(move || {
            if navigation_task.cancel.is_cancelled() {
                let _ = ready_tx.send(Err("执行器启动已取消。".to_owned()));
                return;
            }
            let window = WebviewWindowBuilder::new(
                &build_app,
                &window_label,
                WebviewUrl::External(allowed.parse().expect("fixed executor URL")),
            )
            .data_directory(directory)
            .visible(false)
            .focused(false)
            .incognito(true)
            .use_https_scheme(true)
            .devtools(false)
            .disable_drag_drop_handler()
            .on_download(|_, _| false)
            .on_navigation({
                let cancel = navigation_task.cancel.clone();
                let seen = std::sync::atomic::AtomicBool::new(false);
                move |url| {
                    if url.as_str() != allowed {
                        return false;
                    }
                    if seen.swap(true, std::sync::atomic::Ordering::SeqCst) {
                        cancel.cancel();
                        return false;
                    }
                    true
                }
            })
            .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
            .on_permission_request(|_, _| tauri::webview::PermissionResponse::Deny);
            #[cfg(all(windows, feature = "s15-acceptance"))]
            let window = if let Ok(port) = std::env::var("AM_S15_EXECUTOR_BASE_PORT")
                .unwrap_or_default()
                .parse::<u16>()
            {
                let port =
                    port + OBSERVER_SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                eprintln!(
                    "S15_EXECUTOR {}",
                    json!({"label":window_label,"port":port,"installId":navigation_task.install})
                );
                window.additional_browser_args(&format!(
                    "--remote-debugging-port={} --remote-debugging-address=127.0.0.1",
                    port
                ))
            } else {
                window
            };
            let result = window
                .build()
                .map(|window| {
                    #[cfg(windows)]
                    {
                        let task = navigation_task.clone();
                        if window
                            .with_webview(move |view| {
                                if let Ok(token) = super::executor_transport::install(view, slot) {
                                    task.transport_token
                                        .store(token, std::sync::atomic::Ordering::SeqCst);
                                    task.transport_ready
                                        .store(true, std::sync::atomic::Ordering::SeqCst);
                                } else {
                                    task.cancel.cancel();
                                }
                            })
                            .is_err()
                        {
                            navigation_task.cancel.cancel();
                        }
                    }
                    if navigation_task.cancel.is_cancelled() {
                        #[cfg(windows)]
                        let token = navigation_task
                            .transport_token
                            .load(std::sync::atomic::Ordering::SeqCst);
                        #[cfg(windows)]
                        let _ = window.with_webview(move |view| {
                            super::executor_transport::release(view, token)
                        });
                        let _ = window.destroy();
                        reclaim_profile(
                            navigation_task
                                .authority
                                .package_directory
                                .join("executor-profiles"),
                            navigation_task.profile.clone(),
                        );
                    }
                })
                .map_err(|_| "隔离执行器启动失败。".to_owned());
            let _ = ready_tx.send(result);
        })
        .map_err(|_| "执行器调度失败。".to_owned());
    if let Err(error) = scheduled {
        cleanup(&app, &label, &task);
        return Err(error);
    }
    let remaining = || Duration::from_secs(30).saturating_sub(task.started.elapsed());
    let start = tokio::select! {
        _=task.cancel.cancelled()=>Err("执行器启动已取消。".into()),
        value=tokio::time::timeout(remaining(),ready_rx)=>value.unwrap_or(Ok(Err("执行器启动超时。".into()))).unwrap_or_else(|_|Err("执行器启动失败。".into()))
    };
    let result = if let Err(error) = start {
        Err(error)
    } else {
        tokio::select! {_ = task.cancel.cancelled()=>Err("插件任务已取消或撤权。".into()), value=tokio::time::timeout(remaining(),rx)=>value.map_err(|_|"插件任务超过总截止时间。".to_owned()).and_then(|v|v.map_err(|_|"执行器通道已关闭。".to_owned())).and_then(|v|v)}
    };
    if result.is_err()
        && let Ok(mut budget) = app.state::<Executors>().budget.lock()
    {
        budget.failed(&install, Instant::now());
    }
    cleanup(&app, &label, &task);
    result
}

struct Prepared {
    slot: usize,
    label: String,
    task: Arc<Task>,
    rx: oneshot::Receiver<Result<String, String>>,
}

fn prepare(
    app: &tauri::AppHandle,
    authority: Arc<PluginAuthority>,
    install: String,
    command: String,
    input_json: String,
) -> Result<Prepared, String> {
    let state = app.state::<Executors>();
    authority.with(|_| Ok(()))?;
    if input_json.len() > 16384 {
        return Err("输入超过 16 KiB。".into());
    }
    state
        .budget
        .lock()
        .map_err(|_| "调度不可用。")?
        .admit(&install, Instant::now())?;
    let (tx, rx) = oneshot::channel();
    let mut tasks = state.tasks.lock().map_err(|_| "执行器不可用。")?;
    let slot = (0..3)
        .find(|slot| {
            !tasks.contains_key(&format!("plugin-executor-{slot}"))
                && app
                    .get_webview_window(&format!("plugin-executor-{slot}"))
                    .is_none()
        })
        .ok_or("执行器全局内存预算已用尽。")?;
    let label = format!("plugin-executor-{slot}");
    let caller = Caller {
        channel: label.clone(),
        document: document(slot),
        account_scope: "product".into(),
    };
    let mut files =
        PackageFiles::open(authority.package_directory.clone()).map_err(|_| "插件目录繁忙。")?;
    let loaded = authority.with(|runtime| {
        runtime.host_package_session(&install, caller.clone(), &mut files, &authority.policy())
    })?;
    let package =
        am_plugin_package::verify(loaded.package_bytes, || false).map_err(|_| "插件校验失败。")?;
    let object_id = format!("executor-input:{}", uuid::Uuid::new_v4());
    let setup = (|| {
        let parsed = am_plugin_protocol::parse_json(input_json.as_bytes())
            .map_err(|_| "插件输入超出限制。")?;
        if !package.manifest().commands.iter().any(|c| c.id == command) {
            return Err("未声明的插件命令。".into());
        }
        // A declared command name is untrusted metadata, never an operation or a
        // provenance label. In particular a music.* name cannot downgrade selected L2.
        let operation = "command.run";
        let catalog_query = command == "search"
            && package.manifest().contributions.iter().any(|c| {
                c.point_id.as_str() == "music.sources"
                    && c.provider_id.as_deref() == Some(package.manifest().id.as_str())
            })
            && parsed.as_object().is_some_and(|o| {
                o.keys()
                    .all(|k| matches!(k.as_str(), "query" | "pageNumber" | "pageSize"))
            })
            && parsed["query"].as_str().is_some_and(|q| q.len() <= 4096)
            && parsed
                .get("pageNumber")
                .is_none_or(|v| v.as_u64().is_some_and(|n| (1..=50).contains(&n)))
            && parsed
                .get("pageSize")
                .is_none_or(|v| v.as_u64().is_some_and(|n| (1..=100).contains(&n)));
        let level = if catalog_query { Level::L1 } else { Level::L2 };

        let context = authority.with(|runtime| {
            runtime.host_publish(HostObject {
                id: object_id.clone(),
                account_scope: caller.account_scope.clone(),
                version: 1,
                fields: [(
                    Field::Note,
                    Value {
                        text: input_json.clone(),
                        provenance: Provenance {
                            level,
                            source_install: install.clone(),
                            source_context: String::new(),
                            generation: 0,
                            data_generation: 0,
                        },
                    },
                )]
                .into(),
            })?;
            let ctx = runtime.host_context(
                &loaded.session_id,
                &uuid::Uuid::new_v4().to_string(),
                vec![Selection {
                    id: object_id.clone(),
                    version: 1,
                    fields: vec![Field::Note],
                }],
            )?;
            runtime.read(&caller, &ctx, &object_id)?;
            Ok(ctx)
        })?;
        let invocation = json!({"operation":operation,"commandId":command,"inputJson":serde_json::to_string(&parsed).map_err(|_|"输入无效。")?,"contextRef":context,"sequence":0,"deadlineMs":super::NativeClock.now_ms()+30000});
        am_plugin_protocol::decode_value(
            "GuestInvocation",
            serde_json::to_string(&invocation).unwrap().as_bytes(),
        )
        .map_err(|_| "执行器输入不兼容。")?;
        Ok(Arc::new(Task {
            authority: authority.clone(),
            caller,
            install: install.clone(),
            session: loaded.session_id.clone(),
            context,
            object: object_id.clone(),
            declarative: if package.manifest().execution.as_str() == "declarative" {
                Some(
                    am_plugin_protocol::parse_json(
                        package
                            .payload("assets/source.json")
                            .ok_or("不支持的声明式目录。")?,
                    )
                    .map_err(|_| "目录无效。")?,
                )
            } else {
                None
            },
            profile: authority
                .package_directory
                .join("executor-profiles")
                .join(uuid::Uuid::new_v4().to_string()),
            source: if package.manifest().execution.as_str() == "sandbox-code" {
                String::from_utf8(
                    package
                        .payload("dist/main.js")
                        .ok_or("缺少代码入口。")?
                        .to_vec(),
                )
                .map_err(|_| "入口编码无效。")?
            } else {
                String::new()
            },
            cancel: CancellationToken::new(),
            transport_ready: std::sync::atomic::AtomicBool::new(false),
            #[cfg(windows)]
            transport_token: std::sync::atomic::AtomicI64::new(0),
            started: Instant::now(),
            frame: Mutex::new(Frame {
                invocation,
                bootstrap: false,
                tx: Some(tx),
                responses: BTreeMap::new(),
                requests: BTreeSet::new(),
            }),
        }))
    })();
    let task = match setup {
        Ok(task) => task,
        Err(error) => {
            let _ = authority.with(|r| {
                r.host_end_session(&loaded.session_id)
                    .and_then(|_| r.host_forget_object("product", &object_id))
            });
            return Err(error);
        }
    };
    tasks.insert(label.clone(), task.clone());
    Ok(Prepared {
        slot,
        label,
        task,
        rx,
    })
}

fn cleanup(app: &tauri::AppHandle, label: &str, task: &Task) {
    task.cancel.cancel();
    if let Some(window) = app.get_webview_window(label) {
        #[cfg(windows)]
        let token = task
            .transport_token
            .load(std::sync::atomic::Ordering::SeqCst);
        #[cfg(windows)]
        let _ = window.with_webview(move |view| super::executor_transport::release(view, token));
        let _ = window.destroy();
    }
    if let Ok(mut tasks) = app.state::<Executors>().tasks.lock() {
        tasks.remove(label);
    }
    task.authority.cancel_network(&task.install);
    reclaim_profile(
        task.authority.package_directory.join("executor-profiles"),
        task.profile.clone(),
    );
    let _ = task.authority.with(|r| {
        r.host_end_session(&task.session)?;
        r.host_forget_object(&task.caller.account_scope, &task.object)
    });
}

fn reclaim_profile(root: std::path::PathBuf, path: std::path::PathBuf) {
    std::thread::spawn(move || {
        // Only a generated direct child of our private executor root is removable. Resolve
        // both sides before recursive removal; a junction redirected outside is retained.
        for attempt in 0..300 {
            let checked = root
                .canonicalize()
                .ok()
                .zip(path.canonicalize().ok())
                .is_some_and(|(root, path)| {
                    path.parent() == Some(root.as_path())
                        && path
                            .file_name()
                            .is_some_and(|n| uuid::Uuid::parse_str(&n.to_string_lossy()).is_ok())
                });
            if !checked {
                break;
            }
            match std::fs::remove_dir_all(&path) {
                Ok(()) => break,
                Err(error) => {
                    #[cfg(feature = "s15-acceptance")]
                    if attempt == 0 || attempt == 299 {
                        eprintln!(
                            "S15_PROFILE_CLEANUP {}",
                            serde_json::json!({"attempt":attempt,"osCode":error.raw_os_error()})
                        );
                    }
                    #[cfg(not(feature = "s15-acceptance"))]
                    let _ = (attempt, error);
                }
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    });
}

fn broker(task: &Task, frame: &mut Frame, request: &Json) -> Result<Json, String> {
    if task.cancel.is_cancelled() {
        return Err("执行器已取消。".into());
    }
    let op = request["operation"].as_str().ok_or("操作无效。")?;
    let payload = &request["input"];
    let capability = match op {
        "state.get" => "state.read",
        "state.set" => "state.write",
        "crypto.sha256" => "crypto.sha256",
        _ => "network.publicHttps",
    };
    task.authority
        .with(|r| r.check_capability(&task.caller, &task.context, capability))?;
    let text = |key: &str| {
        payload[key]
            .as_str()
            .ok_or_else(|| "请求字段无效。".to_owned())
    };
    match op {
        "state.get" => {
            let value = task.authority.with(|r| {
                r.state_get(&task.caller, &task.context, text("key").unwrap_or_default())
            })?;
            Ok(value.map_or(
                json!({"value":null,"version":0}),
                |v| json!({"value":v.text,"version":v.version}),
            ))
        }
        "state.set" => {
            let value = text("value")?.to_owned();
            let key = text("key")?.to_owned();
            let version = task.authority.with(|r| {
                // The relay may have been admitted before cancellation and waited for authority.
                if task.cancel.is_cancelled() {
                    return Err(am_plugin_runtime::Error::Denied);
                }
                let ticket = r.prepare(
                    &task.caller,
                    WriteRequest {
                        operation_id: text("operationId")
                            .map_err(|_| am_plugin_runtime::Error::Corrupt)?
                            .into(),
                        context_id: task.context.clone(),
                        expected_version: payload["expectedVersion"]
                            .as_u64()
                            .ok_or(am_plugin_runtime::Error::Corrupt)?,
                        write: Write::State {
                            key: key.clone(),
                            schema_version: payload["schemaVersion"]
                                .as_u64()
                                .ok_or(am_plugin_runtime::Error::Corrupt)?,
                            text: value.clone(),
                        },
                    },
                )?;
                r.commit(&task.caller, &ticket)
            })?;
            Ok(json!({"value":value,"version":version}))
        }
        "crypto.sha256" => Ok(json!({"hex":am_plugin_package::hash(text("text")?.as_bytes())})),
        "network.request" => {
            if frame.responses.len() >= 4 {
                return Err("响应句柄预算已用尽。".into());
            }
            let gate = task.authority.network_gate(
                task.caller.clone(),
                &task.context,
                am_plugin_net::Exit::Sandbox,
            )?;
            let mut query =
                am_plugin_net::Request::get(text("url")?.into(), am_plugin_net::Exit::Sandbox);
            // The admitted text bridge is a small-catalog surface. Stop at transport,
            // before a guest can inspect size or any response bytes are delivered.
            query.max_bytes = 65536;
            query.method = text("method")?.into();
            query.body = payload["body"]
                .as_str()
                .unwrap_or_default()
                .as_bytes()
                .to_vec();
            let mut bytes = vec![];
            let response = tauri::async_runtime::block_on(
                am_plugin_net::Network::default().execute(&gate, query, &mut bytes),
            )
            .map_err(|_| "匿名请求被拒绝、失败或超出预算。")?;
            let id = uuid::Uuid::new_v4().to_string();
            let size = bytes.len();
            frame.responses.insert(id.clone(), (bytes, 0));
            Ok(
                json!({"responseRef":id,"status":response.status,"sizeBytes":size,"expiresAtMs":super::NativeClock.now_ms()+30000}),
            )
        }
        "network.readResponse" => {
            let (bytes, next) = frame
                .responses
                .get_mut(text("responseRef")?)
                .ok_or("响应句柄已失效。")?;
            let offset = payload["offset"].as_u64().ok_or("偏移无效。")? as usize;
            let length = (payload["length"].as_u64().ok_or("长度无效。")? as usize).min(16384);
            if offset != *next || length > 16384 || offset > bytes.len() {
                return Err("响应读取越界或重放。".into());
            }
            let mut end = (offset + length).min(bytes.len());
            while end > offset && end < bytes.len() && bytes[end] & 0xc0 == 0x80 {
                end -= 1;
            }
            if end == offset && end < bytes.len() {
                return Err("响应块不足以容纳 UTF-8 字符。".into());
            }
            let value =
                std::str::from_utf8(&bytes[offset..end]).map_err(|_| "只支持 UTF-8 文本响应。")?;
            *next = end;
            Ok(json!({"text":value,"nextOffset":end,"done":end==bytes.len()}))
        }
        "network.releaseResponse" => {
            frame.responses.remove(text("responseRef")?);
            Ok(json!({}))
        }
        _ => Err("未知具名能力。".into()),
    }
}

#[tauri::command]
pub(crate) async fn plugin_executor_relay(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    message: String,
) -> Result<Json, String> {
    let label = webview.label();
    let url = webview.url().map_err(|_| "调用来源不可用。")?;
    let task = app
        .state::<Executors>()
        .tasks
        .lock()
        .map_err(|_| "执行器不可用。")?
        .get(label)
        .cloned()
        .ok_or("未知执行器。")?;
    if !matches_document(webview.window().label(), label, url.as_str(), &task.caller)
        || task.cancel.is_cancelled()
        || task.started.elapsed() > Duration::from_secs(30)
    {
        return Err("执行器身份或截止时间无效。".into());
    }
    let value = am_plugin_protocol::parse_json(message.as_bytes()).map_err(|_| "中继消息无效。")?;
    // The initial trusted document can start loading before WebView2's native
    // all-source filter is attached. Guest bytes stay native until it is ready.
    while !task
        .transport_ready
        .load(std::sync::atomic::Ordering::SeqCst)
    {
        if task.cancel.is_cancelled() || task.started.elapsed() > Duration::from_secs(30) {
            return Err("执行器传输不可用。".into());
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    tauri::async_runtime::spawn_blocking(move||{
        if task.cancel.is_cancelled(){return Err("执行器已取消。".into());}
        task.authority.with(|r|r.check_context(&task.caller,&task.context))?;
        let mut frame=task.frame.lock().map_err(|_|"执行器帧不可用。")?;
        match value["type"].as_str(){
            Some("bootstrap") if value.as_object().is_some_and(|o|o.len()==1)&&!frame.bootstrap=>{frame.bootstrap=true;Ok(json!({"source":task.source,"inputJson":serde_json::to_string(&frame.invocation).unwrap()}))},
            Some("result") if value.as_object().is_some_and(|o|o.len()==3)&&frame.bootstrap&&frame.tx.is_some()&&value["sequence"]==frame.invocation["sequence"]=>{
                let raw=value["output"].as_str().ok_or("输出无效。")?;
                let step=am_plugin_protocol::decode_value("GuestStep",raw.as_bytes()).map_err(|_|"插件输出不符合契约。")?;
                if step["kind"]=="complete" {
                    let output=step["outputJson"].as_str().ok_or("输出无效。")?.to_owned();am_plugin_protocol::parse_json(output.as_bytes()).map_err(|_|"输出无效。")?;
                    task.authority.with(|r|r.check_context(&task.caller,&task.context))?;
                    if let Some(tx)=frame.tx.take(){let _=tx.send(Ok(output));} return Ok(json!({"done":true}));
                }
                let request=&step["request"];let sequence=frame.invocation["sequence"].as_u64().ok_or("序号无效。")?;
                if sequence>=15||request["deadlineMs"].as_u64().unwrap_or(0)<=super::NativeClock.now_ms()||request["contextRef"]!=task.context||request["requestId"]!=format!("call-{sequence}")||request["deadlineMs"].as_u64().unwrap_or(u64::MAX)>frame.invocation["deadlineMs"].as_u64().unwrap_or(0)||!frame.requests.insert(request["requestId"].as_str().unwrap_or_default().into()){return Err("请求序号、上下文或期限无效。".into())}
                app.state::<Executors>().budget.lock().map_err(|_|"调度不可用。")?.admit(&task.install,Instant::now())?;
                let result=broker(&task,&mut frame,request);
                let response=match result{Ok(result)=>json!({"wireVersion":1,"requestId":request["requestId"],"operation":request["operation"],"ok":true,"result":result}),Err(_)=>json!({"wireVersion":1,"requestId":request["requestId"],"operation":request["operation"],"ok":false,"error":{"code":"access-denied","message":"宿主拒绝操作或能力不可用。","isRetryable":false}})};
                am_plugin_protocol::decode_value("HostResponse",serde_json::to_string(&response).unwrap().as_bytes()).map_err(|_|"能力响应不兼容。")?;
                frame.invocation["sequence"]=json!(sequence+1);frame.invocation["checkpointJson"]=step["checkpointJson"].clone();frame.invocation["response"]=response;
                Ok(json!({"source":task.source,"inputJson":serde_json::to_string(&frame.invocation).unwrap()}))
            },
            _=>{task.cancel.cancel();Err("非法、重复或失败的执行器消息。".into())},
        }
    }).await.map_err(|_|"执行器中继失败。")?
}

#[cfg(test)]
mod cancellation_tests;

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fixed_resources_reject_cross_subject_paths_queries_and_service_workers() {
        for slot in 0..3 {
            for path in ["/index.html", "/launcher.js", "/worker.js"] {
                let owner = format!("plugin-executor-{slot}");
                let response = resources(
                    slot,
                    &owner,
                    tauri::http::Request::get(path).body(vec![]).unwrap(),
                );
                assert_eq!(response.status(), 200);
                if path == "/worker.js" {
                    assert!(
                        response.headers()["Content-Security-Policy"]
                            .to_str()
                            .unwrap()
                            .contains("connect-src 'none'")
                    );
                }
                assert_eq!(
                    resources(
                        slot,
                        "main",
                        tauri::http::Request::get(path).body(vec![]).unwrap()
                    )
                    .status(),
                    403
                );
                assert_eq!(
                    resources(
                        slot,
                        &owner,
                        tauri::http::Request::get(format!("{path}?source=evil"))
                            .body(vec![])
                            .unwrap()
                    )
                    .status(),
                    403
                );
                assert_eq!(
                    resources(
                        slot,
                        &owner,
                        tauri::http::Request::get(path)
                            .header("Service-Worker", "script")
                            .body(vec![])
                            .unwrap()
                    )
                    .status(),
                    403
                );
            }
        }
    }
    #[test]
    fn executor_acl_grants_only_its_relay_and_never_inherits_main() {
        let mut context = crate::application_context();
        let authority = context.runtime_authority_mut();
        for slot in 0..3 {
            authority.add_capability(capability(slot)).unwrap();
        }
        let registry = include_str!("../ipc.rs")
            .split_once("tauri::generate_handler![")
            .unwrap()
            .1
            .split(']')
            .next()
            .unwrap();
        for path in registry.split(',').map(str::trim).filter(|p| !p.is_empty()) {
            let command = path.rsplit("::").next().unwrap();
            for slot in 0..3 {
                let label = format!("plugin-executor-{slot}");
                let own = authority
                    .resolve_access(command, &label, &label, &tauri::ipc::Origin::Local)
                    .is_some();
                assert_eq!(
                    own,
                    command == "plugin_executor_relay",
                    "{label}: {command}"
                );
                assert_eq!(
                    authority
                        .resolve_access(command, "main", &label, &tauri::ipc::Origin::Local)
                        .is_some(),
                    command == "plugin_executor_relay"
                );
            }
        }
        // Tauri binds the relay to a WebView label. Its native window/document check is
        // the second boundary: a child of main cannot reuse that label's session.
        let caller = Caller {
            channel: "plugin-executor-0".into(),
            document: document(0),
            account_scope: "product".into(),
        };
        assert!(matches_document(
            "plugin-executor-0",
            "plugin-executor-0",
            &document(0),
            &caller
        ));
        assert!(!matches_document(
            "main",
            "plugin-executor-0",
            &document(0),
            &caller
        ));
        assert!(!matches_document(
            "plugin-executor-0",
            "plugin-executor-0",
            "https://evil.invalid",
            &caller
        ));
    }
}
