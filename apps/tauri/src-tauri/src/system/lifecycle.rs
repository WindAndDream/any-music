//! Mobile suspension ends transient native work. Foregrounding never replays requests,
//! logins, media grants or credentials; committed product generations remain intact.
use crate::state::RuntimeState;

pub(crate) fn clear_transient(state: &RuntimeState) {
    state.download_schedules.clear();
    state.requests.lock().unwrap().cancel_all();
    for session in state
        .sessions
        .lock()
        .unwrap()
        .drain()
        .map(|(_, value)| value)
    {
        session.cancelled.cancel();
    }
    // Same-device QR authorization intentionally leaves the app. Preserve only an
    // explicitly opened native session within its original expiry, never replay work.
    state.qr.lock().unwrap().retain(|_, qr| {
        let retain = qr.handoff.as_ref().is_some_and(|handoff| {
            handoff.opened
                && handoff.expires > std::time::Instant::now()
                && !qr.session.cancelled.is_cancelled()
        });
        if !retain {
            qr.session.cancelled.cancel();
        }
        retain
    });
    state.media.lock().unwrap().clear();
    state.renderer_uses.lock().unwrap().clear();
    *state.key.lock().unwrap() = None;
}

#[cfg(mobile)]
pub(crate) fn suspend(app: &tauri::AppHandle) {
    use tauri::Manager;
    clear_transient(&app.state::<RuntimeState>());
    app.state::<std::sync::Arc<crate::plugins::PluginAuthority>>()
        .suspend_acquisitions();
    // The mobile driver has no executor realm; no background execution is promised.
    app.state::<crate::plugins::executor::Executors>()
        .stop_all();
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_opened_unexpired_qr_handoff_survives_suspension() {
        let directory = std::env::temp_dir().join(format!("qr-lifecycle-{}", uuid::Uuid::new_v4()));
        let state = RuntimeState::new(directory.clone()).unwrap();
        let mut retained = None;
        for (opened, expired, cancelled) in [
            (true, false, false),
            (false, false, false),
            (true, true, false),
            (true, false, true),
        ] {
            let account = crate::state::add_test_account(&state, "bilibili");
            let session = state
                .create_session(&account, reqwest_cookie_store::CookieStore::default())
                .unwrap();
            if cancelled {
                session.cancelled.cancel();
            }
            let now = std::time::Instant::now();
            state.qr.lock().unwrap().insert(
                account.id.clone(),
                crate::state::QrSession {
                    _usage: None,
                    key: "public".into(),
                    douyin: None,
                    generation: "generation".into(),
                    session: session.clone(),
                    handoff: Some(crate::state::QrHandoff {
                        url: "bilibili://browser/".into(),
                        opened,
                        expires: if expired {
                            now - std::time::Duration::from_secs(1)
                        } else {
                            now + std::time::Duration::from_secs(180)
                        },
                    }),
                },
            );
            if opened && !expired && !cancelled {
                retained = Some((account.id, session));
            }
        }
        clear_transient(&state);
        let (id, session) = retained.unwrap();
        assert_eq!(state.qr.lock().unwrap().len(), 1);
        assert!(state.qr.lock().unwrap().contains_key(&id));
        assert!(!session.cancelled.is_cancelled());
        state.clear_qr(&id);
        assert!(session.cancelled.is_cancelled());
        clear_transient(&state);
        assert!(state.qr.lock().unwrap().is_empty());
        drop(state);
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn suspension_cancels_work_without_changing_durable_accounts_or_product_data() {
        let directory =
            std::env::temp_dir().join(format!("s16-lifecycle-{}", uuid::Uuid::new_v4()));
        let state = RuntimeState::new(directory.clone()).unwrap();
        let account = crate::state::add_test_account(&state, "bilibili");
        let session = state.session(&account.id).unwrap();
        let request = state.requests.lock().unwrap().begin("pending").unwrap();
        let accounts = std::fs::read(directory.join("accounts.json")).unwrap();
        std::fs::write(directory.join("product.json"), b"committed-generation").unwrap();
        *state.key.lock().unwrap() = Some([1; 32]);
        clear_transient(&state);
        clear_transient(&state);
        assert!(request.is_cancelled());
        assert!(session.cancelled.is_cancelled());
        assert!(state.sessions.lock().unwrap().is_empty());
        assert!(state.key.lock().unwrap().is_none());
        assert_eq!(
            std::fs::read(directory.join("accounts.json")).unwrap(),
            accounts
        );
        assert_eq!(
            std::fs::read(directory.join("product.json")).unwrap(),
            b"committed-generation"
        );
        let fresh = state.session(&account.id).unwrap();
        assert!(!fresh.cancelled.is_cancelled());
        assert!(!std::sync::Arc::ptr_eq(&fresh, &session));
        drop(state);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
