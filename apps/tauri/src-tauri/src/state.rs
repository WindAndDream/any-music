use crate::{
    model::{Account, Snapshot},
    storage::vault,
};
use reqwest_cookie_store::{CookieStore, CookieStoreMutex};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;

pub type CredentialKeyLoader = Arc<dyn Fn() -> Result<[u8; 32], String> + Send + Sync>;

pub const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
pub struct AccountSession {
    pub cookies: Arc<CookieStoreMutex>,
    pub client: reqwest::Client,
    pub route_clients: Mutex<HashMap<Option<String>, reqwest::Client>>,
    pub queue: Semaphore,
    pub cancelled: CancellationToken,
    pub failures: Mutex<u32>,
}
#[derive(Clone)]
pub struct QrHandoff {
    pub url: String,
    pub expires: std::time::Instant,
    pub opened: bool,
}
#[derive(Clone)]
pub struct QrSession {
    pub _usage: Option<Arc<crate::accounts::usage::AccountUse>>,
    pub key: String,
    pub handoff: Option<QrHandoff>,
    pub douyin: Option<crate::accounts::douyin_login::DouyinQr>,
    pub generation: String,
    pub session: Arc<AccountSession>,
}
pub struct RuntimeState {
    #[cfg(desktop)]
    pub(crate) source_auth: crate::plugins::source_auth::AuthState,
    #[cfg(any(desktop, target_os = "android"))]
    pub(crate) artwork: crate::media::artwork::ArtworkState,
    pub(crate) resource_cache: crate::storage::resource_cache::ResourceCache,
    pub(crate) download_schedules: crate::system::download_scheduler::DownloadSchedules,
    pub(crate) downloads: crate::system::download_directory::DownloadPreferences,
    pub credential_key_loader: Option<CredentialKeyLoader>,
    pub usage: Arc<crate::accounts::usage::UsageRegistry>,
    pub active_proxies: Arc<Mutex<HashMap<String, String>>>,
    pub renderer_uses: Mutex<HashMap<String, (String, crate::accounts::usage::AccountUse)>>,
    pub douyin_browsers: crate::browser::douyin_browser::Manager,
    pub experiments: crate::browser::login_experiment::Manager,
    pub directory: PathBuf,
    pub snapshot: Mutex<Snapshot>,
    pub sessions: Mutex<HashMap<String, Arc<AccountSession>>>,
    pub requests: Mutex<crate::network::request_registry::RequestRegistry>,
    pub browsers: Mutex<HashMap<String, crate::browser::verification::BrowserProcess>>,
    pub browser_login_ids: Mutex<HashMap<String, String>>,
    pub qr: Mutex<HashMap<String, QrSession>>,
    pub media: Mutex<HashMap<String, crate::media::MediaGrant>>,
    pub media_port: Mutex<u16>,
    pub key: Mutex<Option<[u8; 32]>>,
}
impl RuntimeState {
    pub fn new(directory: PathBuf) -> Result<Self, String> {
        std::fs::create_dir_all(&directory).map_err(|_| "无法创建应用数据目录。")?;
        let path = directory.join("accounts.json");
        vault::recover_atomic(&path)?;
        let mut snapshot: Snapshot = if path.exists() {
            serde_json::from_slice(&std::fs::read(&path).map_err(|_| "无法读取账号配置。")?)
                .map_err(|_| "账号配置损坏。")?
        } else {
            // Accounts are explicitly added by the user, including anonymous accounts.
            let snapshot = Snapshot::default();
            vault::write_atomic(
                &path,
                &serde_json::to_vec(&snapshot).map_err(|_| "初始化账号失败。")?,
            )?;
            snapshot
        };
        let account_count = snapshot.accounts.len();
        let drafts: Vec<_> = snapshot
            .accounts
            .iter()
            .filter(|a| a.pending)
            .map(|a| a.id.clone())
            .collect();
        for id in drafts {
            // Native processes do not resume after restart. A locked Profile stays as a
            // hidden draft and may be reopened by name; completed accounts are untouched.
            if crate::accounts::deletion::detach(&directory, &id).is_ok() {
                snapshot.accounts.retain(|a| a.id != id);
            }
        }
        if snapshot.accounts.len() != account_count {
            vault::write_atomic(
                &path,
                &serde_json::to_vec(&snapshot).map_err(|_| "无法恢复登录草稿。")?,
            )?;
        }
        for account in &mut snapshot.accounts {
            // Pending login processes are not restored after an application restart.
            account.resume_after_login();
        }
        Ok(Self {
            #[cfg(desktop)]
            source_auth: Default::default(),
            #[cfg(any(desktop, target_os = "android"))]
            artwork: crate::media::artwork::ArtworkState::new()?,
            resource_cache: crate::storage::resource_cache::ResourceCache::new(
                directory.clone(),
                directory.join("cache"),
            ),
            download_schedules: Default::default(),
            downloads: Default::default(),
            credential_key_loader: None,
            usage: Arc::default(),
            active_proxies: Arc::default(),
            renderer_uses: Mutex::default(),
            douyin_browsers: crate::browser::douyin_browser::Manager::default(),
            experiments: crate::browser::login_experiment::Manager::default(),
            directory,
            snapshot: Mutex::new(snapshot),
            sessions: Mutex::new(HashMap::new()),
            requests: Mutex::new(crate::network::request_registry::RequestRegistry::default()),
            browsers: Mutex::new(HashMap::new()),
            browser_login_ids: Mutex::default(),
            qr: Mutex::new(HashMap::new()),
            media: Mutex::new(HashMap::new()),
            media_port: Mutex::new(0),
            key: Mutex::new(None),
        })
    }
    pub fn account(&self, id: &str) -> Result<Account, String> {
        crate::model::validate_id(id)?;
        if self.usage.is_deleting(id) {
            return Err("operation-cancelled:账号正在删除，旧操作已中止。".into());
        }
        let account = self
            .snapshot
            .lock()
            .unwrap()
            .accounts
            .iter()
            .find(|a| a.id == id)
            .cloned()
            .ok_or_else(|| "账号不存在。".to_string())?;
        if !(cfg!(desktop) && account.platform_id.starts_with("external:")) {
            crate::system::capabilities::require_account_platform(&account.platform_id)?;
        }
        Ok(account)
    }
    pub fn use_account(
        &self,
        id: &str,
        reason: &str,
    ) -> Result<crate::accounts::usage::AccountUse, String> {
        let guard = self.usage.acquire(id, reason)?;
        self.account(id)?;
        Ok(guard)
    }
    /// Commit the replacement snapshot before exposing it to callers.
    pub fn mutate<R>(
        &self,
        change: impl FnOnce(&mut Snapshot) -> Result<R, String>,
    ) -> Result<R, String> {
        let mut current = self.snapshot.lock().unwrap();
        let mut next = current.clone();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        // Retain the currently known name before the first edit of an unrecorded account.
        crate::accounts::identity::record(&mut next, now);
        let result = change(&mut next)?;
        crate::accounts::identity::record(&mut next, now);
        vault::write_atomic(
            &self.directory.join("accounts.json"),
            &serde_json::to_vec(&next).map_err(|_| "配置序列化失败。")?,
        )?;
        *current = next;
        Ok(result)
    }
    pub fn status(&self, id: &str, status: &str) -> Result<(), String> {
        self.mutate(|snapshot| {
            let account = snapshot
                .accounts
                .iter_mut()
                .find(|a| a.id == id)
                .ok_or("账号不存在。")?;
            account.set_status(status);
            Ok(())
        })
    }
    pub fn pause_login(&self, id: &str) -> Result<(), String> {
        self.mutate(|snapshot| {
            snapshot
                .accounts
                .iter_mut()
                .find(|account| account.id == id)
                .ok_or("账号不存在。")?
                .pause_login();
            Ok(())
        })
    }
    pub fn key(&self) -> Result<[u8; 32], String> {
        let mut key = self.key.lock().unwrap();
        if let Some(value) = *key {
            return Ok(value);
        }
        let value = match &self.credential_key_loader {
            Some(load) => load()?,
            None => vault::load_key()?,
        };
        *key = Some(value);
        Ok(value)
    }
    pub fn session(&self, id: &str) -> Result<Arc<AccountSession>, String> {
        let account = self.account(id)?;
        if account.platform_id.starts_with("external:") {
            return Err("外置来源不能访问内置账号请求通道。".into());
        }
        let mut sessions = self.sessions.lock().unwrap();
        if let Some(value) = sessions.get(id) {
            return Ok(value.clone());
        }
        let path = self.directory.join(format!("{id}.vault"));
        vault::recover_atomic(&path)?;
        let store = if path.exists() {
            let bytes = vault::open(
                &self.key()?,
                &std::fs::read(path).map_err(|_| "无法读取加密凭证。")?,
            )?;
            cookie_store::serde::json::load(std::io::Cursor::new(bytes))
                .map_err(|_| "Cookie 存储损坏。")?
        } else {
            CookieStore::default()
        };
        let value = self.create_session(&account, store)?;
        sessions.insert(id.into(), value.clone());
        Ok(value)
    }
    pub fn create_session(
        &self,
        account: &Account,
        store: CookieStore,
    ) -> Result<Arc<AccountSession>, String> {
        let cookies = Arc::new(CookieStoreMutex::new(store));
        let active = self.active_proxy(account);
        let proxy = self
            .proxy_routes(account)?
            .into_iter()
            .find(|(id, _)| *id == active)
            .and_then(|(_, url)| url);
        let client = self.routed_client(account, cookies.clone(), proxy.as_deref())?;
        Ok(Arc::new(AccountSession {
            cookies,
            route_clients: Mutex::new(HashMap::from([(active, client.clone())])),
            client,
            queue: Semaphore::new(1),
            cancelled: CancellationToken::new(),
            failures: Mutex::new(0),
        }))
    }
    pub fn clear_qr(&self, id: &str) -> Option<QrSession> {
        let old = self.qr.lock().unwrap().remove(id);
        if let Some(value) = &old {
            value.session.cancelled.cancel();
            self.douyin_browsers.cancel(id);
        }
        old
    }
    pub fn save_credentials(&self, id: &str) -> Result<(), String> {
        let session = self.session(id)?;
        let mut bytes = Vec::new();
        cookie_store::serde::json::save_incl_expired_and_nonpersistent(
            &session.cookies.lock().unwrap(),
            &mut bytes,
        )
        .map_err(|_| "无法序列化凭证。")?;
        vault::write_atomic(
            &self.directory.join(format!("{id}.vault")),
            &vault::seal(&self.key()?, &bytes)?,
        )
    }
}

/// Native tests explicitly provision the identities they need instead of relying on startup seeds.
#[cfg(test)]
pub fn add_test_account(state: &RuntimeState, platform: &str) -> Account {
    let account = Account {
        id: uuid::Uuid::new_v4().to_string(),
        platform_id: platform.into(),
        name: format!("测试{platform}账号"),
        platform_user_id: None,
        status: "ready".into(),
        state: crate::accounts::state::AccountState::anonymous(),
        enabled: true,
        authentication: "credential".into(),
        pending: false,
        user_agent: USER_AGENT.into(),
        web_id: "1".into(),
        proxy_id: None,
        backup_proxy_ids: Vec::new(),
    };
    let mut account = account;
    account.complete_login();
    state
        .mutate(|snapshot| {
            snapshot.accounts.push(account.clone());
            Ok(())
        })
        .unwrap();
    account
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn first_launch_and_empty_restarts_never_create_accounts() {
        let directory =
            std::env::temp_dir().join(format!("any-music-empty-{}", uuid::Uuid::new_v4()));
        let state = RuntimeState::new(directory.clone()).unwrap();
        assert!(state.snapshot.lock().unwrap().accounts.is_empty());
        assert!(state.snapshot.lock().unwrap().proxies.is_empty());
        drop(state);
        let state = RuntimeState::new(directory.clone()).unwrap();
        assert!(state.snapshot.lock().unwrap().accounts.is_empty());
        add_test_account(&state, "bilibili");
        state
            .mutate(|snapshot| {
                snapshot.accounts.clear();
                Ok(())
            })
            .unwrap();
        drop(state);
        let state = RuntimeState::new(directory.clone()).unwrap();
        assert!(state.snapshot.lock().unwrap().accounts.is_empty());
        drop(state);
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn saved_accounts_are_preserved_on_restart() {
        let directory =
            std::env::temp_dir().join(format!("any-music-saved-{}", uuid::Uuid::new_v4()));
        let state = RuntimeState::new(directory.clone()).unwrap();
        let account = add_test_account(&state, "douyin");
        drop(state);
        let state = RuntimeState::new(directory.clone()).unwrap();
        let saved = state.account(&account.id).unwrap();
        assert_eq!(saved.name, account.name);
        assert_eq!(saved.platform_id, "douyin");
        assert_eq!(state.snapshot.lock().unwrap().accounts.len(), 1);
        drop(state);
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn pending_login_jar_does_not_share_business_cookies_or_cancellation() {
        let directory =
            std::env::temp_dir().join(format!("any-music-state-{}", uuid::Uuid::new_v4()));
        let state = RuntimeState::new(directory.clone()).unwrap();
        let account = add_test_account(&state, "bilibili");
        let business = state.session(&account.id).unwrap();
        let login = state
            .create_session(&account, CookieStore::default())
            .unwrap();
        let url = "https://www.bilibili.com/".parse().unwrap();
        login
            .cookies
            .lock()
            .unwrap()
            .parse(
                "SESSDATA=pending; Domain=bilibili.com; Path=/; Secure",
                &url,
            )
            .unwrap();
        assert_eq!(
            business
                .cookies
                .lock()
                .unwrap()
                .get_request_values(&url)
                .count(),
            0
        );
        state.qr.lock().unwrap().insert(
            account.id.clone(),
            QrSession {
                _usage: None,
                key: "key".into(),
                handoff: None,
                douyin: None,
                generation: "nonce".into(),
                session: login.clone(),
            },
        );
        state.clear_qr(&account.id);
        assert!(login.cancelled.is_cancelled());
        assert!(!business.cancelled.is_cancelled());
        drop(state);
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn credentials_keep_nonpersistent_cookies_across_encrypted_restart() {
        let mut store = CookieStore::default();
        let url = "https://www.douyin.com/".parse().unwrap();
        store
            .parse(
                "sessionid=private; Domain=douyin.com; Path=/; Secure; HttpOnly",
                &url,
            )
            .unwrap();
        let mut bytes = Vec::new();
        cookie_store::serde::json::save_incl_expired_and_nonpersistent(&store, &mut bytes).unwrap();
        let encrypted = vault::seal(&[1; 32], &bytes).unwrap();
        let decrypted = vault::open(&[1; 32], &encrypted).unwrap();
        let restored = cookie_store::serde::json::load(std::io::Cursor::new(decrypted)).unwrap();
        assert_eq!(
            restored.get_request_values(&url).collect::<Vec<_>>(),
            vec![("sessionid", "private")]
        );
    }
}
