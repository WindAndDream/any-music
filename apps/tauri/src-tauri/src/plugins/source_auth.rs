//! Versioned, declarative source gateways. The host owns challenges, credentials and account
//! admission; package code can neither inspect tokens nor open an authentication browser.
mod context;
mod credentials;
mod search;
mod transport;
use super::PluginAuthority;
use am_plugin_net::{Exit, Gate};
use am_plugin_protocol::SourceAuthentication;
use am_plugin_runtime::Level;
use context::Context;
pub(super) use context::cancel_contexts;
use credentials::{Credential, commit, read_credential};
pub(crate) use search::search;
use serde::Deserialize;
use serde_json::{Value as Json, json};
use std::{
    collections::{BTreeMap, HashMap},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::Manager;
use tokio_util::sync::CancellationToken;

#[derive(Default)]
pub(crate) struct AuthState {
    pending: Mutex<HashMap<String, Pending>>,
    operations: Mutex<HashMap<String, (String, CancellationToken)>>,
    sms_cooldowns: Mutex<HashMap<String, Instant>>,
}
struct Pending {
    login: String,
    method: String,
    challenge: String,
    expires: Instant,
    next_poll: Instant,
    next_sms: Instant,
}
impl AuthState {
    fn reserve_sms(&self, id: &str, now: Instant) -> Result<Instant, String> {
        let mut cooldowns = self.sms_cooldowns.lock().unwrap();
        cooldowns.retain(|_, deadline| *deadline > now);
        if cooldowns.contains_key(id) {
            return Err("短信发送过于频繁，请稍后重试。".into());
        }
        if cooldowns.len() >= 256 {
            return Err("短信验证正在进行，请稍后重试。".into());
        }
        let deadline = now + Duration::from_secs(60);
        cooldowns.insert(id.into(), deadline);
        Ok(deadline)
    }
    pub(crate) fn cancel(&self, id: &str) {
        if let Some((_, token)) = self.operations.lock().unwrap().get(id) {
            token.cancel()
        }
        self.pending.lock().unwrap().remove(id);
    }
    fn cancel_login(&self, id: &str, login: &str) {
        if let Some((current, token)) = self.operations.lock().unwrap().get(id)
            && current == login
        {
            token.cancel()
        }
        let mut pending = self.pending.lock().unwrap();
        if pending.get(id).is_some_and(|p| p.login == login) {
            pending.remove(id);
        }
    }
    fn acquire(&self, id: &str, login: &str) -> Result<Flight<'_>, String> {
        let mut operations = self.operations.lock().unwrap();
        if operations.contains_key(id) {
            return Err("账号操作正在进行，请稍后重试。".into());
        }
        let cancel = CancellationToken::new();
        operations.insert(id.into(), (login.into(), cancel.clone()));
        Ok(Flight {
            state: self,
            id: id.into(),
            cancel,
        })
    }
}
struct Flight<'a> {
    state: &'a AuthState,
    id: String,
    cancel: CancellationToken,
}
impl Drop for Flight<'_> {
    fn drop(&mut self) {
        self.cancel.cancel();
        self.state.operations.lock().unwrap().remove(&self.id);
    }
}

pub(crate) fn is_external(platform: &str) -> bool {
    platform.starts_with("external:")
}
pub(super) fn configuration_binding(
    install: &str,
    package: &am_plugin_package::VerifiedPackage,
) -> Result<String, String> {
    Ok(am_plugin_package::hash(
        &serde_json::to_vec(&(
            install,
            &package.manifest().id,
            package.signer(),
            &package.manifest().source_authentication,
        ))
        .map_err(|_| "认证配置无效。")?,
    ))
}
fn install(platform: &str) -> Result<&str, String> {
    let id = platform
        .strip_prefix("external:")
        .ok_or("不是外置音乐源账号。")?;
    if id.is_empty() || id.len() > 128 || id.starts_with("dev:") {
        return Err("外置音乐源账号标识无效。".into());
    }
    Ok(id)
}
pub(crate) fn validate_platform(app: &tauri::AppHandle, platform: &str) -> Result<(), String> {
    let _ = Context::open(
        app.state::<Arc<PluginAuthority>>().inner().clone(),
        install(platform)?,
        "source-auth",
        Level::L0,
    )?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn source_account_platforms(
    webview: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<Json, String> {
    super::control::product(&webview)?;
    let authority = app.state::<Arc<PluginAuthority>>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let states = super::control::snapshots(&authority,false)?;
        Ok(json!(states.into_iter().filter(|s| s.get("sourceAuthentication").is_some()).map(|s| json!({"id":format!("external:{}",s["installId"].as_str().unwrap_or_default()),"name":s["sourceName"],"available":s["enabled"]==true && authority.admitted,"pluginId":s["pluginId"],"authentication":s["sourceAuthentication"],"authenticationBinding":s["sourceAuthenticationBinding"]})).collect::<Vec<_>>()))
    }).await.map_err(|_| "来源账号目录不可用。".to_owned())?
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AuthInput {
    account_id: String,
    login_id: String,
    expected_binding: Option<String>,
    operation: String,
    fields: Option<BTreeMap<String, String>>,
    phone: Option<String>,
    code: Option<String>,
}
fn field<'a>(value: &'a Json, key: &str, max: usize) -> Result<&'a str, String> {
    value[key]
        .as_str()
        .filter(|s| !s.is_empty() && s.len() <= max && !s.chars().any(char::is_control))
        .ok_or_else(|| "认证接口缺少有效字段。".into())
}
fn validate_fields(
    config: &SourceAuthentication,
    fields: &BTreeMap<String, String>,
) -> Result<(), String> {
    if fields.len() != config.credential_fields.len()
        || config.credential_fields.iter().any(|f| {
            fields
                .get(&f.id)
                .is_none_or(|v| v.trim().is_empty() || v.len() > 4096)
        })
        || fields.values().map(String::len).sum::<usize>() > 12000
    {
        return Err("请填写来源要求的凭证字段。".into());
    }
    Ok(())
}
fn valid_phone(phone: &str) -> bool {
    let digits = phone.strip_prefix('+').unwrap_or(phone);
    (6..=20).contains(&digits.len()) && digits.bytes().all(|b| b.is_ascii_digit())
}

#[tauri::command]
pub(crate) async fn source_account_auth(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    input: AuthInput,
) -> Result<Json, String> {
    super::control::product(&webview)?;
    crate::model::validate_id(&input.account_id)?;
    crate::model::validate_id(&input.login_id)?;
    let state = app.state::<crate::state::RuntimeState>();
    let account = state.account(&input.account_id)?;
    let id = install(&account.platform_id)?;
    if input.operation == "cancel" {
        state.source_auth.cancel_login(&account.id, &input.login_id);
        return Ok(json!({"status":"cancelled"}));
    }
    if !account.enabled {
        return Err("账号已停用。".into());
    }
    let _usage = state.use_account(&account.id, "来源登录")?;
    let flight = state.source_auth.acquire(&account.id, &input.login_id)?;
    if !state.account(&account.id)?.enabled {
        return Err("账号已停用。".into());
    }
    let context = Context::open(
        app.state::<Arc<PluginAuthority>>().inner().clone(),
        id,
        "source-auth",
        Level::L0,
    )?;
    context.require_binding(input.expected_binding.as_deref())?;
    let gate = context.gate()?;
    if input.operation == "check" {
        if account.pending {
            return Err("not-authenticated:账号尚未完成登录。".into());
        }
        if account.authentication == "anonymous" && context.config.allow_unauthenticated {
            return Ok(json!({"status":"not-required"}));
        }
        let credential = read_credential(&state, &account, &context.binding)?;
        let response = transport::request(
            &gate,
            &context.config.api_base_url,
            "auth/session",
            &json!({}),
            Some(&credential.token),
            &flight.cancel,
        )
        .await;
        if response
            .as_ref()
            .is_err_and(|e| e.starts_with("not-authenticated:"))
        {
            state.status(&account.id, "expired")?;
        }
        let response = response?;
        if response["status"] != "signed-in" || response["userId"] != credential.user_id {
            return Err("认证接口未确认原账号身份。".into());
        }
        gate.deliver(Exit::Sandbox, 0, &mut || {
            state
                .mutate(|s| {
                    if flight.cancel.is_cancelled() || state.usage.is_deleting(&account.id) {
                        return Err("账号操作已取消。".into());
                    }
                    s.accounts
                        .iter_mut()
                        .find(|a| a.id == account.id)
                        .ok_or("账号不存在。")?
                        .confirm_identity();
                    Ok(())
                })
                .map_err(|_| am_plugin_net::Error::Denied)
        })
        .map_err(|_| "账号检测已撤销。")?;
        return Ok(json!({"status":"signed-in"}));
    }
    if input.operation == "without-login" {
        if !context.config.allow_unauthenticated {
            return Err("此来源必须登录。".into());
        }
        gate.deliver(Exit::Sandbox, 0, &mut || {
            state
                .mutate(|s| {
                    if flight.cancel.is_cancelled() || state.usage.is_deleting(&account.id) {
                        return Err("登录已取消。".into());
                    }
                    let a = s
                        .accounts
                        .iter_mut()
                        .find(|a| a.id == account.id)
                        .ok_or("账号不存在。")?;
                    if !a.pending {
                        return Err("仅新建账号可以选择无需登录。".into());
                    }
                    a.pending = false;
                    a.authentication = "anonymous".into();
                    a.set_status("ready");
                    Ok(())
                })
                .map_err(|_| am_plugin_net::Error::Denied)
        })
        .map_err(|_| "无法完成免登录账号添加。")?;
        state
            .source_auth
            .pending
            .lock()
            .unwrap()
            .remove(&account.id);
        return Ok(json!({"status":"signed-in","message":"已添加，无需登录。"}));
    }
    let now = Instant::now();
    let (endpoint, body) = {
        let mut pending = state.source_auth.pending.lock().unwrap();
        if flight.cancel.is_cancelled() {
            return Err("operation-cancelled:登录已取消。".into());
        }
        let method = match input.operation.as_str() {
            "qr-start" | "qr-poll" => "qr",
            "credentials" => "credentials",
            "phone-send" | "phone-verify" => "phone",
            _ => return Err("不支持的来源登录操作。".into()),
        };
        if !context.config.methods.iter().any(|m| m.as_str() == method) {
            return Err("此来源未提供该登录方式。".into());
        }
        if matches!(
            input.operation.as_str(),
            "qr-start" | "credentials" | "phone-send"
        ) {
            let existing = pending.get(&account.id);
            // SMS cooldown is account scoped; choosing another login UUID never bypasses it.
            if input.operation == "phone-send"
                && state
                    .source_auth
                    .sms_cooldowns
                    .lock()
                    .unwrap()
                    .get(&account.id)
                    .is_some_and(|deadline| *deadline > now)
            {
                return Err("短信发送过于频繁，请稍后重试。".into());
            }
            let next_sms = existing.map_or(now, |p| p.next_sms);
            pending.insert(
                account.id.clone(),
                Pending {
                    login: input.login_id.clone(),
                    method: method.into(),
                    challenge: String::new(),
                    expires: now + Duration::from_secs(600),
                    next_poll: now,
                    next_sms,
                },
            );
        }
        let p = pending
            .get_mut(&account.id)
            .filter(|p| p.login == input.login_id && p.method == method && p.expires > now)
            .ok_or("本次登录已结束，请重新选择登录方式。")?;
        match input.operation.as_str() {
            "qr-start" => ("auth/qr/start", json!({})),
            "qr-poll" => {
                if p.next_poll > now {
                    return Err("登录查询过于频繁。".into());
                }
                p.next_poll = now + Duration::from_secs(2);
                ("auth/qr/poll", json!({"challengeId":p.challenge}))
            }
            "credentials" => {
                let fields = input.fields.as_ref().ok_or("缺少登录凭证。")?;
                validate_fields(&context.config, fields)?;
                ("auth/credentials", json!({"fields":fields}))
            }
            "phone-send" => {
                let phone = input
                    .phone
                    .as_deref()
                    .filter(|v| valid_phone(v))
                    .ok_or("手机号格式无效。")?;
                p.next_sms = state.source_auth.reserve_sms(&account.id, now)?;
                ("auth/phone/send", json!({"phone":phone}))
            }
            "phone-verify" => {
                let code = input
                    .code
                    .as_deref()
                    .filter(|v| {
                        (4..=10).contains(&v.len()) && v.bytes().all(|b| b.is_ascii_digit())
                    })
                    .ok_or("验证码格式无效。")?;
                (
                    "auth/phone/verify",
                    json!({"challengeId":p.challenge,"code":code}),
                )
            }
            _ => unreachable!(),
        }
    };
    let result = transport::request(
        &gate,
        &context.config.api_base_url,
        endpoint,
        &body,
        None,
        &flight.cancel,
    )
    .await?;
    let public = if result["status"] == "signed-in" {
        let token = field(&result, "token", 8192)?;
        if !token.bytes().all(|b| (33..=126).contains(&b)) {
            return Err("认证接口返回了无效凭证。".into());
        }
        let user_id = field(&result, "userId", 128)?;
        let credential = Credential {
            binding: context.binding.clone(),
            token: token.into(),
            user_id: user_id.into(),
        };
        let mut failure = None;
        gate.deliver(Exit::Sandbox, 0, &mut || {
            let outcome = commit(
                &state,
                &account.id,
                &input.login_id,
                &credential,
                &flight.cancel,
            );
            if let Err(error) = outcome {
                failure = Some(error);
                return Err(am_plugin_net::Error::Denied);
            }
            Ok(())
        })
        .map_err(|_| failure.unwrap_or_else(|| "插件授权已撤销。".into()))?;
        json!({"status":"signed-in","message":"登录成功，账号已添加。"})
    } else {
        let mut pending = state.source_auth.pending.lock().unwrap();
        let p = pending
            .get_mut(&account.id)
            .filter(|p| p.login == input.login_id && !flight.cancel.is_cancelled())
            .ok_or("登录已取消。")?;
        match result["status"].as_str() {
            Some("waiting") if input.operation == "qr-start" => {
                p.challenge = field(&result, "challengeId", 256)?.into();
                let content = field(&result, "qrContent", 4096)?;
                let seconds = result["expiresInSeconds"]
                    .as_u64()
                    .filter(|n| (5..=600).contains(n))
                    .ok_or("二维码有效期无效。")?;
                p.expires = Instant::now() + Duration::from_secs(seconds);
                p.next_poll = Instant::now() + Duration::from_secs(2);
                json!({"status":"waiting","qrContent":content})
            }
            Some("waiting" | "scanned" | "expired") if input.operation == "qr-poll" => {
                json!({"status":result["status"]})
            }
            Some("code-sent") if input.operation == "phone-send" => {
                p.challenge = field(&result, "challengeId", 256)?.into();
                let seconds = result["retryAfterSeconds"]
                    .as_u64()
                    .unwrap_or(60)
                    .clamp(60, 300);
                p.next_sms = Instant::now() + Duration::from_secs(seconds);
                state
                    .source_auth
                    .sms_cooldowns
                    .lock()
                    .unwrap()
                    .insert(account.id.clone(), p.next_sms);
                json!({"status":"code-sent","retryAfter":seconds})
            }
            _ => return Err("认证接口未确认登录，请检查凭证或验证码。".into()),
        }
    };
    gate.check(Exit::Sandbox).map_err(|_| "插件授权已撤销。")?;
    Ok(public)
}

#[cfg(test)]
mod tests;
