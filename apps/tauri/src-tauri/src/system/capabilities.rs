//! Native platform capabilities are independent of desktop target admission. A compiled
//! mobile adapter is not accepted device/channel evidence and never inherits S15 grants.
use serde::Serialize;

#[derive(Clone, Copy)]
pub(crate) enum Platform {
    Desktop,
    Android,
    Ios,
}
impl Platform {
    pub(crate) fn current() -> Self {
        if cfg!(target_os = "android") {
            Self::Android
        } else if cfg!(target_os = "ios") {
            Self::Ios
        } else {
            Self::Desktop
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeCapabilities {
    platform: &'static str,
    form: &'static str,
    pub external_plugins: &'static str,
    account_transport: &'static str,
    account_proxy: &'static str,
    system_browser: &'static str,
    secure_credentials: &'static str,
    media: &'static str,
    native_save: &'static str,
    package_files: &'static str,
    package_sharing: &'static str,
    package_deep_links: &'static str,
    background_execution: &'static str,
}

pub(crate) fn for_platform(platform: Platform, desktop_admitted: bool) -> RuntimeCapabilities {
    let desktop = matches!(platform, Platform::Desktop);
    let android = matches!(platform, Platform::Android);
    let status = if desktop { "provided" } else { "unavailable" };
    RuntimeCapabilities {
        platform: match platform {
            Platform::Desktop => "desktop",
            Platform::Android => "android",
            Platform::Ios => "ios",
        },
        form: if desktop { "desktop" } else { "mobile" },
        external_plugins: if !desktop {
            "none"
        } else if desktop_admitted {
            "sandboxed"
        } else {
            "declarative"
        },
        account_transport: if desktop || android {
            "provided"
        } else {
            "unavailable"
        },
        account_proxy: if desktop || android {
            "provided"
        } else {
            "unavailable"
        },
        system_browser: status,
        secure_credentials: if desktop || android {
            "provided"
        } else {
            "unavailable"
        },
        media: if desktop || android {
            "provided"
        } else {
            "unavailable"
        },
        native_save: if desktop || android {
            "provided"
        } else {
            "unavailable"
        },
        package_files: if desktop || android {
            "provided"
        } else {
            "unavailable"
        },
        package_sharing: if android { "provided" } else { "unavailable" },
        package_deep_links: if desktop || android {
            "provided"
        } else {
            "unavailable"
        },
        background_execution: "unavailable",
    }
}

fn account_platform_supported(platform: Platform, source: &str) -> bool {
    match platform {
        Platform::Desktop => matches!(source, "bilibili" | "douyin" | "netease"),
        Platform::Android => source == "bilibili",
        Platform::Ios => false,
    }
}

pub(crate) fn require_account_platform(source: &str) -> Result<(), String> {
    if account_platform_supported(Platform::current(), source) {
        Ok(())
    } else {
        Err("此运行端未提供该内置音乐源的账号能力。".into())
    }
}

#[tauri::command]
pub(crate) fn runtime_capabilities(
    window: tauri::WebviewWindow,
) -> Result<RuntimeCapabilities, String> {
    crate::browser::verification::require_main(&window)?;
    Ok(for_platform(
        Platform::current(),
        crate::plugins::target::admitted(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn mobile_does_not_inherit_desktop_admission_or_capabilities() {
        for platform in [Platform::Android, Platform::Ios] {
            for admitted in [false, true] {
                let value = serde_json::to_value(for_platform(platform, admitted)).unwrap();
                assert_eq!(value["externalPlugins"], "none");
                assert_eq!(value["form"], "mobile");
                for key in ["systemBrowser", "backgroundExecution"] {
                    assert_eq!(value[key], "unavailable", "{key}");
                }
                for key in [
                    "accountTransport",
                    "accountProxy",
                    "media",
                    "secureCredentials",
                    "nativeSave",
                    "packageFiles",
                    "packageSharing",
                    "packageDeepLinks",
                ] {
                    assert_eq!(
                        value[key],
                        if matches!(platform, Platform::Android) {
                            "provided"
                        } else {
                            "unavailable"
                        },
                        "{key}"
                    );
                }
            }
        }
    }
    #[test]
    fn source_account_support_is_explicit_for_each_native_platform() {
        assert!(account_platform_supported(Platform::Android, "bilibili"));
        assert!(!account_platform_supported(Platform::Android, "douyin"));
        assert!(!account_platform_supported(Platform::Ios, "bilibili"));
        assert!(account_platform_supported(Platform::Desktop, "douyin"));
        assert!(account_platform_supported(Platform::Desktop, "netease"));
        assert!(!account_platform_supported(Platform::Android, "netease"));
        for platform in [Platform::Desktop, Platform::Android, Platform::Ios] {
            assert!(!account_platform_supported(platform, "future-source"));
        }
    }
    #[test]
    fn desktop_policy_remains_target_specific() {
        assert_eq!(
            for_platform(Platform::Desktop, true).external_plugins,
            "sandboxed"
        );
        assert_eq!(
            for_platform(Platform::Desktop, false).external_plugins,
            "declarative"
        );
    }
}
