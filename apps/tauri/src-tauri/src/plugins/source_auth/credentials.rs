//! Encrypted source credentials never enter product snapshots or guest state.
use serde::{Deserialize, Serialize};
use std::time::Instant;
use tokio_util::sync::CancellationToken;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Credential {
    pub(super) binding: String,
    pub(super) token: String,
    pub(super) user_id: String,
}

pub(super) fn commit(
    state: &crate::state::RuntimeState,
    id: &str,
    login: &str,
    credential: &Credential,
    cancel: &CancellationToken,
) -> Result<(), String> {
    // Same lock order as deletion: persisted account admission encloses the pending recheck.
    state.mutate(|s| {
        if cancel.is_cancelled()
            || state.usage.is_deleting(id)
            || !state
                .source_auth
                .pending
                .lock()
                .unwrap()
                .get(id)
                .is_some_and(|p| p.login == login && p.expires > Instant::now())
        {
            return Err("operation-cancelled:登录已取消。".into());
        }
        let account = s
            .accounts
            .iter()
            .find(|a| a.id == id)
            .ok_or("账号不存在。")?;
        if account
            .platform_user_id
            .as_ref()
            .is_some_and(|user| user != &credential.user_id)
        {
            return Err("此账号已绑定其他身份，请添加新账号。".into());
        }
        if s.accounts.iter().any(|a| {
            a.id != id
                && a.platform_id == account.platform_id
                && a.platform_user_id.as_ref() == Some(&credential.user_id)
        }) {
            return Err("此来源账号已添加，请使用已有账号。".into());
        }
        let bytes = serde_json::to_vec(credential).map_err(|_| "无法保存来源凭证。")?;
        crate::storage::vault::write_atomic(
            &state.directory.join(format!("{id}.vault")),
            &crate::storage::vault::seal(&state.key()?, &bytes)?,
        )?;
        let account = s.accounts.iter_mut().find(|a| a.id == id).unwrap();
        account.platform_user_id = Some(credential.user_id.clone());
        account.authentication = "credential".into();
        account.pending = false;
        account.complete_login();
        Ok(())
    })?;
    state.source_auth.pending.lock().unwrap().remove(id);
    Ok(())
}

pub(super) fn read_credential(
    state: &crate::state::RuntimeState,
    account: &crate::model::Account,
    binding: &str,
) -> Result<Credential, String> {
    let result = load_credential(state, account, binding);
    if result
        .as_ref()
        .is_err_and(|error| error.starts_with("not-authenticated:"))
        && !state.usage.is_deleting(&account.id)
    {
        // A changed configuration or unusable local token must reopen login in account UI.
        // Do not recreate deleted accounts or overwrite a replacement identity.
        state.mutate(|snapshot| {
            if let Some(current) = snapshot.accounts.iter_mut().find(|a| a.id == account.id)
                && current.platform_user_id == account.platform_user_id
                && current.authentication == "credential"
            {
                current.set_status("expired");
            }
            Ok(())
        })?;
    }
    result
}

fn load_credential(
    state: &crate::state::RuntimeState,
    account: &crate::model::Account,
    binding: &str,
) -> Result<Credential, String> {
    crate::model::validate_id(&account.id)?;
    let path = state.directory.join(format!("{}.vault", account.id));
    crate::storage::vault::recover_atomic(&path)?;
    if std::fs::metadata(&path)
        .map_err(|_| "not-authenticated:来源凭证不可用，请重新登录。")?
        .len()
        > 32768
    {
        return Err("not-authenticated:来源凭证超过预算，请重新登录。".into());
    }
    let bytes = crate::storage::vault::open(
        &state.key()?,
        &std::fs::read(path).map_err(|_| "not-authenticated:来源凭证不可用，请重新登录。")?,
    )
    .map_err(|_| "not-authenticated:来源凭证损坏，请重新登录。")?;
    let credential: Credential = serde_json::from_slice(&bytes)
        .map_err(|_| "not-authenticated:来源凭证无效，请重新登录。")?;
    if credential.binding != binding
        || Some(&credential.user_id) != account.platform_user_id.as_ref()
    {
        return Err("not-authenticated:来源认证配置已变更，请重新登录。".into());
    }
    Ok(credential)
}
