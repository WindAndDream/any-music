use super::*;
use std::time::Duration;
use tauri::ipc::Origin;

fn sessions() -> ProbeSessions {
    let state = ProbeSessions::default();
    for label in ["s03-a", "s03-b"] {
        state.0.lock().unwrap().insert(
            label.into(),
            ProbeSession {
                window: label.into(),
                webview: label.into(),
                document: format!("https://am-{label}.localhost/index.html"),
                epoch: 1,
                expires: Instant::now() + Duration::from_secs(30),
                next_sequence: 0,
                bytes: 0,
            },
        );
    }
    state
}

fn message(sequence: u64) -> String {
    format!(
        r#"{{"epoch":1,"sequence":{sequence},"observation":{{"worker":true,"wasm":true,"noHostGlobals":true}}}}"#
    )
}

#[test]
fn tauri_acl_rejects_every_business_core_and_official_command() {
    // generate_context resolves the real build output without creating an app/WebView.
    let mut context = crate::application_context();
    let authority = context.runtime_authority_mut();
    for label in ["s03-a", "s03-b"] {
        authority.add_capability(capability(label)).unwrap();
    }
    let manifests: serde_json::Value =
        serde_json::from_str(include_str!("../../gen/schemas/acl-manifests.json")).unwrap();
    let mut count = 0;
    for (plugin, manifest) in manifests.as_object().unwrap() {
        for permission in manifest["permissions"].as_object().unwrap().values() {
            for command in permission["commands"]["allow"].as_array().unwrap() {
                let command = command.as_str().unwrap();
                let key = if plugin == "__app-acl__" {
                    command.to_owned()
                } else {
                    format!(
                        "plugin:{}|{command}",
                        plugin.strip_prefix("core:").unwrap_or(plugin)
                    )
                };
                if matches!(key.as_str(), "plugin_probe_relay" | "plugin_executor_relay") {
                    continue;
                }
                count += 1;
                for label in ["s03-a", "s03-b", "unknown"] {
                    assert!(
                        authority
                            .resolve_access(&key, label, label, &Origin::Local)
                            .is_none(),
                        "{label}: {key}"
                    );
                    // A child of main must not inherit main's product authority.
                    assert!(
                        authority
                            .resolve_access(&key, "main", label, &Origin::Local)
                            .is_none(),
                        "child: {key}"
                    );
                }
                if plugin == "__app-acl__" {
                    if key == "open_qr_login" {
                        // This native command is Android-only; desktop main must not inherit it.
                        assert!(
                            authority
                                .resolve_access(&key, "main", "main", &Origin::Local)
                                .is_none()
                        );
                        continue;
                    }
                    assert!(
                        authority
                            .resolve_access(&key, "main", "main", &Origin::Local)
                            .is_some(),
                        "product lost {key}"
                    );
                }
            }
        }
    }
    assert!(
        count > 150,
        "all generated manifests must be covered: {count}"
    );
    assert!(
        authority
            .resolve_access("plugin_probe_relay", "s03-a", "s03-a", &Origin::Local)
            .is_some()
    );
    assert!(
        authority
            .resolve_access("plugin_probe_relay", "main", "main", &Origin::Local)
            .is_none()
    );
    assert!(
        authority
            .resolve_access(
                "http_request",
                "main",
                "main",
                &Origin::Remote {
                    url: "https://example.com".parse().unwrap()
                }
            )
            .is_none()
    );
}

#[test]
fn relay_binds_native_caller_and_rejects_spoofing_replay_and_revocation() {
    let now = Instant::now();
    let state = sessions();
    let document = "https://am-s03-a.localhost/index.html";
    assert!(
        !state
            .forward("s03-a", "s03-a", document, &message(0), now)
            .unwrap()
            .code_plugins_enabled
    );
    assert!(
        state
            .forward("s03-a", "s03-a", document, &message(0), now)
            .is_err()
    );
    assert!(!state.0.lock().unwrap().contains_key("s03-a"));
    assert!(state.0.lock().unwrap().contains_key("s03-b"));
    for (window, view, url) in [
        ("main", "s03-a", document),
        ("s03-a", "s03-a", "https://am-s03-b.localhost/index.html"),
        ("s03-a", "unknown", document),
    ] {
        assert!(
            sessions()
                .forward(window, view, url, &message(0), now)
                .is_err()
        );
    }
    for extra in [
        ",\"pluginId\":\"b\"",
        ",\"userConfirmed\":true",
        ",\"event\":\"grant\"",
        ",\"epoch\":1",
    ] {
        let input = message(0);
        let forged = format!("{}{}{}", &input[..input.len() - 1], extra, "}");
        assert!(
            sessions()
                .forward("s03-a", "s03-a", document, &forged, now)
                .is_err()
        );
    }
    assert!(
        sessions()
            .forward(
                "s03-a",
                "s03-a",
                document,
                &message(0),
                now + Duration::from_secs(60)
            )
            .is_err()
    );
}

#[test]
fn relay_bounds_message_count_bytes_and_schema() {
    let document = "https://am-s03-a.localhost/index.html";
    let now = Instant::now();
    let state = sessions();
    for sequence in 0..MAX_SESSION_MESSAGES {
        state
            .forward("s03-a", "s03-a", document, &message(sequence), now)
            .unwrap();
    }
    assert!(
        state
            .forward(
                "s03-a",
                "s03-a",
                document,
                &message(MAX_SESSION_MESSAGES),
                now
            )
            .is_err()
    );
    for input in [
        "x".repeat(MAX_MESSAGE_BYTES + 1),
        "[]".into(),
        "{\"epoch\":2}".into(),
    ] {
        assert!(
            sessions()
                .forward("s03-a", "s03-a", document, &input, now)
                .is_err()
        );
    }
    let state = sessions();
    state.0.lock().unwrap().get_mut("s03-a").unwrap().bytes = MAX_SESSION_BYTES;
    assert!(
        state
            .forward("s03-a", "s03-a", document, &message(0), now)
            .is_err()
    );
    assert!(
        ProbeSessions::default()
            .forward("s03-a", "s03-a", document, &message(0), now)
            .is_err()
    );
}
