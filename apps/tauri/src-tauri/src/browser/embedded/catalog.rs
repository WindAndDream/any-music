use crate::{browser::verification::require_main, state::RuntimeState};
use serde::Deserialize;
use serde_json::{Value, json};
use tauri::{State, Webview};

use super::Bounds;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Request {
    lease: String,
    account_id: String,
    query: String,
    bounds: Option<Bounds>,
    snapshot: Option<Value>,
}

#[tauri::command]
pub async fn sync_catalog_webview(
    webview: Webview,
    state: State<'_, RuntimeState>,
    request: Request,
) -> Result<Value, String> {
    require_main(&webview)?;
    crate::model::validate_id(&request.lease)?;
    crate::model::validate_id(&request.account_id)?;
    if request.query.is_empty()
        || request.query.chars().count() > 200
        || request.bounds.is_some_and(|bounds| {
            !bounds.valid()
                || bounds.x < 0.0
                || bounds.y < 0.0
                || bounds.width > 16_384.0
                || bounds.height > 16_384.0
        })
        || request.snapshot.as_ref().is_some_and(|snapshot| {
            snapshot
                .get("tracks")
                .is_some_and(|rows| rows.as_array().is_none_or(|rows| rows.len() > 10_000))
                || snapshot.to_string().len() > 8 * 1024 * 1024
        })
    {
        return Err("invalid-input:音乐列表视口或结果超过显示预算。".into());
    }
    #[cfg(windows)]
    {
        match request.bounds {
            Some(bounds) => state.embedded.catalog.sync(request, bounds).await,
            None => windows::park(webview, request.lease).await,
        }
    }
    #[cfg(not(windows))]
    {
        let _ = state;
        Ok(json!({"ready": false, "supported": false}))
    }
}

#[tauri::command]
pub fn close_catalog_webview(
    webview: Webview,
    state: State<'_, RuntimeState>,
    lease: String,
) -> Result<(), String> {
    require_main(&webview)?;
    crate::model::validate_id(&lease)?;
    #[cfg(windows)]
    state.embedded.catalog.close(&lease);
    #[cfg(not(windows))]
    let _ = state;
    Ok(())
}

#[cfg(windows)]
pub(super) use windows::Surface;

#[cfg(windows)]
mod windows {
    use super::{Bounds, Request, Value, Webview, json};
    use crate::browser::embedded::HIDDEN_ORIGIN;
    use std::{collections::HashMap, sync::Mutex, time::Duration};
    use tauri::{LogicalPosition, LogicalSize, Manager, Rect};

    const RENDERER: &str = include_str!(concat!(env!("OUT_DIR"), "/catalog-webview.js"));

    struct Candidate {
        webview: Webview,
        account: String,
        query: String,
        origin: &'static str,
        reader_closed: bool,
    }

    struct Lease {
        id: String,
        label: String,
        context: Option<i64>,
        bridge_key: String,
        bounds: Option<Bounds>,
        applied: Option<Bounds>,
        document_epoch: u64,
    }

    #[derive(Default)]
    struct Resources {
        candidates: HashMap<String, Candidate>,
        current: Option<Lease>,
    }

    /// The native account transport lends its actual result target to one visible viewport.
    /// The document can only render a display projection and report events through its isolated world.
    #[derive(Default)]
    pub(in crate::browser) struct Surface {
        resources: Mutex<Resources>,
    }

    impl Surface {
        pub(in crate::browser) fn publish(
            &self,
            webview: Webview,
            account: &str,
            query: &str,
            origin: &'static str,
        ) {
            let mut resources = self.resources.lock().unwrap();
            resources
                .candidates
                .entry(webview.label().to_owned())
                .or_insert(Candidate {
                    webview,
                    account: account.to_owned(),
                    query: query.to_owned(),
                    origin,
                    reader_closed: false,
                });
        }

        pub(in crate::browser) fn reader_closed(&self, label: &str) -> bool {
            let mut resources = self.resources.lock().unwrap();
            let active = resources
                .current
                .as_ref()
                .is_some_and(|lease| lease.label == label);
            if !active {
                resources.candidates.remove(label);
                return false;
            }
            let Some(target) = resources.candidates.get_mut(label) else {
                return false;
            };
            // A visible target can outlive the reader until the restored list paints.
            target.reader_closed = true;
            true
        }

        pub(in crate::browser) fn navigation(&self, label: &str) {
            let mut resources = self.resources.lock().unwrap();
            if let Some(lease) = resources
                .current
                .as_mut()
                .filter(|lease| lease.label == label)
            {
                lease.context = None;
                lease.applied = None;
                lease.document_epoch += 1;
                if let Some(target) = resources.candidates.get(label) {
                    hide(&target.webview);
                }
            }
        }

        pub(in crate::browser) fn invalidate_account(&self, account: &str) {
            let mut resources = self.resources.lock().unwrap();
            if resources.current.as_ref().is_some_and(|lease| {
                resources
                    .candidates
                    .get(&lease.label)
                    .is_some_and(|target| target.account == account)
            }) {
                release(&mut resources);
            }
            resources.candidates.retain(|_, target| {
                if target.account != account {
                    return true;
                }
                if target.reader_closed {
                    let _ = target.webview.close();
                }
                false
            });
        }

        pub(in crate::browser) fn close(&self, id: &str) {
            let mut resources = self.resources.lock().unwrap();
            if resources
                .current
                .as_ref()
                .is_some_and(|lease| lease.id == id)
            {
                release(&mut resources);
            }
        }

        fn park(&self, id: &str) {
            let mut resources = self.resources.lock().unwrap();
            let Resources {
                current,
                candidates,
            } = &mut *resources;
            if let Some(lease) = current.as_mut().filter(|lease| lease.id == id) {
                if let Some(target) = candidates.get(&lease.label) {
                    hide(&target.webview);
                }
                lease.bounds = None;
                lease.applied = None;
            }
        }

        pub(super) async fn sync(&self, request: Request, bounds: Bounds) -> Result<Value, String> {
            let label = {
                let mut resources = self.resources.lock().unwrap();
                let current = resources
                    .current
                    .as_ref()
                    .filter(|lease| lease.id == request.lease);
                if let Some(current) = current {
                    let label = current.label.clone();
                    resources.current.as_mut().unwrap().bounds = Some(bounds);
                    label
                } else {
                    let mut matches = resources.candidates.iter().filter(|(_, target)| {
                        target.account == request.account_id
                            && target.query == request.query
                            && !target.reader_closed
                    });
                    let Some((label, _)) = matches.next().filter(|_| matches.next().is_none())
                    else {
                        return Ok(json!({"ready": false}));
                    };
                    let label = label.clone();
                    release(&mut resources);
                    resources.current = Some(Lease {
                        id: request.lease.clone(),
                        label: label.clone(),
                        bounds: Some(bounds),
                        context: None,
                        bridge_key: format!("catalog-{}", uuid::Uuid::new_v4()),
                        applied: None,
                        document_epoch: 0,
                    });
                    label
                }
            };
            let (webview, origin, mut context, bridge_key, document_epoch) = {
                let resources = self.resources.lock().unwrap();
                let Some(lease) = resources
                    .current
                    .as_ref()
                    .filter(|lease| lease.id == request.lease && lease.label == label)
                else {
                    return Ok(json!({"ready": false}));
                };
                let Some(target) = resources.candidates.get(&label) else {
                    return Ok(json!({"ready": false}));
                };
                if lease.applied.is_none()
                    && request.snapshot.is_some()
                    && let Some(bounds) = lease.bounds
                {
                    // Paint at the actual list size while the result page is parked.
                    place(
                        &target.webview,
                        Bounds {
                            x: HIDDEN_ORIGIN,
                            y: 0.0,
                            ..bounds
                        },
                    )?;
                }
                (
                    target.webview.clone(),
                    target.origin,
                    lease.context,
                    lease.bridge_key.clone(),
                    lease.document_epoch,
                )
            };
            let result = async {
                if context.is_none() {
                    if request.snapshot.is_none() {
                        return Ok(json!({"ready": false}));
                    }
                    let frame = devtools(&webview, "Page.getFrameTree", json!({})).await?;
                    let frame = &frame["frameTree"]["frame"];
                    let approved = frame["url"].as_str().and_then(|url| reqwest::Url::parse(url).ok())
                        .is_some_and(|url| url.origin().ascii_serialization() == origin);
                    let Some(frame_id) = frame["id"].as_str().filter(|_| approved) else {
                        return Ok(json!({"ready": false}));
                    };
                    let world = devtools(&webview, "Page.createIsolatedWorld",
                        json!({"frameId":frame_id,"worldName":format!("any-music-catalog-{}", request.lease)})).await?;
                    let id = world["executionContextId"].as_i64().ok_or("network-error:无法隔离音乐列表脚本。")?;
                    context = Some(id);
                    let expression = format!("{RENDERER}\n(() => {{ const bundle = AnyMusicCatalogBundle; AnyMusicCatalogBundle = undefined; return bundle.install({}, {}, {}); }})()",
                        json!(origin), json!(request.lease), json!(bridge_key));
                    if evaluate(&webview, id, expression).await? != true {
                        return Ok(json!({"ready": false}));
                    }
                }
                let argument = request.snapshot.as_ref()
                    .map(|snapshot| format!("JSON.parse({})", json!(snapshot.to_string())))
                    .unwrap_or_default();
                let expression = format!("globalThis[{}]?.sync({argument})", json!(bridge_key));
                evaluate(&webview, context.unwrap(), expression).await
            }.await;
            let (reply, outcome) = tokio::sync::oneshot::channel();
            let target = webview.clone();
            webview
                .run_on_main_thread(move || {
                    let value = target
                        .try_state::<crate::state::RuntimeState>()
                        .map_or_else(
                            || Ok(json!({"ready": false})),
                            |state| {
                                state.embedded.catalog.commit(
                                    &request.lease,
                                    target.clone(),
                                    document_epoch,
                                    context,
                                    bridge_key,
                                    result,
                                )
                            },
                        );
                    let _ = reply.send(value);
                })
                .map_err(|_| "network-error:无法更新音乐列表视口。".to_owned())?;
            outcome
                .await
                .map_err(|_| "operation-cancelled:音乐列表已结束。".to_owned())?
        }

        fn commit(
            &self,
            id: &str,
            webview: Webview,
            document_epoch: u64,
            context: Option<i64>,
            bridge_key: String,
            result: Result<Value, String>,
        ) -> Result<Value, String> {
            // Navigation starts and visibility commits are serialized on the UI thread.
            let mut resources = self.resources.lock().unwrap();
            let Some(lease) = resources.current.as_mut().filter(|lease| {
                lease.id == id
                    && lease.label == webview.label()
                    && lease.document_epoch == document_epoch
            }) else {
                clean_context(webview, context, bridge_key);
                return Ok(json!({"ready": false}));
            };
            match result {
                Ok(value) if value["ready"] == true => {
                    lease.context = context;
                    if let Some(bounds) = lease.bounds {
                        if lease.applied != Some(bounds) {
                            place(&webview, bounds)?;
                            lease.applied = Some(bounds);
                        }
                        return Ok(value);
                    }
                }
                _ => {
                    lease.context = None;
                    lease.applied = None;
                    hide(&webview);
                    clean_context(webview, context, bridge_key);
                }
            }
            Ok(json!({"ready": false}))
        }
    }

    pub(super) async fn park(main: Webview, id: String) -> Result<Value, String> {
        let (reply, outcome) = tokio::sync::oneshot::channel();
        let target = main.clone();
        // A position change sent from the IPC worker would only queue a UI event.
        // Let the dialog open once the child has actually been moved on the UI thread.
        main.run_on_main_thread(move || {
            if let Some(state) = target.try_state::<crate::state::RuntimeState>() {
                state.embedded.catalog.park(&id);
            }
            let _ = reply.send(());
        })
        .map_err(|_| "network-error:无法移开音乐列表页面。".to_owned())?;
        outcome
            .await
            .map_err(|_| "operation-cancelled:音乐列表已结束。".to_owned())?;
        Ok(json!({"ready": false}))
    }

    fn release(resources: &mut Resources) {
        let Some(lease) = resources.current.take() else {
            return;
        };
        let Some(target) = resources.candidates.get(&lease.label) else {
            return;
        };
        hide(&target.webview);
        if target.reader_closed {
            let _ = target.webview.close();
            resources.candidates.remove(&lease.label);
        } else {
            clean_context(target.webview.clone(), lease.context, lease.bridge_key);
        }
    }

    fn clean_context(webview: Webview, context: Option<i64>, bridge_key: String) {
        if let Some(context) = context {
            tauri::async_runtime::spawn(async move {
                let _ = evaluate(
                    &webview,
                    context,
                    format!("globalThis[{}]?.close()", json!(bridge_key)),
                )
                .await;
            });
        }
    }

    fn hide(webview: &Webview) {
        let _ = webview.set_position(LogicalPosition::new(HIDDEN_ORIGIN, 0.0));
    }

    fn place(webview: &Webview, bounds: Bounds) -> Result<(), String> {
        webview
            .set_bounds(Rect {
                position: LogicalPosition::new(bounds.x, bounds.y).into(),
                size: LogicalSize::new(bounds.width, bounds.height).into(),
            })
            .map_err(|_| "network-error:无法显示音乐列表页面。".to_owned())
    }

    async fn evaluate(
        webview: &Webview,
        context: i64,
        expression: String,
    ) -> Result<Value, String> {
        let response = devtools(webview, "Runtime.evaluate", json!({
            "contextId":context,"expression":expression,"returnByValue":true,"awaitPromise":true,
        })).await?;
        if response.get("exceptionDetails").is_some() {
            return Err("network-error:音乐列表脚本执行失败。".into());
        }
        Ok(response["result"]["value"].clone())
    }

    async fn devtools(
        webview: &Webview,
        method: &'static str,
        parameters: Value,
    ) -> Result<Value, String> {
        use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
        use windows::core::HSTRING;
        let (send, wait) = tokio::sync::oneshot::channel();
        webview
            .with_webview(move |platform| {
                // SAFETY: the callback runs on the thread that owns the WebView2 controller.
                unsafe {
                    let Ok(core) = platform.controller().CoreWebView2() else {
                        return;
                    };
                    let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                        move |status, value| {
                            let response =
                                status.ok().and_then(|_| serde_json::from_str(&value).ok());
                            let _ = send.send(response);
                            Ok(())
                        },
                    ));
                    let _ = core.CallDevToolsProtocolMethod(
                        &HSTRING::from(method),
                        &HSTRING::from(parameters.to_string()),
                        &handler,
                    );
                }
            })
            .map_err(|_| "network-error:无法访问音乐列表页面。")?;
        tokio::time::timeout(Duration::from_secs(3), wait)
            .await
            .ok()
            .and_then(Result::ok)
            .flatten()
            .ok_or_else(|| "network-error:无法访问音乐列表隔离环境。".into())
    }
}
