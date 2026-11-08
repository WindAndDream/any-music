//! Host-selected, owner-ACL DEV sessions. Pairing never grants authority: each immutable
//! snapshot requires native target admission and explicit installation/capability consent.
use super::PluginAuthority;
#[cfg(any(windows, test))]
use base64::Engine;
#[cfg(windows)]
use rand::RngCore;
#[cfg(any(windows, test))]
use serde::Deserialize;
use serde::Serialize;
use std::sync::{Arc, Mutex};
#[cfg(windows)]
use std::{io::Read, path::Path};
#[cfg(windows)]
use std::{path::PathBuf, time::Duration};
#[cfg(windows)]
use tauri::Emitter;
use tauri::Manager;
#[cfg(windows)]
use tauri_plugin_dialog::DialogExt;
#[cfg(any(windows, test))]
use tokio::io::{AsyncRead, AsyncReadExt};
#[cfg(windows)]
use tokio::io::{AsyncWrite, AsyncWriteExt};
use tokio_util::sync::CancellationToken;

#[derive(Default)]
pub(crate) struct DevSessions(Mutex<Option<DevHost>>);
struct DevHost {
    cancel: CancellationToken,
    authority: Arc<PluginAuthority>,
}
impl DevSessions {
    pub(crate) fn authority(&self) -> Option<Arc<PluginAuthority>> {
        self.0.lock().ok()?.as_ref().map(|s| s.authority.clone())
    }
    pub(crate) fn stop(&self) {
        if let Ok(mut slot) = self.0.lock()
            && let Some(host) = slot.take()
        {
            host.cancel.cancel();
            host.authority
                .stopped
                .store(true, std::sync::atomic::Ordering::SeqCst);
            if let Ok(installs) = host.authority.with(|r| r.snapshot()) {
                for install in installs {
                    let _ = host.authority.with(|r| r.revoke(&install.install_id));
                    host.authority.cancel_network(&install.install_id);
                }
            }
        }
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DevPairing {
    pairing_path: String,
    preview_only: bool,
}
#[cfg(any(windows, test))]
#[derive(Deserialize)]
#[serde(tag = "type", deny_unknown_fields)]
enum Message {
    #[serde(rename = "pair")]
    Pair { version: u32, token: String },
    #[serde(rename = "snapshot", rename_all = "camelCase")]
    Snapshot {
        session: String,
        previous_epoch: u64,
        hash: String,
        bytes: String,
    },
}
#[cfg(any(windows, test))]
async fn receive(stream: &mut (impl AsyncRead + Unpin), limit: usize) -> Result<Message, ()> {
    let size = stream.read_u32().await.map_err(|_| ())? as usize;
    if size > limit {
        return Err(());
    }
    let mut bytes = vec![0; size];
    stream.read_exact(&mut bytes).await.map_err(|_| ())?;
    serde_json::from_slice(&bytes).map_err(|_| ())
}
#[cfg(windows)]
async fn send(stream: &mut (impl AsyncWrite + Unpin), value: serde_json::Value) -> Result<(), ()> {
    let bytes = serde_json::to_vec(&value).map_err(|_| ())?;
    if bytes.len() > 262144 {
        return Err(());
    }
    stream.write_u32(bytes.len() as u32).await.map_err(|_| ())?;
    stream.write_all(&bytes).await.map_err(|_| ())
}
#[cfg(any(windows, test))]
fn snapshot_bytes(
    message: Message,
    session_id: &str,
    epoch: u64,
    plugin_id: &str,
) -> Result<Vec<u8>, ()> {
    let Message::Snapshot {
        session,
        previous_epoch,
        hash,
        bytes,
    } = message
    else {
        return Err(());
    };
    if session != session_id
        || previous_epoch != epoch
        || hash.len() != 64
        || bytes.len() > 22369624
    {
        return Err(());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(bytes)
        .map_err(|_| ())?;
    let package = am_plugin_package::verify(bytes, || false).map_err(|_| ())?;
    if package.content_hash() != hash || package.manifest().id != plugin_id {
        return Err(());
    }
    Ok(package.bytes().to_vec())
}
#[cfg(windows)]
async fn serve(
    mut stream: impl AsyncRead + AsyncWrite + Unpin,
    token: String,
    pair_path: PathBuf,
    plugin_id: String,
    authority: Arc<PluginAuthority>,
    cancel: CancellationToken,
    app: tauri::AppHandle,
) -> Result<(), ()> {
    let pair = tokio::time::timeout(Duration::from_secs(120), receive(&mut stream, 1024))
        .await
        .map_err(|_| ())??;
    let Message::Pair {
        version: 1,
        token: supplied,
    } = pair
    else {
        return Err(());
    };
    if supplied != token {
        return Err(());
    }
    // A single native pipe instance plus deletion consumes pairing exactly once. Secrets never
    // enter diagnostics/events, and a new DEV session always uses an independent DB/package root.
    let _ = std::fs::remove_file(pair_path);
    let session = uuid::Uuid::new_v4().to_string();
    send(
        &mut stream,
        serde_json::json!({"type":"paired","session":session}),
    )
    .await?;
    let mut epoch = 0;
    loop {
        let message = tokio::select! {
            _ = cancel.cancelled() => return Ok(()),
            value = tokio::time::timeout(Duration::from_secs(300), receive(&mut stream, 24 * 1024 * 1024)) => value.map_err(|_| ())??,
        };
        let bytes = snapshot_bytes(message, &session, epoch, &plugin_id)?;
        let hash = am_plugin_package::hash(&bytes);
        let host = authority.clone();
        let mut preview = tauri::async_runtime::spawn_blocking(move || host.preview_package(bytes))
            .await
            .map_err(|_| ())?
            .map_err(|_| ())?;
        if cancel.is_cancelled() {
            return Ok(());
        }
        preview.dev = true;
        let _ = app.emit_to("main", "any-music:plugin-package-preview", &preview);
        // Every immutable reload needs a new main-view confirmation. CLI pairing alone never
        // grants a capability, transfers data, or restores an authorization after revocation.
        let mut activated = false;
        let mut permission_epoch = None;
        for _ in 0..3000 {
            if cancel.is_cancelled() {
                return Ok(());
            }
            let decision = authority.preview_result.lock().map_err(|_| ())?.clone();
            if let Some((token, accepted)) = decision.filter(|(token, _)| token == &preview.token) {
                let _ = token;
                if accepted {
                    let state = authority
                        .with(|r| r.snapshot())
                        .map_err(|_| ())?
                        .into_iter()
                        .find(|i| i.enabled && i.content_hash == hash);
                    activated = state.is_some();
                    permission_epoch = state.map(|s| s.permission_epoch);
                }
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        epoch += 1;
        send(
            &mut stream,
            serde_json::json!({"type":"preview","hash":hash,"epoch":epoch,"activated":activated,"permissionEpoch":permission_epoch}),
        )
        .await?;
    }
}

#[cfg(windows)]
mod local {
    use super::*;
    use std::{ffi::c_void, os::windows::ffi::OsStrExt, ptr};
    use tokio::net::windows::named_pipe::{NamedPipeServer, ServerOptions};
    use windows_sys::Win32::{
        Foundation::{CloseHandle, LocalFree},
        Security::{
            Authorization::{
                ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
            },
            DACL_SECURITY_INFORMATION, GetTokenInformation, PROTECTED_DACL_SECURITY_INFORMATION,
            SECURITY_ATTRIBUTES, SetFileSecurityW, TOKEN_QUERY, TOKEN_USER, TokenUser,
        },
        System::Threading::{GetCurrentProcess, OpenProcessToken},
    };

    struct Descriptor(*mut c_void);
    fn current_user_sid() -> Result<String, String> {
        let mut token = ptr::null_mut();
        // SAFETY: the process pseudo-handle is borrowed; the returned token is closed below.
        if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
            return Err("DEV 用户身份不可用。".into());
        }
        let result = (|| {
            let mut length = 0;
            // Query size first, then use an aligned owned buffer for TOKEN_USER and its SID.
            unsafe {
                GetTokenInformation(token, TokenUser, ptr::null_mut(), 0, &mut length);
            }
            if length == 0 || length > 65536 {
                return Err("DEV 用户身份不可用。".into());
            }
            let mut buffer = vec![0usize; (length as usize).div_ceil(size_of::<usize>())];
            if unsafe {
                GetTokenInformation(
                    token,
                    TokenUser,
                    buffer.as_mut_ptr().cast(),
                    length,
                    &mut length,
                )
            } == 0
            {
                return Err("DEV 用户身份不可用。".into());
            }
            let user = unsafe { &*buffer.as_ptr().cast::<TOKEN_USER>() };
            let mut string = ptr::null_mut();
            if unsafe { ConvertSidToStringSidW(user.User.Sid, &mut string) } == 0 {
                return Err("DEV 用户身份不可用。".into());
            }
            let mut count = 0;
            // Windows guarantees a terminated SID string. Bound the scan defensively.
            while count < 512 && unsafe { *string.add(count) } != 0 {
                count += 1;
            }
            let value = if count < 512 {
                String::from_utf16(unsafe { std::slice::from_raw_parts(string, count) }).ok()
            } else {
                None
            };
            unsafe {
                LocalFree(string.cast());
            }
            value.ok_or_else(|| "DEV 用户身份不可用。".into())
        })();
        unsafe {
            CloseHandle(token);
        }
        result
    }
    impl Descriptor {
        fn new(inherit: bool) -> Result<Self, String> {
            // Bind the exact token user SID, including for elevated processes whose default
            // owner may be Administrators. No group/Everyone or inherited ACE is accepted.
            let sid = current_user_sid()?;
            let flags = if inherit { "OICI" } else { "" };
            let sddl = format!("O:{sid}D:P(A;{flags};GA;;;{sid})");
            let wide: Vec<u16> = sddl.encode_utf16().chain(Some(0)).collect();
            let mut descriptor = ptr::null_mut();
            // SAFETY: NUL-terminated constant SDDL and a valid output pointer. Windows owns the
            // allocated descriptor until Drop, after the synchronous API has copied its bytes.
            if unsafe {
                ConvertStringSecurityDescriptorToSecurityDescriptorW(
                    wide.as_ptr(),
                    1,
                    &mut descriptor,
                    ptr::null_mut(),
                )
            } == 0
            {
                return Err("DEV ACL 不可用。".into());
            }
            Ok(Self(descriptor))
        }
    }
    impl Drop for Descriptor {
        fn drop(&mut self) {
            unsafe {
                LocalFree(self.0);
            }
        }
    }
    pub(super) fn protect(directory: &Path) -> Result<(), String> {
        let descriptor = Descriptor::new(true)?;
        let wide: Vec<u16> = directory.as_os_str().encode_wide().chain(Some(0)).collect();
        // SAFETY: stable NUL-terminated path and live descriptor; no raw handle escapes.
        if unsafe {
            SetFileSecurityW(
                wide.as_ptr(),
                DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                descriptor.0,
            )
        } == 0
        {
            return Err("DEV 目录权限不可用。".into());
        }
        Ok(())
    }
    pub(super) fn listen(endpoint: &str) -> Result<NamedPipeServer, String> {
        let descriptor = Descriptor::new(false)?;
        let mut attrs = SECURITY_ATTRIBUTES {
            nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: descriptor.0,
            bInheritHandle: 0,
        };
        // SAFETY: attrs and descriptor remain live for the synchronous CreateNamedPipe call;
        // Tokio takes ownership of its resulting handle. Only one local owner can connect.
        unsafe {
            ServerOptions::new()
                .first_pipe_instance(true)
                .reject_remote_clients(true)
                .create_with_security_attributes_raw(endpoint, ptr::from_mut(&mut attrs).cast())
        }
        .map_err(|_| "DEV 本机通道不可用。".into())
    }
}

#[tauri::command]
pub(crate) async fn plugin_dev_begin(
    webview: tauri::Webview,
) -> Result<Option<DevPairing>, String> {
    let url = webview.url().map_err(|_| "调用来源不可用。")?;
    super::check_product(
        webview.window().label(),
        webview.label(),
        &url.origin().ascii_serialization(),
    )?;
    #[cfg(not(windows))]
    {
        Err("此目标的 DEV ACL 通道尚未验收。".into())
    }
    #[cfg(windows)]
    {
        let app = webview.app_handle().clone();
        let selector = app.clone();
        let selected = tauri::async_runtime::spawn_blocking(move || {
            selector.dialog().file().blocking_pick_folder()
        })
        .await
        .map_err(|_| "项目选择不可用。")?;
        let Some(selected) = selected else {
            return Ok(None);
        };
        let selected = selected.into_path().map_err(|_| "项目目录不可用。")?;
        begin_selected(app, selected)
    }
}

#[cfg(windows)]
pub(crate) fn begin_selected(
    app: tauri::AppHandle,
    selected: PathBuf,
) -> Result<Option<DevPairing>, String> {
    let sessions = app.state::<DevSessions>();
    if std::fs::symlink_metadata(&selected)
        .map_err(|_| "项目不可用。")?
        .file_type()
        .is_symlink()
    {
        return Err("DEV 项目不得为链接。".into());
    }
    let project = std::fs::canonicalize(selected).map_err(|_| "项目不可用。")?;
    let file =
        std::fs::File::open(project.join("plugin.json")).map_err(|_| "缺少 plugin.json。")?;
    let mut manifest = vec![];
    std::io::Read::take(file, 262145)
        .read_to_end(&mut manifest)
        .map_err(|_| "清单不可用。")?;
    let manifest: am_plugin_protocol::PluginManifest =
        am_plugin_protocol::decode(&manifest).map_err(|_| "清单不符合 SDK。")?;
    let id = uuid::Uuid::new_v4();
    let root = app
        .state::<Arc<PluginAuthority>>()
        .path
        .parent()
        .ok_or("DEV 目录不可用。")?
        .to_path_buf()
        .join("plugin-dev")
        .join(id.to_string());
    std::fs::create_dir_all(&root).map_err(|_| "DEV 目录不可用。")?;
    local::protect(&root)?;
    let endpoint = format!("\\\\.\\pipe\\any-music-plugin-dev-{id}");
    let server = local::listen(&endpoint)?;
    let mut secret = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut secret);
    let token: String = secret.iter().map(|byte| format!("{byte:02x}")).collect();
    let pair_path = root.join("pairing.json");
    let expires = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "DEV 时钟不可用。")?
        .as_millis()
        + 120000;
    let pairing = serde_json::json!({"version":1,"endpoint":endpoint,"token":token,"expiresAt":expires,"projectRoot":project});
    std::fs::write(
        &pair_path,
        serde_json::to_vec(&pairing).map_err(|_| "DEV 配对不可用。")?,
    )
    .map_err(|_| "DEV 配对不可用。")?;
    sessions.stop();
    let cancel = CancellationToken::new();
    let mut authority = PluginAuthority::new(root.join("authority"));
    Arc::get_mut(&mut authority).expect("new DEV authority").dev = true;
    Arc::get_mut(&mut authority)
        .expect("new DEV authority")
        .admitted = app.state::<Arc<PluginAuthority>>().admitted;
    *sessions.0.lock().map_err(|_| "DEV 会话不可用。")? = Some(DevHost {
        cancel: cancel.clone(),
        authority: authority.clone(),
    });
    let cleanup = pair_path.clone();
    let teardown = authority.clone();
    let preview_only = !authority.admitted;
    tauri::async_runtime::spawn(async move {
        let connected = tokio::select! { _ = cancel.cancelled() => false, result = tokio::time::timeout(Duration::from_secs(120), server.connect()) => matches!(result, Ok(Ok(()))) };
        if connected {
            let _ = serve(
                server,
                token,
                cleanup.clone(),
                manifest.id,
                authority,
                cancel,
                app,
            )
            .await;
        }
        if let Ok(installs) = teardown.with(|r| r.snapshot()) {
            for install in installs {
                let _ = teardown.with(|r| r.revoke(&install.install_id));
                teardown.cancel_network(&install.install_id);
            }
        }
        let _ = std::fs::remove_file(cleanup);
    });
    Ok(Some(DevPairing {
        pairing_path: pair_path.to_string_lossy().into(),
        preview_only,
    }))
}

#[tauri::command]
pub(crate) async fn plugin_dev_end(
    webview: tauri::Webview,
    sessions: tauri::State<'_, DevSessions>,
) -> Result<(), String> {
    let url = webview.url().map_err(|_| "调用来源不可用。")?;
    super::check_product(
        webview.window().label(),
        webview.label(),
        &url.origin().ascii_serialization(),
    )?;
    sessions.stop();
    webview
        .app_handle()
        .state::<super::executor::Executors>()
        .stop_all();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn snapshots_bind_exact_package_hash_plugin_session_and_epoch() {
        let corpus: Vec<serde_json::Value> = serde_json::from_str(include_str!(
            "../../../../../packages/plugin-sdk/test/fixtures/packages/corpus.json"
        ))
        .unwrap();
        let entry = corpus
            .iter()
            .find(|entry| entry["name"] == "unsigned-store")
            .unwrap();
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(entry["base64"].as_str().unwrap())
            .unwrap();
        let package = am_plugin_package::verify(bytes.clone(), || false).unwrap();
        let message = |session: &str, epoch, hash: &str| Message::Snapshot {
            session: session.into(),
            previous_epoch: epoch,
            hash: hash.into(),
            bytes: entry["base64"].as_str().unwrap().into(),
        };
        let id = package.manifest().id.as_str();
        assert_eq!(
            snapshot_bytes(message("s", 2, package.content_hash()), "s", 2, id).unwrap(),
            bytes
        );
        assert!(snapshot_bytes(message("other", 2, package.content_hash()), "s", 2, id).is_err());
        assert!(snapshot_bytes(message("s", 1, package.content_hash()), "s", 2, id).is_err());
        assert!(snapshot_bytes(message("s", 2, &"0".repeat(64)), "s", 2, id).is_err());
        assert!(
            snapshot_bytes(
                message("s", 2, package.content_hash()),
                "s",
                2,
                "org.other.plugin"
            )
            .is_err()
        );
    }
    #[tokio::test]
    async fn rejects_oversized_and_unknown_frames_before_package_parse() {
        let body = br#"{"type":"pair","version":1,"token":"pair-token"}"#;
        let mut pair_frame = (body.len() as u32).to_be_bytes().to_vec();
        pair_frame.extend_from_slice(body);
        let Message::Pair { version, token } =
            receive(&mut pair_frame.as_slice(), 1024).await.unwrap()
        else {
            panic!("Expected a pairing frame");
        };
        assert_eq!(version, 1);
        assert_eq!(token, "pair-token");
        let frame = (25u32 * 1024 * 1024).to_be_bytes().as_slice().to_vec();
        assert!(receive(&mut frame.as_slice(), 1024).await.is_err());
        assert!(
            snapshot_bytes(
                Message::Pair {
                    version: 1,
                    token: "secret".into()
                },
                "s",
                0,
                "p"
            )
            .is_err()
        );
        assert!(
            snapshot_bytes(
                Message::Snapshot {
                    session: "wrong".into(),
                    previous_epoch: 0,
                    hash: "a".repeat(64),
                    bytes: String::new()
                },
                "s",
                0,
                "p"
            )
            .is_err()
        );
    }
    #[cfg(windows)]
    #[tokio::test]
    async fn owner_only_pipe_is_single_use_and_rejects_a_second_server() {
        let endpoint = format!("\\\\.\\pipe\\any-music-plugin-dev-{}", uuid::Uuid::new_v4());
        let server = local::listen(&endpoint).unwrap();
        assert!(local::listen(&endpoint).is_err());
        let client = tokio::net::windows::named_pipe::ClientOptions::new()
            .open(&endpoint)
            .unwrap();
        server.connect().await.unwrap();
        drop(client);
        drop(server);
    }
}
