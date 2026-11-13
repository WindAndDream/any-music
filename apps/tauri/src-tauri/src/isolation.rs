//! S03 diagnostic boundary only. Reports are untrusted observations, never grants.
//! The product has no session creation command and cannot install or execute code.
#[cfg(feature = "s03-isolation-probe")]
pub(crate) mod prototype;
#[cfg(test)]
mod tests;

use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Mutex, time::Instant};

const MAX_MESSAGE_BYTES: usize = 4096;
const MAX_SESSION_BYTES: usize = 64 * 1024;
const MAX_SESSION_MESSAGES: u64 = 32;

#[derive(Default)]
pub(crate) struct ProbeSessions(Mutex<HashMap<String, ProbeSession>>);

pub(crate) struct ProbeSession {
    window: String,
    webview: String,
    document: String,
    epoch: u64,
    expires: Instant,
    next_sequence: u64,
    bytes: usize,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ProbeMessage {
    epoch: u64,
    sequence: u64,
    observation: ProbeObservation,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ProbeObservation {
    worker: bool,
    wasm: bool,
    no_host_globals: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProbeAck {
    sequence: u64,
    code_plugins_enabled: bool,
}

impl ProbeSessions {
    // Caller identity comes from the native WebView, not from message fields.
    fn forward(
        &self,
        window: &str,
        webview: &str,
        document: &str,
        message: &str,
        now: Instant,
    ) -> Result<ProbeAck, String> {
        let mut sessions = self.0.lock().map_err(|_| "probe unavailable")?;
        let Some(session) = sessions.get_mut(webview) else {
            return Err("unknown probe caller".into());
        };
        let result = (|| {
            if window != session.window
                || webview != session.webview
                || document != session.document
                || now >= session.expires
            {
                return Err("probe caller or lifetime mismatch");
            }
            // Charge all traffic, including malformed messages. Failure revokes the session.
            session.bytes = session.bytes.saturating_add(message.len());
            if message.len() > MAX_MESSAGE_BYTES
                || session.bytes > MAX_SESSION_BYTES
                || session.next_sequence >= MAX_SESSION_MESSAGES
            {
                return Err("probe budget exhausted");
            }
            let input: ProbeMessage = serde_json::from_str(message).map_err(|_| "invalid probe")?;
            if input.epoch != session.epoch || input.sequence != session.next_sequence {
                return Err("stale or replayed probe");
            }
            // Observations have no authority. No event, destination, business payload,
            // user gesture, plugin ID, account or capability is accepted or forwarded.
            let _observed = (
                input.observation.worker,
                input.observation.wasm,
                input.observation.no_host_globals,
            );
            session.next_sequence += 1;
            Ok(ProbeAck {
                sequence: input.sequence,
                code_plugins_enabled: false,
            })
        })();
        if result.is_err() {
            sessions.remove(webview);
        }
        result.map_err(str::to_owned)
    }
}

#[tauri::command]
pub(crate) fn plugin_probe_relay<R: tauri::Runtime>(
    webview: tauri::Webview<R>,
    state: tauri::State<'_, ProbeSessions>,
    message: String,
) -> Result<ProbeAck, String> {
    let document = webview.url().map_err(|_| "probe URL unavailable")?;
    state.forward(
        webview.window().label(),
        webview.label(),
        document.as_str(),
        &message,
        Instant::now(),
    )
}

#[cfg(any(test, feature = "s03-isolation-probe"))]
fn capability(label: &str) -> String {
    serde_json::json!({
        "identifier": format!("{label}-relay"),
        "description": "S03 fixed diagnostics only; no product/core/plugin authority",
        "webviews": [label],
        "permissions": ["allow-plugin-probe-relay"]
    })
    .to_string()
}
