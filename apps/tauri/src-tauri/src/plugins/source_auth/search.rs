//! One account identity is retained for each lazy source listing.
use super::super::PluginAuthority;
use super::{Context, read_credential, transport};
use am_plugin_net::{Exit, Gate};
use am_plugin_runtime::Level;
use std::sync::Arc;
use tauri::Manager;

/// The fixed gateway search never executes guest code or returns credentials to a guest.
pub(crate) async fn search(
    app: &tauri::AppHandle,
    authority: Arc<PluginAuthority>,
    id: &str,
    account_id: Option<&str>,
    input: &str,
    without_login: bool,
) -> Result<Option<String>, String> {
    let Some(context) = Context::try_open(authority.clone(), id, input, Level::L1)? else {
        return Ok(None);
    };
    if authority.dev {
        return Err("DEV 来源认证尚不可用，请安装经确认的插件包后使用。".into());
    }
    let query = am_plugin_protocol::parse_json(input.as_bytes()).map_err(|_| "搜索输入无效。")?;
    if !query.as_object().is_some_and(|o| {
        o.keys()
            .all(|k| matches!(k.as_str(), "query" | "pageNumber" | "pageSize"))
    }) || query["query"].as_str().is_none_or(|s| s.len() > 4096)
        || !query["pageNumber"]
            .as_u64()
            .is_some_and(|n| (1..=50).contains(&n))
        || !query["pageSize"]
            .as_u64()
            .is_some_and(|n| (1..=100).contains(&n))
    {
        return Err("搜索输入超出范围。".into());
    }
    let state = app.state::<crate::state::RuntimeState>();
    let platform = format!("external:{id}");
    let account = {
        let s = state.snapshot.lock().unwrap();
        let matches =
            |a: &&crate::model::Account| a.platform_id == platform && a.enabled && !a.pending;
        if without_login {
            None
        } else if let Some(account_id) = account_id {
            s.accounts
                .iter()
                .filter(matches)
                .find(|a| a.id == account_id)
        } else {
            s.accounts
                .iter()
                .filter(matches)
                .find(|a| {
                    a.authentication == "credential"
                        && a.state.login == crate::accounts::state::LoginState::SignedIn
                })
                .or_else(|| {
                    s.accounts
                        .iter()
                        .filter(matches)
                        .find(|a| a.authentication == "anonymous")
                })
        }
        .cloned()
    };
    if account_id.is_some() && account.is_none() && !without_login {
        return Err("not-authenticated:列表使用的来源账号已移除，请重新加载。".into());
    }
    let _usage = account
        .as_ref()
        .map(|a| state.use_account(&a.id, "来源搜索"))
        .transpose()?;
    let operation_key = account
        .as_ref()
        .map_or_else(|| format!("source:{id}"), |a| a.id.clone());
    let flight = state.source_auth.acquire(&operation_key, "")?;
    if let Some(account) = &account
        && !state.account(&account.id)?.enabled
    {
        return Err("operation-cancelled:账号已停用。".into());
    }
    let token = match &account {
        Some(a) if a.authentication == "credential" => {
            if let Some(error) = a.content_error() {
                return Err(error.into());
            }
            let credential = read_credential(&state, a, &context.binding)?;
            Some(credential.token)
        }
        _ if context.config.allow_unauthenticated => None,
        _ => return Err("not-authenticated:此来源必须登录，请先添加账号。".into()),
    };
    let gate = context.gate()?;
    let result = transport::request(
        &gate,
        &context.config.api_base_url,
        "search",
        &query,
        token.as_deref(),
        &flight.cancel,
    )
    .await;
    if result
        .as_ref()
        .is_err_and(|e| e.starts_with("not-authenticated:"))
        && let Some(account) = &account
    {
        state.status(&account.id, "expired")?;
    }
    let result = result?;
    let bytes = serde_json::to_vec(&result).map_err(|_| "目录响应无效。")?;
    am_plugin_protocol::decode_value("WireTrackPage", &bytes).map_err(|_| "目录响应无效。")?;
    if result["pageNumber"] != query["pageNumber"]
        || result["pageSize"] != query["pageSize"]
        || result["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["source"]["pluginId"] != context.plugin_id)
    {
        return Err("来源返回的分页或曲目身份不匹配。".into());
    }
    let mut text = Some(String::from_utf8(bytes).map_err(|_| "目录响应编码无效。")?);
    let mut output = None;
    gate.deliver(Exit::Sandbox, 0, &mut || {
        if flight.cancel.is_cancelled() {
            return Err(am_plugin_net::Error::Cancelled);
        }
        output = text.take();
        Ok(())
    })
    .map_err(|_| "来源请求已撤销。")?;
    Ok(output)
}
