//! Public identity and append-only name periods. Credentials and runtime UUIDs are never reused.
use crate::model::Snapshot;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NamePeriod {
    pub name: String,
    pub from_ms: u64,
    pub until_ms: Option<u64>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountHistory {
    pub account_id: String,
    pub platform_id: String,
    pub platform_user_id: Option<String>,
    pub names: Vec<NamePeriod>,
    pub removed_at_ms: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountLabel<'a> {
    pub name: &'a str,
    pub active_account_id: Option<&'a str>,
}

/// Called inside the snapshot transaction: rename, identity binding and removal commit together.
pub fn record(snapshot: &mut Snapshot, now: u64) {
    let mut pending: HashMap<_, _> = snapshot
        .accounts
        .iter()
        .filter(|account| !account.pending)
        .map(|account| (account.id.as_str(), account))
        .collect();
    for history in &mut snapshot.account_history {
        // Preserve ordered intervals even if the wall clock moves backwards.
        let now = now.max(history.names.last().map_or(0, |period| period.from_ms));
        if let Some(account) = pending.remove(history.account_id.as_str()) {
            history
                .platform_user_id
                .clone_from(&account.platform_user_id);
            if history
                .names
                .last()
                .is_none_or(|period| period.name != account.name)
            {
                if let Some(last) = history.names.last_mut() {
                    last.until_ms = Some(now);
                }
                history.names.push(NamePeriod {
                    name: account.name.clone(),
                    from_ms: now,
                    until_ms: None,
                });
            }
        } else if history.removed_at_ms.is_none() {
            history.removed_at_ms = Some(now);
            if let Some(last) = history.names.last_mut() {
                last.until_ms = Some(now);
            }
        }
    }
    for account in &snapshot.accounts {
        if pending.contains_key(account.id.as_str()) {
            snapshot.account_history.push(AccountHistory {
                account_id: account.id.clone(),
                platform_id: account.platform_id.clone(),
                platform_user_id: account.platform_user_id.clone(),
                names: vec![NamePeriod {
                    name: account.name.clone(),
                    from_ms: now,
                    until_ms: None,
                }],
                removed_at_ms: None,
            });
        }
    }
}

/// Only native platform evidence calls this; renderer names cannot establish account identity.
pub fn bind(snapshot: &mut Snapshot, account_id: &str, user_id: &str) -> Result<(), String> {
    if user_id.is_empty()
        || user_id.len() > 128
        || !user_id.bytes().all(|b| b.is_ascii_digit())
        || user_id.bytes().all(|b| b == b'0')
    {
        return Err("invalid-response:平台未返回有效的账号身份，请重新登录。".into());
    }
    let user_id = user_id.trim_start_matches('0');
    let account = snapshot
        .accounts
        .iter()
        .find(|a| a.id == account_id)
        .ok_or("账号不存在。")?;
    if account
        .platform_user_id
        .as_deref()
        .is_some_and(|id| id != user_id)
    {
        return Err("invalid-input:此登录环境已绑定其他平台账号，请添加新的账号后登录。".into());
    }
    if let Some(existing) = snapshot.accounts.iter().find(|other| {
        other.id != account_id
            && other.platform_id == account.platform_id
            && other.platform_user_id.as_deref() == Some(user_id)
    }) {
        return Err(format!(
            "invalid-input:此平台账号已添加为“{}”，请使用已有账号；可删除当前未完成的条目。",
            existing.name
        ));
    }
    snapshot
        .accounts
        .iter_mut()
        .find(|a| a.id == account_id)
        .unwrap()
        .platform_user_id = Some(user_id.into());
    Ok(())
}

/// One index per snapshot avoids scanning all historical incarnations for every song.
pub fn labels(snapshot: &Snapshot) -> HashMap<&str, AccountLabel<'_>> {
    let by_id: HashMap<_, _> = snapshot
        .accounts
        .iter()
        .filter(|a| !a.pending)
        .map(|account| (account.id.as_str(), account))
        .collect();
    let mut latest = HashMap::new();
    for history in &snapshot.account_history {
        if let Some(user) = history.platform_user_id.as_deref() {
            latest.insert((history.platform_id.as_str(), user), history);
        }
    }
    let active: HashMap<_, _> = snapshot
        .accounts
        .iter()
        .filter(|a| !a.pending)
        .filter_map(|account| {
            account
                .platform_user_id
                .as_deref()
                .map(|user| ((account.platform_id.as_str(), user), account))
        })
        .collect();
    snapshot
        .account_history
        .iter()
        .filter_map(|history| {
            let key = history
                .platform_user_id
                .as_deref()
                .map(|user| (history.platform_id.as_str(), user));
            let account = key
                .and_then(|key| active.get(&key).copied())
                .or_else(|| by_id.get(history.account_id.as_str()).copied());
            let current = key
                .and_then(|key| latest.get(&key).copied())
                .unwrap_or(history);
            let name = account
                .map(|a| a.name.as_str())
                .or_else(|| current.names.last().map(|n| n.name.as_str()))?;
            Some((
                history.account_id.as_str(),
                AccountLabel {
                    name,
                    active_account_id: account.map(|a| a.id.as_str()),
                },
            ))
        })
        .collect()
}

pub fn bilibili_user(store: &reqwest_cookie_store::CookieStore) -> Result<String, String> {
    store
        .get_request_values(&"https://www.bilibili.com/".parse().unwrap())
        .filter(|(name, _)| *name == "DedeUserID")
        .map(|(_, value)| value.to_owned())
        .last()
        .ok_or_else(|| "invalid-response:登录凭证缺少平台用户 ID，请重新登录。".into())
}

/// Serialize duplicate admission, credential persistence and public identity publication.
pub fn commit_login(
    state: &crate::state::RuntimeState,
    account_id: &str,
    session: &crate::state::AccountSession,
    user_id: &str,
    agent: Option<String>,
    complete: bool,
) -> Result<(), String> {
    state.mutate(|snapshot| {
        if state.usage.is_deleting(account_id) || session.cancelled.is_cancelled() {
            return Err("operation-cancelled:登录已取消。".into());
        }
        let account = snapshot.accounts.iter().find(|a| a.id == account_id).ok_or("账号不存在。")?;
        let unresolved = snapshot.accounts.iter().any(|other| {
            other.id != account_id
                && other.platform_id == account.platform_id
                && other.authentication == "credential"
                && !other.pending
                && other.platform_user_id.is_none()
        });
        if unresolved {
            return Err("invalid-input:此平台已有账号的身份尚未确认，请先检测已有账号的登录状态，再添加账号。".into());
        }
        bind(snapshot, account_id, user_id)?;
        let mut bytes = Vec::new();
        cookie_store::serde::json::save_incl_expired_and_nonpersistent(
            &session.cookies.lock().unwrap(),
            &mut bytes,
        )
        .map_err(|_| "无法序列化凭证。")?;
        crate::storage::vault::write_atomic(
            &state.directory.join(format!("{account_id}.vault")),
            &crate::storage::vault::seal(&state.key()?, &bytes)?,
        )?;
        let account = snapshot
            .accounts
            .iter_mut()
            .find(|a| a.id == account_id)
            .ok_or("账号不存在。")?;
        account.authentication = "credential".into();
        account.pending = false;
        if let Some(agent) = agent {
            account.user_agent = agent;
        }
        if complete {
            account.complete_login();
        } else {
            account.confirm_identity();
        }
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{RuntimeState, add_test_account};

    fn runtime() -> RuntimeState {
        RuntimeState::new(
            std::env::temp_dir().join(format!("any-music-identities-{}", uuid::Uuid::new_v4())),
        )
        .unwrap()
    }

    #[test]
    fn renames_deletion_readdition_and_restart_preserve_every_name_period() {
        let state = runtime();
        let first = add_test_account(&state, "bilibili");
        state
            .mutate(|snapshot| {
                bind(snapshot, &first.id, "0012")?;
                snapshot.accounts[0].name = "最初名称".into();
                Ok(())
            })
            .unwrap();
        for name in ["第二阶段", "最初名称"] {
            state
                .mutate(|snapshot| {
                    snapshot.accounts[0].name = name.into();
                    Ok(())
                })
                .unwrap();
        }
        let before = state.snapshot.lock().unwrap().account_history[0]
            .names
            .len();
        state.status(&first.id, "expired").unwrap();
        assert_eq!(
            state.snapshot.lock().unwrap().account_history[0]
                .names
                .len(),
            before
        );
        state
            .mutate(|snapshot| {
                snapshot.accounts.clear();
                Ok(())
            })
            .unwrap();
        let replacement = add_test_account(&state, "bilibili");
        assert_ne!(first.id, replacement.id);
        state
            .mutate(|snapshot| {
                bind(snapshot, &replacement.id, "12")?;
                snapshot.accounts[0].name = "重新添加名称".into();
                Ok(())
            })
            .unwrap();
        let directory = state.directory.clone();
        drop(state);
        let state = RuntimeState::new(directory.clone()).unwrap();
        {
            let snapshot = state.snapshot.lock().unwrap();
            let history = &snapshot.account_history[0];
            assert_eq!(
                history
                    .names
                    .iter()
                    .map(|period| period.name.as_str())
                    .collect::<Vec<_>>(),
                vec![first.name.as_str(), "最初名称", "第二阶段", "最初名称"]
            );
            assert!(history.removed_at_ms.is_some());
            assert!(history.names.iter().all(|period| period.until_ms.is_some()));
            let labels = labels(&snapshot);
            for id in [&first.id, &replacement.id] {
                assert_eq!(labels[id.as_str()].name, "重新添加名称");
                assert_eq!(
                    labels[id.as_str()].active_account_id,
                    Some(replacement.id.as_str())
                );
            }
        }
        state
            .mutate(|snapshot| {
                snapshot.accounts.clear();
                Ok(())
            })
            .unwrap();
        assert_eq!(
            labels(&state.snapshot.lock().unwrap())[first.id.as_str()].name,
            "重新添加名称"
        );
        drop(state);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn duplicates_are_rejected_before_credential_writes_even_when_disabled() {
        let state = runtime();
        let first = add_test_account(&state, "bilibili");
        let second = add_test_account(&state, "bilibili");
        let other = add_test_account(&state, "douyin");
        state
            .mutate(|snapshot| {
                bind(snapshot, &first.id, "12")?;
                snapshot.accounts[0].enabled = false;
                bind(snapshot, &other.id, "12")
            })
            .unwrap();
        let before = serde_json::to_value(state.snapshot.lock().unwrap().clone()).unwrap();
        let session = state.session(&second.id).unwrap();
        let error = commit_login(&state, &second.id, &session, "12", None, true).unwrap_err();
        assert!(error.contains("已添加为"));
        assert!(
            !state
                .directory
                .join(format!("{}.vault", second.id))
                .exists()
        );
        assert_eq!(
            serde_json::to_value(state.snapshot.lock().unwrap().clone()).unwrap(),
            before
        );
        for invalid in ["", "0", "-1", "12a", "1.2"] {
            assert!(
                state
                    .mutate(|snapshot| bind(snapshot, &second.id, invalid))
                    .is_err()
            );
        }
        assert!(
            state
                .mutate(|snapshot| bind(snapshot, &first.id, "13"))
                .unwrap_err()
                .contains("已绑定其他")
        );
        let directory = state.directory.clone();
        drop(state);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn unresolved_existing_credentials_require_an_identity_check_before_another_login() {
        let state = runtime();
        let existing = add_test_account(&state, "bilibili");
        let candidate = add_test_account(&state, "bilibili");
        state
            .mutate(|snapshot| {
                snapshot.accounts[0].authentication = "credential".into();
                Ok(())
            })
            .unwrap();
        let session = state.session(&candidate.id).unwrap();
        let error = commit_login(&state, &candidate.id, &session, "12", None, true).unwrap_err();
        assert!(error.contains("先检测"));
        assert!(
            !state
                .directory
                .join(format!("{}.vault", candidate.id))
                .exists()
        );
        crate::accounts::session::confirm_identity(&state, &existing.id, "12").unwrap();
        assert!(
            commit_login(&state, &candidate.id, &session, "12", None, true)
                .unwrap_err()
                .contains("已添加为")
        );
        let directory = state.directory.clone();
        drop(state);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn recording_before_the_first_edit_retains_the_current_name_and_clock_order() {
        let state = runtime();
        let account = add_test_account(&state, "bilibili");
        state.snapshot.lock().unwrap().account_history.clear();
        state
            .mutate(|snapshot| {
                snapshot.accounts[0].name = "新名称".into();
                Ok(())
            })
            .unwrap();
        {
            let mut snapshot = state.snapshot.lock().unwrap();
            assert_eq!(snapshot.account_history[0].names[0].name, account.name);
            snapshot.accounts[0].name = "时钟回拨后".into();
            record(&mut snapshot, 0);
            let names = &snapshot.account_history[0].names;
            assert!(
                names
                    .windows(2)
                    .all(|pair| pair[0].from_ms <= pair[1].from_ms
                        && pair[0].until_ms == Some(pair[1].from_ms))
            );
        }
        let directory = state.directory.clone();
        drop(state);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn simultaneous_logins_admit_exactly_one_local_account_for_a_platform_user() {
        let state = std::sync::Arc::new(runtime());
        let accounts = [
            add_test_account(&state, "douyin"),
            add_test_account(&state, "douyin"),
        ];
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let tasks: Vec<_> = accounts
            .into_iter()
            .map(|account| {
                let state = state.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    state.mutate(|snapshot| bind(snapshot, &account.id, "88"))
                })
            })
            .collect();
        assert_eq!(
            tasks
                .into_iter()
                .map(|task| task.join().unwrap())
                .filter(Result::is_ok)
                .count(),
            1
        );
        assert_eq!(
            state
                .snapshot
                .lock()
                .unwrap()
                .accounts
                .iter()
                .filter(|a| a.platform_user_id.as_deref() == Some("88"))
                .count(),
            1
        );
        let directory = state.directory.clone();
        drop(state);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
