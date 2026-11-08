//! Opt-in S03 harness, never called by the product. Only Windows has a candidate
//! adapter; saved evidence accepts only an exact OS/WebView/example combination.
use super::{ProbeSession, ProbeSessions, capability};
use std::time::{Duration, Instant};
use tauri::{Manager, http};

const DOCUMENT_CSP: &str = "default-src 'none'; script-src 'self'; worker-src 'self'; connect-src ipc: http://ipc.localhost; style-src 'none'; img-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const WORKER_CSP: &str = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'";
const HTML: &[u8] = b"<!doctype html><html><head><meta charset=\"utf-8\"><title>S03 isolation probe</title></head><body><p>S03 fixed diagnostic sample. External code remains disabled.</p><pre id=\"result\">Pending</pre><script type=\"module\" src=\"/launcher.js\"></script></body></html>";
const WORKER: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../target/s03-probe/worker.js"
));
const LAUNCHER: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../target/s03-probe/launcher.js"
));
const NETWORK_WORKER: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../target/s03-probe/network-worker.js"
));

#[cfg(test)]
fn resource(label: &str, caller: &str, request: http::Request<Vec<u8>>) -> http::Response<Vec<u8>> {
    respond(label, caller, request, DOCUMENT_CSP)
}

fn respond(
    label: &str,
    caller: &str,
    request: http::Request<Vec<u8>>,
    document_csp: &str,
) -> http::Response<Vec<u8>> {
    let allowed = label == caller
        && request.method() == http::Method::GET
        && request.uri().query().is_none()
        && !request.headers().contains_key("service-worker");
    let asset = allowed
        .then(|| match request.uri().path() {
            "/index.html" => Some((HTML, "text/html; charset=utf-8", document_csp)),
            "/launcher.js" => Some((LAUNCHER, "text/javascript; charset=utf-8", document_csp)),
            "/worker.js" => Some((WORKER, "text/javascript; charset=utf-8", WORKER_CSP)),
            "/network-worker.js" => {
                Some((NETWORK_WORKER, "text/javascript; charset=utf-8", WORKER_CSP))
            }
            _ => None,
        })
        .flatten();
    let (body, mime, csp) = asset.unwrap_or((b"denied", "text/plain", "default-src 'none'"));
    http::Response::builder()
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
        .body(body.to_vec())
        .unwrap()
}

pub fn run() {
    #[cfg(not(target_os = "windows"))]
    {
        eprintln!("S03: no candidate adapter for this OS; code plugins disabled");
    }
    #[cfg(target_os = "windows")]
    run_windows();
}

#[cfg(target_os = "windows")]
fn run_windows() {
    use tauri::{
        WebviewUrl, WebviewWindowBuilder,
        webview::{NewWindowResponse, PermissionResponse},
    };
    let mut context = crate::application_context();
    context.config_mut().app.windows.clear();
    // Only the standalone example reads this opt-in test configuration. Remote
    // debugging is bound to loopback; no security/CSP switches are added.
    let ports: std::collections::HashMap<String, u16> = std::env::var("AM_S03_DEBUG_PORTS")
        .ok()
        .map(|value| serde_json::from_str(&value).expect("S03 debug ports"))
        .unwrap_or_default();
    let live = !ports.is_empty();
    let product_csp = context
        .config()
        .app
        .security
        .csp
        .as_ref()
        .expect("product CSP")
        .to_string();
    for label in ["s03-a", "s03-b"] {
        context
            .runtime_authority_mut()
            .add_capability(capability(label))
            .expect("probe capability");
    }
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(ProbeSessions::default())
        .invoke_handler(crate::ipc::handler());
    for (scheme, label) in [
        ("am-s03-a", "s03-a"),
        ("am-s03-b", "s03-b"),
        ("tauri", "main"),
    ] {
        if label == "main" && !live {
            continue;
        }
        let document_csp = if label == "main" {
            product_csp.clone()
        } else {
            DOCUMENT_CSP.into()
        };
        builder = builder.register_uri_scheme_protocol(scheme, move |context, request| {
            let caller = context.webview_label();
            let owner = if live && label == "s03-a" && caller == "s03-peer" { "s03-peer" } else { label };
            let path = request.uri().path().to_owned();
            let response = respond(owner, caller, request, &document_csp);
            if live { eprintln!("S03_NATIVE {}", serde_json::json!({"event":"resource", "caller":caller, "owner":owner, "path":path, "status":response.status().as_u16(), "csp":response.headers()["Content-Security-Policy"].to_str().unwrap()})); }
            response
        });
    }
    builder
        .setup(move |app| {
            // The live main-view control has an empty, temporary native snapshot.
            // No credentials, accounts, business network or media server is initialized.
            let run_id = uuid::Uuid::new_v4();
            let root = std::env::temp_dir().join(format!("any-music-s03-{run_id}"));
            if live { app.manage(crate::state::RuntimeState::new(root.join("product")).map_err(std::io::Error::other)?); }
            if live && let Some(control) = std::env::var_os("AM_S03_CONTROL_FILE") {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    let mut previous = String::new();
                    let mut epoch = 1;
                    let mut starts = 0;
                    for _ in 0..1800 {
                        let operation = std::fs::read_to_string(&control).unwrap_or_default();
                        if operation.len() <= 64 && operation != previous {
                            previous = operation.clone();
                            match operation.split(':').next().unwrap_or_default() {
                                "start-sessions" => {
                                    starts += 1;
                                    if starts <= 2 {
                                        epoch = starts;
                                        for label in ["s03-a", "s03-b"] {
                                            handle.state::<ProbeSessions>().0.lock().unwrap().insert(label.into(), ProbeSession {
                                                window:label.into(), webview:label.into(), document:format!("https://am-{label}.localhost/index.html"), epoch,
                                                expires:Instant::now()+Duration::from_secs(120), next_sequence:0, bytes:0,
                                            });
                                        }
                                    }
                                }
                                "close-a" => { if let Some(window) = handle.get_webview_window("s03-a") { let _ = window.close(); } }
                                "reset-b" => {
                                    epoch += 1;
                                    if epoch <= 16 {
                                        handle.state::<ProbeSessions>().0.lock().unwrap().insert("s03-b".into(), ProbeSession {
                                            window:"s03-b".into(), webview:"s03-b".into(), document:"https://am-s03-b.localhost/index.html".into(), epoch,
                                            expires:Instant::now()+Duration::from_secs(120), next_sequence:0, bytes:0,
                                        });
                                        eprintln!("S03_NATIVE {}", serde_json::json!({"event":"reset", "label":"s03-b", "epoch":epoch}));
                                    }
                                }
                                "shutdown" => { handle.exit(0); return; }
                                _ => {}
                            }
                        }
                        std::thread::sleep(Duration::from_millis(100));
                    }
                    handle.exit(1);
                });
            }
            let labels = if live { vec!["main", "s03-a", "s03-b", "s03-peer"] } else { vec!["s03-a", "s03-b"] };
            for label in labels {
                let origin = match label { "main" => "tauri", "s03-peer" => "am-s03-a", _ => if label == "s03-a" { "am-s03-a" } else { "am-s03-b" } };
                let document = format!("https://{origin}.localhost/index.html");
                if label == "s03-a" || label == "s03-b" { app.state::<ProbeSessions>().0.lock().unwrap().insert(
                    label.into(),
                    ProbeSession {
                        window: label.into(),
                        webview: label.into(),
                        document: document.clone(),
                        epoch: 1,
                        expires: Instant::now() + Duration::from_secs(120),
                        next_sequence: 0,
                        bytes: 0,
                    },
                ); }
                let expected = document.clone();
                let navigation_started = std::sync::atomic::AtomicBool::new(false);
                let navigation_handle = app.handle().clone();
                let data = root.join(label);
                if live { eprintln!("S03_NATIVE {}", serde_json::json!({"event":"profile", "label":label, "directory":data, "root":root, "document":document})); }
                let mut window = WebviewWindowBuilder::new(
                    app,
                    label,
                    WebviewUrl::External(document.parse().unwrap()),
                )
                .title(format!("S03 {label} — unaccepted isolation probe"))
                .data_directory(data)
                .initialization_script(format!("globalThis.s03LiveAcceptance = {live};"))
                .use_https_scheme(true)
                .devtools(false)
                .disable_drag_drop_handler()
                .on_navigation(move |url| {
                    let allowed = url.as_str() == expected;
                    // A reload creates a new document even at the same URL. Revoke
                    // the old session before the new page can send messages.
                    if allowed && navigation_started.swap(true, std::sync::atomic::Ordering::SeqCst) {
                        navigation_handle.state::<ProbeSessions>().0.lock().unwrap().remove(label);
                        if live { eprintln!("S03_NATIVE {}", serde_json::json!({"event":"document-revoked", "label":label})); }
                    }
                    if live { eprintln!("S03_NATIVE {}", serde_json::json!({"event":"navigation", "label":label, "url":url.as_str(), "allowed":allowed})); }
                    allowed
                })
                .on_new_window(move |url, _| { if live { eprintln!("S03_NATIVE {}", serde_json::json!({"event":"new-window", "label":label, "url":url.as_str(), "allowed":false})); } NewWindowResponse::Deny })
                .on_download(move |_, _| { if live { eprintln!("S03_NATIVE {}", serde_json::json!({"event":"download", "label":label, "allowed":false})); } false })
                .on_permission_request(move |_, _| { if live { eprintln!("S03_NATIVE {}", serde_json::json!({"event":"permission", "label":label, "allowed":false})); } PermissionResponse::Deny });
                if let Some(port) = ports.get(label) { window = window.additional_browser_args(&format!("--remote-debugging-port={port} --remote-debugging-address=127.0.0.1")); }
                window.build()?;
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                window
                    .state::<ProbeSessions>()
                    .0
                    .lock()
                    .unwrap()
                    .remove(window.label());
                eprintln!("S03_NATIVE {}", serde_json::json!({"event":"destroyed", "label":window.label(), "remainingSessions":window.state::<ProbeSessions>().0.lock().unwrap().keys().collect::<Vec<_>>() }));
            }
        })
        .build(context)
        .expect("S03 diagnostic harness")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                app.state::<ProbeSessions>().0.lock().unwrap().clear();
                eprintln!("S03_NATIVE {}", serde_json::json!({"event":"exit", "remainingSessions":0}));
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resources_reject_cross_subject_unknown_assets_and_service_workers() {
        for path in [
            "/index.html",
            "/launcher.js",
            "/worker.js",
            "/network-worker.js",
        ] {
            let response = resource(
                "s03-a",
                "s03-a",
                http::Request::get(path).body(vec![]).unwrap(),
            );
            assert_eq!(response.status(), 200);
            let csp = response.headers()["Content-Security-Policy"]
                .to_str()
                .unwrap();
            assert!(
                !csp.contains("'unsafe-eval'") && !csp.contains("blob:") && !csp.contains("data:")
            );
            if path.ends_with("worker.js") {
                assert!(csp.contains("connect-src 'none'"));
            }
            assert_eq!(
                resource(
                    "s03-a",
                    "s03-b",
                    http::Request::get(path).body(vec![]).unwrap()
                )
                .status(),
                403
            );
        }
        for path in [
            "/",
            "/product.json",
            "/../index.html",
            "/worker.js?code=evil",
        ] {
            assert_eq!(
                resource(
                    "s03-a",
                    "s03-a",
                    http::Request::get(path).body(vec![]).unwrap()
                )
                .status(),
                403
            );
        }
        assert_eq!(
            resource(
                "s03-a",
                "s03-a",
                http::Request::get("/worker.js")
                    .header("Service-Worker", "script")
                    .body(vec![])
                    .unwrap()
            )
            .status(),
            403
        );
    }
}
