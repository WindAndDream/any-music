//! Douyin passport login. QR/MFA tokens stay in the pending native jar, outside renderer IPC.
use crate::accounts::douyin_passport;
use crate::state::AccountSession;
use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const LOGIN: &str = "https://login.douyin.com";
const WEB: &str = "https://www.douyin.com";
const QR_SDK_QUERY: [(&str, &str); 9] = [
    ("aid", "6383"),
    ("passport_jssdk_version", "3.4.9"),
    ("passport_jssdk_type", "normal"),
    ("is_from_ttaccountsdk", "1"),
    ("is_from_iesaccountsaas", "1"),
    ("account_sdk_source", "web"),
    ("device_platform", "web_app"),
    ("language", "zh"),
    ("account_app_language", "zh-CN"),
];
const AUTHN_SDK_VERSION: &str = "1.0.0.428-web";
const SMS_SDK_QUERY: [(&str, &str); 8] = [
    ("aid", "6383"),
    ("passport_jssdk_version", "5.1.2"),
    ("passport_jssdk_type", "lite"),
    ("is_from_ttaccountsdk", "1"),
    ("language", "zh"),
    ("account_app_language", "zh-CN"),
    ("new_authn_sdk_version", AUTHN_SDK_VERSION),
    ("device_platform", "web_app"),
];
/// Public SDK transport metadata carried by the QR endpoints in every live request.
/// The lite SMS SDK does not send this block, and none of these keys reach the signed
/// ten-key prefix, so adding them leaves `sign`/`qs` unchanged.
/// `request_host` is already percent-encoded upstream, so the stored value is encoded
/// exactly once more on the wire, matching the observed double encoding.
const QR_TRANSPORT_QUERY: [(&str, &str); 10] = [
    ("p_ui", "2.4.10"),
    ("p_ca", "4.0.26"),
    ("p_ca_real", "1.0.0.922"),
    ("p_js_v", "3.4.9"),
    ("p_js_t", "pro"),
    ("p_zt", "3.3.30"),
    ("p_ver", "1.1.4-beta.5"),
    ("p_ver_real", "0"),
    ("p_bd", "1.0.1.19-fix.01"),
    ("request_host", "https%3A%2F%2Fwww.douyin.com"),
];
const COMMON_KEYS: [&str; 9] = [
    "copywriting_key",
    "ies_safety_diversion_tag",
    "new_verify_flow",
    "std_verify_flow_id",
    "std_verify_scene",
    "std_verify_template",
    "std_verify_token",
    "std_verify_type",
    "std_verify_way",
];
const BIZ_KEYS: [&str; 7] = [
    "passport_mfa_retry_tag",
    "std_verify_flow_id",
    "std_verify_scene",
    "std_verify_template",
    "std_verify_token",
    "std_verify_type",
    "std_verify_way",
];

#[derive(Clone)]
pub struct DouyinQr {
    token: String,
    mfa: Option<Mfa>,
    blocked: Option<LoginBlock>,
}

#[derive(Clone, Copy)]
enum LoginPhase {
    Generate,
    Poll,
    SendSms,
    ValidateSms,
}

impl LoginPhase {
    fn label(self) -> &'static str {
        match self {
            Self::Generate => "生成二维码",
            Self::Poll => "查询二维码状态",
            Self::SendSms => "发送验证短信",
            Self::ValidateSms => "提交短信验证码",
        }
    }
}

/// Keep only actionable classification. Upstream descriptions can contain private context.
#[derive(Clone)]
struct LoginBlock {
    phase: LoginPhase,
    unsafe_site: bool,
    captcha: bool,
}

impl LoginBlock {
    fn message(&self) -> String {
        let reason = match (self.unsafe_site, self.captcha) {
            (true, true) => "服务端安全拒绝（4031），并要求人机验证",
            (true, false) => "服务端安全拒绝（4031），未返回人机验证挑战",
            (false, _) => "平台要求人机验证",
        };
        format!(
            "抖音{}失败：{reason}。已停止轮询，请使用系统 Chrome/Edge 完成登录与二次验证。",
            self.phase.label()
        )
    }

    fn public(&self) -> Value {
        json!({"status":"blocked","message":self.message()})
    }
}
#[derive(Clone)]
struct Mfa {
    common: BTreeMap<String, String>,
    biz: BTreeMap<String, String>,
    encrypt_uid: String,
    verify_ticket: String,
    ways: Vec<String>,
    mobile: String,
    retry_at: Option<Instant>,
    sms_sent: bool,
    validated: bool,
}

fn request(
    session: &AccountSession,
    method: reqwest::Method,
    host: &str,
    path: &str,
    query: BTreeMap<String, String>,
    form: &BTreeMap<String, String>,
    post_signature_form: &BTreeMap<String, String>,
) -> reqwest::RequestBuilder {
    let root = format!("{host}/").parse().unwrap();
    let csrf = {
        let jar = session.cookies.lock().unwrap();
        let cookies = jar.get_request_values(&root).collect::<BTreeMap<_, _>>();
        cookies
            .get("passport_csrf_token")
            .filter(|value| !value.is_empty())
            .or_else(|| cookies.get("passport_csrf_token_default"))
            .filter(|value| !value.is_empty())
            .map(|value| (*value).to_owned())
    };
    // QR and secondary verification use different official SDKs. The lite SMS SDK
    // does not send QR's sign/qs/ts or x-tt-passport-aid-sign authentication.
    let sms = matches!(
        path,
        "/passport/web/send_code/" | "/passport/web/validate_code/"
    );
    let sdk_query = if sms {
        &SMS_SDK_QUERY[..]
    } else {
        &QR_SDK_QUERY[..]
    };
    // Live requests carry one session-scoped eight-hex trace id in both the query string and
    // `x-tt-passport-trace-id`; the browser keeps it in a `biz_trace_id` cookie, so reuse that
    // value when the jar already has one and mint it once otherwise.
    let trace_id = {
        let mut jar = session.cookies.lock().unwrap();
        let existing = jar
            .get_request_values(&root)
            .collect::<BTreeMap<_, _>>()
            .get("biz_trace_id")
            .map(|value| (*value).to_owned())
            .filter(|value| !value.is_empty() && value.len() <= 32);
        existing.unwrap_or_else(|| {
            let generated = format!(
                "{:08x}",
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .subsec_nanos()
            );
            let _ = jar.parse(
                &format!("biz_trace_id={generated}; Domain=douyin.com; Path=/; Secure"),
                &root,
            );
            generated
        })
    };
    let mut params = sdk_query
        .iter()
        .map(|(key, value)| ((*key).into(), (*value).into()))
        .collect::<BTreeMap<String, String>>();
    params.extend(query);
    // Present in the signed ten-key prefix upstream, so it joins the params before signing.
    params.insert("biz_trace_id".into(), trace_id.clone());
    let aid_sign = if sms {
        None
    } else {
        let signed = douyin_passport::sign(
            path,
            params,
            form,
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        );
        params = signed.query;
        Some(signed.aid_sign)
    };
    if !sms {
        // Appended after signing, exactly as upstream adds its transport metadata, so the
        // signed ten-key prefix and `qs` stay untouched. The lite SMS SDK does not send it.
        params.extend(
            QR_TRANSPORT_QUERY
                .iter()
                .map(|(key, value)| ((*key).into(), (*value).into())),
        );
        // A native client without a_bogus is rejected by the poll endpoint with 4031 and accepted
        // once it carries one, so the minted token is appended here for the QR endpoints only.
        params.insert("a_bogus".into(), douyin_passport::mint_abogus());
    }
    let is_post = method == reqwest::Method::POST;
    let mut request = session
        .client
        .request(method, format!("{host}{path}"))
        .header("origin", WEB)
        .header("referer", format!("{WEB}/"))
        .header("accept", "application/json, text/javascript")
        .query(&params)
        .timeout(Duration::from_secs(20));
    if let Some(aid_sign) = aid_sign {
        request = request
            .header("web-sdk-version", "1")
            .header("x-tt-passport-aid-sign", aid_sign);
    }
    if let Some(csrf) = csrf {
        request = request.header("x-tt-passport-csrf-token", csrf);
    }
    // The header mirrors the query value in every observed request, on both SDK paths.
    request = request.header("x-tt-passport-trace-id", trace_id);
    if is_post {
        // The confirmed browser request signs the six ordinary QR fields first;
        // its MFA retry hook then appends challenge fields to the transmitted body.
        let mut body = form.clone();
        body.extend(post_signature_form.clone());
        request = request.form(&body);
    }
    request
}

async fn response(request: reqwest::RequestBuilder, phase: LoginPhase) -> Result<Value, String> {
    let response = request.send().await.map_err(|error| {
        let reason = if error.is_timeout() {
            "请求超时"
        } else {
            "网络请求失败"
        };
        format!("抖音{}时{reason}，请检查账号网络或代理。", phase.label())
    })?;
    if !response.status().is_success() {
        return Err(format!(
            "抖音{}时服务返回 HTTP {}。",
            phase.label(),
            response.status().as_u16()
        ));
    }
    response
        .json()
        .await
        .map_err(|_| format!("抖音{}响应无效，请重新生成二维码。", phase.label()))
}

fn code(value: &Value) -> Option<i64> {
    value["data"]["error_code"]
        .as_i64()
        .or_else(|| value["error_code"].as_i64())
}

fn risk(value: &Value, phase: LoginPhase) -> Option<LoginBlock> {
    let unsafe_site = code(value) == Some(4031);
    let captcha = value["data"]["captcha"]
        .as_str()
        .is_some_and(|v| !v.is_empty());
    (unsafe_site || captcha).then_some(LoginBlock {
        phase,
        unsafe_site,
        captcha,
    })
}

pub async fn generate(session: &AccountSession) -> Result<(DouyinQr, Value), String> {
    let value = response(
        request(
            session,
            reqwest::Method::GET,
            LOGIN,
            "/passport/web/get_qrcode/",
            BTreeMap::from([
                ("is_new_login".into(), "1".into()),
                ("next".into(), WEB.into()),
                ("need_short_url".into(), "true".into()),
                ("need_logo".into(), "false".into()),
            ]),
            &BTreeMap::new(),
            &BTreeMap::new(),
        ),
        LoginPhase::Generate,
    )
    .await?;
    if let Some(block) = risk(&value, LoginPhase::Generate) {
        return Err(block.message());
    }
    parse_qr(&value)
}

fn parse_qr(value: &Value) -> Result<(DouyinQr, Value), String> {
    if code(value) != Some(0) {
        return Err("抖音拒绝生成二维码，请使用系统浏览器。".into());
    }
    let data = &value["data"];
    let token = data["token"]
        .as_str()
        .filter(|v| !v.is_empty())
        .ok_or("缺少抖音二维码会话。")?;
    let image = data["qrcode"]
        .as_str()
        .filter(|v| v.len() <= 512 * 1024)
        .ok_or("缺少抖音二维码图片。")?;
    let bytes = STANDARD.decode(image).map_err(|_| "抖音二维码图片无效。")?;
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("抖音二维码不是 PNG 图片。".into());
    }
    // The response is already a QR image; encoding its base64 as QR text would make it unscannable.
    Ok((
        DouyinQr {
            token: token.into(),
            mfa: None,
            blocked: None,
        },
        json!({"status":"waiting","qrImage":format!("data:image/png;base64,{image}"),"expiresAt":data["expire_time"].as_u64()}),
    ))
}

pub async fn poll(session: &AccountSession, qr: &mut DouyinQr) -> Result<Value, String> {
    if let Some(block) = &qr.blocked {
        return Ok(block.public());
    }
    // Polling during an unfinished challenge can replace its tokens or keep triggering the SDK.
    if let Some(mfa) = &qr.mfa
        && !mfa.validated
    {
        return Ok(mfa.public());
    }
    let form = BTreeMap::from([
        ("token".into(), qr.token.clone()),
        // The current official UI always requests the frontier check flow. The response's
        // is_frontier describes push availability, not the value sent by its polling call.
        ("is_frontier".into(), "true".into()),
        ("need_logo".into(), "false".into()),
        ("is_new_login".into(), "1".into()),
        ("next".into(), WEB.into()),
        ("need_short_url".into(), "true".into()),
    ]);
    let retry = qr
        .mfa
        .as_ref()
        .map(|mfa| mfa.biz.clone())
        .unwrap_or_default();
    let value = response(
        request(
            session,
            reqwest::Method::POST,
            LOGIN,
            "/passport/web/check_qrconnect/",
            BTreeMap::new(),
            &form,
            &retry,
        ),
        LoginPhase::Poll,
    )
    .await?;
    let public = apply_poll(qr, &value)?;
    if public["status"] == "signed-in"
        && let Some(redirect) = value["data"]["redirect_url"].as_str()
    {
        let url = reqwest::Url::parse(redirect).map_err(|_| "抖音登录跳转无效。")?;
        if url.scheme() != "https"
            || !matches!(url.host_str(), Some("www.douyin.com" | "login.douyin.com"))
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err("抖音登录跳转来源无效。".into());
        }
        // Never return the credential-bearing redirect URL or user_data through IPC.
        session
            .client
            .get(url)
            .timeout(Duration::from_secs(15))
            .send()
            .await
            .map_err(|_| "抖音登录凭证回收失败，请使用系统浏览器。")?
            .error_for_status()
            .map_err(|_| "抖音登录跳转失败。")?;
    }
    Ok(public)
}

fn strings(value: &Value, keys: &[&str]) -> BTreeMap<String, String> {
    keys.iter()
        .filter_map(|key| value[*key].as_str().map(|v| ((*key).into(), v.into())))
        .collect()
}

fn apply_poll(qr: &mut DouyinQr, value: &Value) -> Result<Value, String> {
    if let Some(block) = risk(value, LoginPhase::Poll) {
        let public = block.public();
        qr.blocked = Some(block);
        return Ok(public);
    }
    if code(value) == Some(2046) {
        let data = &value["data"];
        let ways: Vec<String> = data["verify_ways"]
            .as_array()
            .ok_or("抖音未返回验证选项，请使用系统浏览器。")?
            .iter()
            .filter_map(|way| way["verify_way"].as_str())
            .map(|way| match way {
                "mobile_sms_verify" | "mobile_up_sms_verify" | "face_verify" => way.to_owned(),
                _ => "other".into(),
            })
            .collect();
        let common = strings(&data["common_params"], &COMMON_KEYS);
        let biz = strings(&data["biz_params"], &BIZ_KEYS);
        if common.get("std_verify_token").is_none_or(String::is_empty)
            || biz.get("std_verify_token").is_none_or(String::is_empty)
            || ways.is_empty()
        {
            return Err("抖音验证会话不完整，请使用系统浏览器。".into());
        }
        let mfa = Mfa {
            common,
            biz,
            ways,
            encrypt_uid: data["encrypt_uid"].as_str().unwrap_or_default().into(),
            verify_ticket: data["verify_ticket"].as_str().unwrap_or_default().into(),
            mobile: String::new(),
            retry_at: None,
            sms_sent: false,
            validated: false,
        };
        let public = mfa.public();
        qr.mfa = Some(mfa);
        return Ok(public);
    }
    // 2156 (系统繁忙) is how the platform ends a QR session while blaming the weather. Measured
    // with a purely native session: polls return error_code 0 / status new until the user scans,
    // a single status scanned appears, and then every poll returns 2156 for good — forty-three
    // seconds before that same token's expire_time, so it is not an expiry artefact. The same
    // code is what follows a token that has simply expired. Report the session as over with
    // guidance instead of polling a dead session forever or blaming every unknown code.
    if code(value) == Some(2156) {
        return Ok(json!({
            "status":"blocked",
            "message":"本次二维码会话已被抖音终止（2156 系统繁忙）。请重新生成二维码；若扫码后仍然如此，请在系统浏览器中完成登录。",
        }));
    }
    if code(value) != Some(0) {
        return Err("抖音拒绝查询二维码状态，请使用系统浏览器。".into());
    }
    // An expired or superseded token is answered with a brand-new QR inside the poll response:
    // qrcode plus a different token and expire_time, error_code 0, and no `status` field at all.
    // The browser panel renders that image in place, so adopt the new token and stay waiting
    // instead of treating it as an unknown state.
    if value["data"]["qrcode"]
        .as_str()
        .is_some_and(|image| !image.is_empty())
    {
        let (refreshed, public) = parse_qr(value)?;
        qr.token = refreshed.token;
        return Ok(public);
    }
    match value["data"]["status"].as_str() {
        Some("new") => Ok(json!({"status":"waiting"})),
        Some("scanned") => Ok(json!({"status":"scanned"})),
        Some("expired") => Ok(json!({"status":"expired"})),
        Some("confirmed") => Ok(json!({"status":"signed-in"})),
        _ => Err("未知抖音二维码状态，请使用系统浏览器。".into()),
    }
}

impl Mfa {
    fn public(&self) -> Value {
        let methods: Vec<Value> = self
            .ways
            .iter()
            .map(|way| {
                let label = match way.as_str() {
                    "mobile_sms_verify" => "接收短信验证码",
                    "mobile_up_sms_verify" => "发送短信验证",
                    "face_verify" => "手机刷脸验证",
                    _ => "其他验证方式",
                };
                json!({"id":way,"label":label,"inApp":way == "mobile_sms_verify"})
            })
            .collect();
        let retry_after = self
            .retry_at
            .map(|at| {
                at.saturating_duration_since(Instant::now())
                    .as_millis()
                    .div_ceil(1000)
            })
            .unwrap_or(0);
        json!({"status":"verification-required","verification":{
            "methods":methods,"selectedMethod":if self.sms_sent {"mobile_sms_verify"} else {""},
            "maskedMobile":self.mobile,"retryAfter":retry_after,"codeLength":6,
        }})
    }
    fn form(&self, code: Option<&str>) -> BTreeMap<String, String> {
        let mut form = self.common.clone();
        form.extend(BTreeMap::from([
            ("mix_mode".into(), "1".into()),
            ("type".into(), mix_digits("22")),
            ("aid".into(), "6383".into()),
            ("encrypt_uid".into(), self.encrypt_uid.clone()),
            ("verify_ticket".into(), self.verify_ticket.clone()),
            ("std_verify_way".into(), "mobile_sms_verify".into()),
            ("new_authn_sdk_version".into(), AUTHN_SDK_VERSION.into()),
        ]));
        if let Some(code) = code {
            form.insert("code".into(), mix_digits(code));
        } else {
            form.insert("is6Digits".into(), "1".into());
        }
        form
    }
}

// Verified in the official second-verification SDK: numeric ASCII bytes XOR 5, hexadecimal.
fn mix_digits(value: &str) -> String {
    douyin_passport::mix_ascii(value)
}

fn masked_mobile(value: &str) -> String {
    let digits: String = value.chars().filter(char::is_ascii_digit).collect();
    if digits.len() >= 7 {
        format!("{}****{}", &digits[..3], &digits[digits.len() - 4..])
    } else if value.contains('*')
        && value.len() <= 32
        && value
            .chars()
            .all(|c| c.is_ascii_digit() || matches!(c, '*' | '+' | '-' | ' '))
    {
        value.into()
    } else {
        "绑定手机号".into()
    }
}

pub async fn sms(
    session: &AccountSession,
    qr: &mut DouyinQr,
    code_input: Option<&str>,
) -> Result<Value, String> {
    if let Some(block) = &qr.blocked {
        return Ok(block.public());
    }
    let mfa = qr
        .mfa
        .as_mut()
        .ok_or("当前没有抖音二次验证，请重新扫码。")?;
    if mfa.validated {
        return Err("验证已通过，正在确认登录。".into());
    }
    if !mfa.ways.iter().any(|v| v == "mobile_sms_verify") {
        return Err("此账号未提供接收短信验证，请使用系统浏览器。".into());
    }
    // The final QR retry keeps the original MFA token but records the method actually completed.
    mfa.biz
        .insert("std_verify_way".into(), "mobile_sms_verify".into());
    if let Some(code) = code_input {
        if code.len() != 6 || !code.bytes().all(|b| b.is_ascii_digit()) {
            return Err("请输入 6 位数字验证码。".into());
        }
        if !mfa.sms_sent {
            return Err("请先发送短信验证码。".into());
        }
    } else {
        if mfa.retry_at.is_some_and(|at| at > Instant::now()) {
            return Err("请等待短信重发倒计时结束。".into());
        }
        // Retain a cooldown even on failure so repeated clicks do not hammer the SMS endpoint.
        mfa.retry_at = Some(Instant::now() + Duration::from_secs(60));
    }
    let path = if code_input.is_some() {
        "/passport/web/validate_code/"
    } else {
        "/passport/web/send_code/"
    };
    let phase = if code_input.is_some() {
        LoginPhase::ValidateSms
    } else {
        LoginPhase::SendSms
    };
    let value = response(
        request(
            session,
            reqwest::Method::POST,
            WEB,
            path,
            BTreeMap::new(),
            &mfa.form(code_input),
            &BTreeMap::new(),
        ),
        phase,
    )
    .await?;
    if let Some(block) = risk(&value, phase) {
        let public = block.public();
        qr.blocked = Some(block);
        return Ok(public);
    }
    if value["message"] != "success" || code(&value).is_some_and(|code| code != 0) {
        return Err(if code_input.is_some() {
            "验证码验证失败或已失效，请检查验证码或使用系统浏览器。"
        } else {
            "短信发送失败，请稍后重试或使用系统浏览器。"
        }
        .into());
    }
    if code_input.is_some() {
        if value["data"]["ticket"].as_str().is_none_or(str::is_empty) {
            return Err("抖音未返回验证确认，请使用系统浏览器。".into());
        }
        mfa.validated = true;
        Ok(json!({"status":"scanned","message":"短信验证通过，正在确认登录。"}))
    } else {
        mfa.mobile = masked_mobile(value["data"]["mobile"].as_str().unwrap_or_default());
        mfa.sms_sent = true;
        let retry = value["data"]["retry_time"]
            .as_u64()
            .unwrap_or(60)
            .clamp(1, 3600);
        mfa.retry_at = Some(Instant::now() + Duration::from_secs(retry));
        Ok(mfa.public())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn session() -> AccountSession {
        AccountSession {
            cookies: std::sync::Arc::new(reqwest_cookie_store::CookieStoreMutex::new(
                reqwest_cookie_store::CookieStore::default(),
            )),
            // A blocked loopback proxy makes accidental public-network work fail this test.
            client: reqwest::Client::builder()
                .proxy(reqwest::Proxy::all("http://127.0.0.1:9").unwrap())
                .timeout(Duration::from_millis(10))
                .build()
                .unwrap(),
            queue: tokio::sync::Semaphore::new(1),
            route_clients: std::sync::Mutex::default(),
            cancelled: tokio_util::sync::CancellationToken::new(),
            failures: std::sync::Mutex::new(0),
        }
    }
    #[test]
    fn unfinished_mfa_and_cooldowns_never_issue_poll_or_duplicate_sms_requests() {
        tauri::async_runtime::block_on(async {
            let session = session();
            let mut qr = qr();
            apply_poll(&mut qr, &challenge()).unwrap();
            assert_eq!(
                poll(&session, &mut qr).await.unwrap()["status"],
                "verification-required"
            );
            assert!(
                sms(&session, &mut qr, Some("123456"))
                    .await
                    .unwrap_err()
                    .contains("先发送")
            );
            assert!(
                sms(&session, &mut qr, Some("12345x"))
                    .await
                    .unwrap_err()
                    .contains("6 位")
            );
            qr.mfa.as_mut().unwrap().retry_at = Some(Instant::now() + Duration::from_secs(60));
            assert!(
                sms(&session, &mut qr, None)
                    .await
                    .unwrap_err()
                    .contains("倒计时")
            );
            assert_eq!(
                qr.mfa.as_ref().unwrap().biz["std_verify_way"],
                "mobile_sms_verify"
            );
            qr.mfa.as_mut().unwrap().retry_at = Some(Instant::now() - Duration::from_secs(1));
            assert_eq!(
                qr.mfa.as_ref().unwrap().public()["verification"]["retryAfter"],
                0
            );
            qr.blocked = risk(&json!({"data":{"error_code":4031}}), LoginPhase::Poll);
            assert_eq!(poll(&session, &mut qr).await.unwrap()["status"], "blocked");
            assert_eq!(
                sms(&session, &mut qr, None).await.unwrap()["status"],
                "blocked"
            );
        });
    }
    #[test]
    fn csrf_header_comes_only_from_the_pending_jar() {
        let session = session();
        let url = format!("{LOGIN}/").parse().unwrap();
        session
            .cookies
            .lock()
            .unwrap()
            .parse(
                "passport_csrf_token=synthetic; Domain=douyin.com; Path=/; Secure",
                &url,
            )
            .unwrap();
        let built = request(
            &session,
            reqwest::Method::POST,
            LOGIN,
            "/passport/web/check_qrconnect/",
            BTreeMap::new(),
            &BTreeMap::new(),
            &BTreeMap::new(),
        )
        .build()
        .unwrap();
        assert_eq!(built.headers()["x-tt-passport-csrf-token"], "synthetic");
        assert_eq!(built.headers()["origin"], WEB);
        assert_eq!(built.headers()["web-sdk-version"], "1");
        assert_eq!(
            built.headers()["x-tt-passport-aid-sign"].as_bytes().len(),
            64
        );
    }
    #[test]
    fn pending_jar_default_csrf_is_used_and_post_signature_matches_the_sent_form() {
        let session = session();
        let url = format!("{LOGIN}/").parse().unwrap();
        session
            .cookies
            .lock()
            .unwrap()
            .parse(
                "passport_csrf_token_default=synthetic-default; Domain=douyin.com; Path=/; Secure",
                &url,
            )
            .unwrap();
        session
            .cookies
            .lock()
            .unwrap()
            .parse(
                "passport_csrf_token=; Domain=douyin.com; Path=/; Secure",
                &url,
            )
            .unwrap();
        let form = BTreeMap::from([
            ("token".into(), "synthetic + value".into()),
            ("is_frontier".into(), "true".into()),
            ("is_new_login".into(), "1".into()),
        ]);
        let path = "/passport/web/check_qrconnect/";
        let built = request(
            &session,
            reqwest::Method::POST,
            LOGIN,
            path,
            BTreeMap::new(),
            &form,
            &BTreeMap::new(),
        )
        .build()
        .unwrap();
        assert_eq!(
            built.headers()["x-tt-passport-csrf-token"],
            "synthetic-default"
        );
        let mut query = built
            .url()
            .query_pairs()
            .map(|(key, value)| (key.into_owned(), value.into_owned()))
            .collect::<BTreeMap<_, _>>();
        assert!(!query.contains_key("token"));
        assert!(!query.contains_key("is_new_login"));
        assert!(!query.contains_key("fp"));
        assert!(!query.contains_key("msToken"));
        let sign = query.remove("sign").unwrap();
        query.remove("qs");
        // The transport block rides on the wire after signing, so strip it before re-signing,
        // asserting on the way that it is actually present.
        for (key, _) in QR_TRANSPORT_QUERY {
            assert!(
                query.remove(key).is_some(),
                "{key} missing from the sent query"
            );
        }
        // a_bogus also rides on the wire after signing and is not part of the signed set.
        assert!(!query.remove("a_bogus").unwrap().is_empty());
        let epoch = query["ts"].parse::<u64>().unwrap();
        assert_eq!(
            sign,
            douyin_passport::sign(path, query, &form, epoch).query["sign"]
        );
        assert_eq!(
            built.headers()["content-type"],
            "application/x-www-form-urlencoded"
        );
        assert_eq!(
            built.body().unwrap().as_bytes().unwrap(),
            b"is_frontier=true&is_new_login=1&token=synthetic+%2B+value"
        );
    }
    #[test]
    fn mfa_retry_sends_challenge_fields_after_signing_the_ordinary_qr_form() {
        let session = session();
        let form = BTreeMap::from([
            ("need_logo".into(), "false".into()),
            ("is_frontier".into(), "true".into()),
            ("token".into(), "synthetic-qr".into()),
            ("is_new_login".into(), "1".into()),
            ("next".into(), WEB.into()),
            ("need_short_url".into(), "true".into()),
        ]);
        let mut qr = qr();
        apply_poll(&mut qr, &challenge()).unwrap();
        let mut retry = qr.mfa.unwrap().biz;
        retry.insert("std_verify_way".into(), "mobile_sms_verify".into());
        let path = "/passport/web/check_qrconnect/";
        let build = |retry| {
            request(
                &session,
                reqwest::Method::POST,
                LOGIN,
                path,
                BTreeMap::new(),
                &form,
                retry,
            )
            .build()
            .unwrap()
        };
        let empty_retry = BTreeMap::new();
        let ordinary = build(&empty_retry);
        let verified = build(&retry);
        // Changing the appended challenge must not change the signed QR request.
        assert_eq!(ordinary.url(), verified.url());
        let body = reqwest::Url::parse(&format!(
            "https://example.invalid/?{}",
            std::str::from_utf8(verified.body().unwrap().as_bytes().unwrap()).unwrap()
        ))
        .unwrap()
        .query_pairs()
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect::<BTreeMap<_, _>>();
        let mut expected = form;
        expected.extend(retry);
        assert_eq!(body, expected);
        assert_eq!(body["std_verify_way"], "mobile_sms_verify");
        assert_eq!(body["token"], "synthetic-qr");
    }
    #[test]
    fn secondary_sms_uses_lite_sdk_and_keeps_qr_authentication_out_of_its_requests() {
        let session = session();
        let mut qr = qr();
        apply_poll(&mut qr, &challenge()).unwrap();
        let mfa = qr.mfa.unwrap();
        for (path, input) in [
            ("/passport/web/send_code/", None),
            ("/passport/web/validate_code/", Some("123456")),
        ] {
            let form = mfa.form(input);
            let built = request(
                &session,
                reqwest::Method::POST,
                WEB,
                path,
                BTreeMap::new(),
                &form,
                &BTreeMap::new(),
            )
            .build()
            .unwrap();
            let query = built.url().query_pairs().collect::<BTreeMap<_, _>>();
            assert_eq!(query["passport_jssdk_version"], "5.1.2");
            assert_eq!(query["passport_jssdk_type"], "lite");
            assert_eq!(query["new_authn_sdk_version"], AUTHN_SDK_VERSION);
            // Nine keys: the eight SDK fields plus the session trace id, matching the live
            // lite-SDK request surface. msToken/a_bogus are appended by the transport.
            assert_eq!(query.len(), 9);
            assert!(!built.headers().contains_key("x-tt-passport-aid-sign"));
            assert!(!built.headers().contains_key("web-sdk-version"));
            assert_eq!(form["new_authn_sdk_version"], AUTHN_SDK_VERSION);
            assert_eq!(form.contains_key("is6Digits"), input.is_none());
            assert_eq!(form.contains_key("code"), input.is_some());
        }
    }
    #[test]
    fn qr_requests_carry_the_observed_transport_block_and_an_unslashed_next() {
        let session = session();
        let form = BTreeMap::from([("next".into(), WEB.into())]);
        let built = request(
            &session,
            reqwest::Method::POST,
            LOGIN,
            "/passport/web/check_qrconnect/",
            BTreeMap::new(),
            &form,
            &BTreeMap::new(),
        )
        .build()
        .unwrap();
        // Every live QR request carries this block; none of its keys reach the signed
        // ten-key prefix, so it must not change sign or qs.
        let raw_url = built.url().as_str();
        for needle in [
            "p_ui=2.4.10",
            "p_ca=4.0.26",
            "p_ca_real=1.0.0.922",
            "p_js_v=3.4.9",
            "p_js_t=pro",
            "p_zt=3.3.30",
            "p_ver=1.1.4-beta.5",
            "p_ver_real=0",
            "p_bd=1.0.1.19-fix.01",
            // Double encoded on the wire: the SDK value is encoded once, transport once more.
            "request_host=https%253A%252F%252Fwww.douyin.com",
        ] {
            assert!(raw_url.contains(needle), "missing {needle} in {raw_url}");
        }
        let query = built
            .url()
            .query_pairs()
            .map(|(key, value)| (key.into_owned(), value.into_owned()))
            .collect::<BTreeMap<_, _>>();
        assert!(!query["ts"].is_empty());
        // The QR path carries a minted a_bogus; the lite SMS path must not.
        assert_eq!(query["a_bogus"], douyin_passport::mint_abogus());
        // `qs` is the XOR-5 hex of the comma-joined signed key names; decode it to check that
        // the transport block stays outside the signed ten-key prefix.
        let qs = &query["qs"];
        let signed = (0..qs.len() / 2)
            .map(|index| {
                (u8::from_str_radix(&qs[index * 2..index * 2 + 2], 16).unwrap() ^ 5) as char
            })
            .collect::<String>();
        assert!(signed.starts_with("account_app_language,account_sdk_source"));
        assert_eq!(signed.matches(',').count(), 9);
        assert!(
            signed.split(',').any(|key| key == "biz_trace_id"),
            "trace id belongs to the signed set upstream: {signed}"
        );
        for transport_key in ["p_ui", "p_bd", "p_ca", "p_ver", "request_host"] {
            assert!(
                !signed.contains(transport_key),
                "{transport_key} leaked into the signed list: {signed}"
            );
        }
        // The browser sends `next` without a trailing slash on both the query and the body.
        let body = String::from_utf8(built.body().unwrap().as_bytes().unwrap().to_vec()).unwrap();
        assert_eq!(body, "next=https%3A%2F%2Fwww.douyin.com");
        // The trace header mirrors the query value, and the cookie keeps it stable afterwards.
        assert_eq!(
            built.headers()["x-tt-passport-trace-id"],
            query["biz_trace_id"].as_str()
        );
        assert_eq!(query["biz_trace_id"].len(), 8);
        let second = request(
            &session,
            reqwest::Method::POST,
            LOGIN,
            "/passport/web/check_qrconnect/",
            BTreeMap::new(),
            &form,
            &BTreeMap::new(),
        )
        .build()
        .unwrap();
        assert_eq!(
            second
                .url()
                .query_pairs()
                .find(|(key, _)| key == "biz_trace_id")
                .unwrap()
                .1,
            query["biz_trace_id"].as_str()
        );
    }

    #[test]
    fn a_poll_that_returns_a_fresh_qr_replaces_the_token_and_stays_waiting() {
        // Observed live 69 times in one session: polling an expired token answers with a new
        // qrcode, a different token and expire_time, error_code 0, and no `status`.
        let png = STANDARD.encode(b"\x89PNG\r\n\x1a\nrefreshed");
        let mut qr = qr();
        let public = apply_poll(
            &mut qr,
            &json!({"data":{"error_code":0,"qrcode":png,"token":"replacement-token","expire_time":123}}),
        )
        .unwrap();
        assert_eq!(public["status"], "waiting");
        assert_eq!(public["qrImage"], format!("data:image/png;base64,{png}"));
        assert_eq!(public["expiresAt"], 123);
        assert_eq!(qr.token, "replacement-token");
        assert!(!public.to_string().contains("replacement-token"));
        // A refresh carrying a broken image is still rejected rather than silently accepted.
        assert!(
            apply_poll(
                &mut qr,
                &json!({"data":{"error_code":0,"qrcode":"aHRtbA==","token":"replacement-token"}})
            )
            .is_err()
        );
    }

    fn qr() -> DouyinQr {
        DouyinQr {
            token: "qr-secret".into(),
            mfa: None,
            blocked: None,
        }
    }
    #[test]
    fn blocked_diagnostics_distinguish_unsafe_site_from_captcha_without_private_payloads() {
        let denied = risk(
            &json!({"data":{"error_code":4031,"captcha":"","description":"private-description","token":"private-token"}}),
            LoginPhase::Poll,
        ).unwrap();
        let public = denied.public();
        let message = public["message"].as_str().unwrap();
        assert!(message.contains("查询二维码状态"));
        assert!(message.contains("4031"));
        assert!(message.contains("未返回人机验证挑战"));
        assert!(!public.to_string().contains("private"));

        let captcha = risk(
            &json!({"data":{"captcha":"private-challenge","description":"private-description"}}),
            LoginPhase::ValidateSms,
        )
        .unwrap();
        assert!(captcha.message().contains("提交短信验证码"));
        assert!(captcha.message().contains("平台要求人机验证"));
        assert!(!captcha.message().contains("4031"));
        assert!(!captcha.public().to_string().contains("private"));
        assert!(
            risk(
                &json!({"data":{"error_code":2046,"captcha":""}}),
                LoginPhase::Poll
            )
            .is_none()
        );
    }

    fn challenge() -> Value {
        json!({"data":{"error_code":2046,"encrypt_uid":"uid-secret",
        "common_params":{"std_verify_token":"mfa-secret","std_verify_scene":"account_login"},
        "biz_params":{"std_verify_token":"mfa-secret","passport_mfa_retry_tag":"retry-secret"},
        "verify_ways":[{"verify_way":"mobile_sms_verify","mobile":"phone-secret"},
            {"verify_way":"face_verify","auth_ticket":"face-secret"},{"verify_way":"mobile_up_sms_verify","sms_content":"sms-secret"}]}})
    }
    #[test]
    fn a_terminated_qr_session_is_reported_instead_of_polled_forever() {
        // Measured with a purely native session: error_code 0 / status new until the user scans,
        // one status scanned, then 2156 for good — arriving forty-three seconds before that
        // token's expire_time, and also following a token that had simply expired. The poll must
        // stop and say so rather than treat it as one more unknown code.
        let mut qr = qr();
        let public = apply_poll(
            &mut qr,
            &json!({"data":{"error_code":2156,"description":"系统繁忙，请重启应用或刷新页面后重试"}}),
        )
        .unwrap();
        assert_eq!(public["status"], "blocked");
        assert!(
            public["message"].as_str().unwrap().contains("2156"),
            "the message must name the code so the report is actionable"
        );
        // A genuinely unrecognised code is still a plain hard error.
        assert!(
            apply_poll(&mut qr, &json!({"data":{"error_code":12345}})).is_err(),
            "unknown codes must remain fatal"
        );
    }
    #[test]
    fn a_reissued_qr_during_the_mfa_retry_keeps_the_challenge_and_adopts_the_new_token() {
        // Observed live: after validate_code succeeded, the retry poll returned a reissued QR
        // (error_code 0, a different token, a new image) rather than `confirmed`, because the
        // original QR token had expired during verification.
        let png = STANDARD.encode(b"\x89PNG\r\n\x1a\nreissued");
        let mut qr = qr();
        apply_poll(&mut qr, &challenge()).unwrap();
        qr.mfa.as_mut().unwrap().validated = true;
        let public = apply_poll(
            &mut qr,
            &json!({"data":{"error_code":0,"qrcode":png,"token":"reissued-token","expire_time":99}}),
        )
        .unwrap();
        assert_eq!(public["status"], "waiting");
        assert_eq!(public["expiresAt"], 99);
        assert_eq!(public["qrImage"], format!("data:image/png;base64,{png}"));
        assert!(!public.to_string().contains("reissued-token"));
        assert_eq!(qr.token, "reissued-token");
        // The challenge survives, so the next poll still carries the retry fields, now aimed at
        // the new token.
        let mfa = qr.mfa.expect("challenge state must survive a reissue");
        assert!(mfa.validated);
        assert_eq!(mfa.biz["passport_mfa_retry_tag"], "retry-secret");
    }
    #[test]
    fn secondary_projection_keeps_only_public_options_and_pauses_polling() {
        let mut qr = qr();
        let public = apply_poll(&mut qr, &challenge()).unwrap();
        assert_eq!(public["status"], "verification-required");
        assert_eq!(public["verification"]["methods"][0]["inApp"], true);
        assert_eq!(public["verification"]["methods"][1]["inApp"], false);
        assert!(!public.to_string().contains("secret"));
        assert!(!qr.mfa.as_ref().unwrap().validated);
        let form = qr.mfa.unwrap().form(Some("123456"));
        assert_eq!(form["type"], "3737");
        assert_eq!(form["code"], "343736313033");
        assert_eq!(form["verify_ticket"], "");
        assert_eq!(form["std_verify_token"], "mfa-secret");
    }
    #[test]
    fn verification_methods_keep_the_live_order_ids_labels_and_in_app_flags() {
        // The live account offered face_verify first, then mobile_sms_verify, then
        // mobile_up_sms_verify, and the panel rendered 手机刷脸验证 / 接收短信验证码 / 发送短信验证.
        // Only the SMS way can be completed without the phone, so it alone is in-app.
        let mut qr = qr();
        let public = apply_poll(
            &mut qr,
            &json!({"data":{"error_code":2046,"encrypt_uid":"uid-secret",
            "common_params":{"std_verify_token":"mfa-secret","std_verify_scene":"account_login"},
            "biz_params":{"std_verify_token":"mfa-secret","passport_mfa_retry_tag":"retry-secret"},
            "verify_ways":[{"verify_way":"face_verify"},{"verify_way":"mobile_sms_verify"},
                {"verify_way":"mobile_up_sms_verify"}]}}),
        )
        .unwrap();
        let methods = public["verification"]["methods"].as_array().unwrap();
        let pairs = methods
            .iter()
            .map(|method| {
                (
                    method["id"].as_str().unwrap().to_owned(),
                    method["label"].as_str().unwrap().to_owned(),
                    method["inApp"].as_bool().unwrap(),
                )
            })
            .collect::<Vec<_>>();
        assert_eq!(
            pairs,
            vec![
                ("face_verify".to_owned(), "手机刷脸验证".to_owned(), false),
                (
                    "mobile_sms_verify".to_owned(),
                    "接收短信验证码".to_owned(),
                    true
                ),
                (
                    "mobile_up_sms_verify".to_owned(),
                    "发送短信验证".to_owned(),
                    false
                ),
            ]
        );
    }
    #[test]
    fn risk_expiry_and_confirmed_do_not_expose_user_credentials_or_refresh_tokens() {
        let mut qr = qr();
        assert_eq!(apply_poll(&mut qr, &json!({"data":{"error_code":0,"status":"confirmed","user_data":{"session_key":"secret"}}})).unwrap(),json!({"status":"signed-in"}));
        assert_eq!(
            apply_poll(
                &mut qr,
                &json!({"data":{"error_code":0,"status":"expired","token":"new-secret"}})
            )
            .unwrap(),
            json!({"status":"expired"})
        );
        assert_eq!(qr.token, "qr-secret");
        assert_eq!(
            apply_poll(
                &mut qr,
                &json!({"data":{"error_code":4031,"description":"private"}})
            )
            .unwrap()["status"],
            "blocked"
        );
        assert!(qr.blocked.is_some());
        assert!(
            apply_poll(
                &mut qr,
                &json!({"data":{"error_code":0,"status":"unexpected"}})
            )
            .is_err()
        );
    }
    #[test]
    fn qr_image_is_png_data_not_a_second_qr_encoding_and_mobile_is_masked() {
        let png = STANDARD.encode(b"\x89PNG\r\n\x1a\nsynthetic");
        let (_, view) = parse_qr(
            &json!({"data":{"error_code":0,"token":"secret","qrcode":png,"expire_time":123}}),
        )
        .unwrap();
        assert_eq!(view["qrImage"], format!("data:image/png;base64,{png}"));
        assert!(!view.to_string().contains("secret"));
        assert!(
            parse_qr(&json!({"data":{"error_code":0,"token":"secret","qrcode":"aHRtbA=="}}))
                .is_err()
        );
        assert_eq!(masked_mobile("13812345678"), "138****5678");
        assert_eq!(masked_mobile("138****5678"), "138****5678");
        assert_eq!(masked_mobile("private"), "绑定手机号");
    }
}
