use crate::{browser::verification::require_main, model::validate_public_url};
use tauri::WebviewWindow;
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub fn open_external(window: WebviewWindow, url: String) -> Result<(), String> {
    require_main(&window)?;
    validate_public_url(&url)?;
    window
        .opener()
        .open_url(url, None::<String>)
        .map_err(|_| "无法打开系统浏览器。".into())
}

#[tauri::command]
pub fn login_capabilities(window: WebviewWindow) -> Result<serde_json::Value, String> {
    require_main(&window)?;
    Ok(login_capability_values(
        crate::system::capabilities::Platform::current(),
    ))
}

fn login_capability_values(platform: crate::system::capabilities::Platform) -> serde_json::Value {
    use crate::system::capabilities::Platform;
    let desktop = matches!(platform, Platform::Desktop);
    serde_json::json!({
        "qrPresentation": match platform { Platform::Desktop => "display", Platform::Android => "handoff", Platform::Ios => "unavailable" },
        "verification": if desktop { "system-browser" } else { "unavailable" },
        "isolatedAccounts": !matches!(platform, Platform::Ios),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::system::capabilities::Platform;
    #[test]
    fn qr_presentation_follows_native_support_without_mobile_browser_fallback() {
        assert_eq!(
            login_capability_values(Platform::Desktop)["qrPresentation"],
            "display"
        );
        assert_eq!(
            login_capability_values(Platform::Android)["qrPresentation"],
            "handoff"
        );
        assert_eq!(
            login_capability_values(Platform::Android)["verification"],
            "unavailable"
        );
        assert_eq!(
            login_capability_values(Platform::Ios)["qrPresentation"],
            "unavailable"
        );
    }
}
