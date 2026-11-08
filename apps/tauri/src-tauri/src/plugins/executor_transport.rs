//! Defense below navigation/CSP: an isolated WebView can load only fixed resources and
//! Tauri's bounded IPC transport. Never let browser navigation initiate network IO.
#[cfg(windows)]
pub(super) fn install(view: tauri::webview::PlatformWebview, slot: usize) -> Result<i64, String> {
    use webview2_com::{
        Microsoft::Web::WebView2::Win32::*, WebResourceRequestedEventHandler, take_pwstr,
    };
    use windows::core::{HSTRING, Interface, PWSTR};
    // SAFETY: called on the owning UI thread with live WebView2 COM handles. The
    // event owns its environment clone and only writes a fixed empty denial response.
    unsafe {
        let webview = view
            .controller()
            .CoreWebView2()
            .map_err(|_| "执行器传输不可用。")?;
        let environment = view.environment();
        let modern = webview
            .cast::<ICoreWebView2_22>()
            .map_err(|_| "执行器传输版本不支持。")?;
        modern
            .AddWebResourceRequestedFilterWithRequestSourceKinds(
                &HSTRING::from("*"),
                COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL,
            )
            .map_err(|_| "执行器传输过滤器不可用。")?;
        let origin = format!("https://am-plugin-{slot}.localhost/");
        let mut token = 0;
        webview
            .add_WebResourceRequested(
                &WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
                    let Some(args) = args else { return Ok(()) };
                    let mut uri = PWSTR::null();
                    args.Request()?.Uri(&mut uri)?;
                    let uri = take_pwstr(uri);
                    if !allowed(&origin, &uri) {
                        let response = environment.CreateWebResourceResponse(
                            None,
                            403,
                            &HSTRING::from("Denied"),
                            &HSTRING::from("Content-Length: 0\r\nCache-Control: no-store"),
                        )?;
                        args.SetResponse(&response)?;
                    }
                    Ok(())
                })),
                &mut token,
            )
            .map_err(|_| "执行器传输过滤器不可用。")?;
        Ok(token)
    }
}

#[cfg(windows)]
pub(super) fn release(view: tauri::webview::PlatformWebview, token: i64) {
    // SAFETY: runs on the owning UI thread before forced destruction. Removing our
    // environment-owning callback breaks its COM lifetime before the controller closes.
    unsafe {
        let controller = view.controller();
        if let Ok(webview) = controller.CoreWebView2() {
            let _ = webview.remove_WebResourceRequested(token);
        }
        let _ = controller.Close();
    }
}

#[cfg(any(windows, test))]
fn allowed(origin: &str, uri: &str) -> bool {
    uri.strip_prefix(origin)
        .is_some_and(|path| matches!(path, "index.html" | "launcher.js" | "worker.js"))
        || uri == "http://ipc.localhost/"
        || uri == "http://ipc.localhost/plugin_executor_relay"
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn transport_allows_fixed_resources_and_only_bounded_relay() {
        let origin = "https://am-plugin-0.localhost/";
        assert!(allowed(origin, &format!("{origin}worker.js")));
        assert!(allowed(
            origin,
            "http://ipc.localhost/plugin_executor_relay"
        ));
        for uri in [
            "https://example.com/",
            "http://127.0.0.1/probe",
            "https://am-plugin-1.localhost/worker.js",
            "http://ipc.localhost/plugin_package_install",
            "http://ipc.localhost/plugin_executor_relay-forged",
            "https://am-plugin-0.localhost/worker.js?evil",
        ] {
            assert!(!allowed(origin, uri));
        }
    }
}
