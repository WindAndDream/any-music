//! Exact reviewed target/resource admission. Unknown targets remain closed; acceptance
//! builds exercise the same implementation without creating a product policy override.
use am_plugin_runtime::InstallPolicy;
use std::collections::BTreeSet;

pub(super) fn policy(admitted: bool) -> InstallPolicy {
    InstallPolicy {
        declarative: admitted,
        sandbox_code: admitted,
        capabilities: if admitted {
            [
                "state.read",
                "state.write",
                "network.publicHttps",
                "crypto.sha256",
                "source.authentication",
            ]
            .map(str::to_owned)
            .into()
        } else {
            BTreeSet::new()
        },
    }
}
#[cfg(mobile)]
pub(crate) fn admitted() -> bool {
    false
}
#[cfg(desktop)]
pub(crate) fn admitted() -> bool {
    let Ok(record) = serde_json::from_str::<serde_json::Value>(include_str!(
        "../../../../../docs/baselines/plugin-system-s15/target-admission.json"
    )) else {
        return false;
    };
    let current: serde_json::Value = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../target/s15-executor/resources.json"
    )))
    .unwrap_or_default();
    record["accepted"] == true
        && record["os"] == std::env::consts::OS
        && record["arch"] == std::env::consts::ARCH
        && record["resources"] == current
        && record["profileHash"]
            == serde_json::from_str::<serde_json::Value>(include_str!(
                "../../../../../packages/plugin-vm/engine/profile.json"
            ))
            .unwrap_or_default()["profileHash"]
        && record["webview"] == tauri::webview_version().unwrap_or_default()
        && record["osBuild"] == os_build()
}
#[cfg(windows)]
pub(crate) fn os_build() -> String {
    #[repr(C)]
    struct Version {
        size: u32,
        major: u32,
        minor: u32,
        build: u32,
        platform: u32,
        text: [u16; 128],
    }
    #[link(name = "ntdll")]
    unsafe extern "system" {
        fn RtlGetVersion(value: *mut Version) -> i32;
    }
    let mut version = Version {
        size: size_of::<Version>() as u32,
        major: 0,
        minor: 0,
        build: 0,
        platform: 0,
        text: [0; 128],
    };
    // SAFETY: a correctly sized, initialized version structure, populated by the OS.
    if unsafe { RtlGetVersion(&mut version) } == 0 {
        format!("{}.{}.{}", version.major, version.minor, version.build)
    } else {
        String::new()
    }
}
#[cfg(all(desktop, not(windows)))]
pub(crate) fn os_build() -> String {
    String::new()
}
