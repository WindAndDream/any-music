//! Renderer placement and filtered rows are data. The account actor alone selects
//! a real search tab, owns its window and runs the fixed browser-side presentation.
use serde::Deserialize;
use tauri::{State, WebviewWindow};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Request {
    account_id: String,
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    pub(super) lease: String,
    #[cfg(target_os = "windows")]
    pub(super) query: String,
    #[cfg(target_os = "windows")]
    pub(super) bounds: Option<super::dock::Rect>,
    #[cfg(target_os = "windows")]
    #[serde(default)]
    verification: bool,
    #[cfg(target_os = "windows")]
    pub(super) content: Option<Content>,
}

#[cfg(target_os = "windows")]
#[derive(Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Content {
    rows: Vec<Row>,
    has_more: bool,
    dark: bool,
    grid: bool,
    selectable: bool,
    palette: Palette,
}

#[cfg(target_os = "windows")]
#[derive(Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Row {
    id: String,
    title: String,
    artist: String,
    artwork: Option<String>,
    duration: String,
    selected: bool,
    favorite: bool,
    playing: bool,
    unavailable: bool,
}

#[cfg(target_os = "windows")]
#[derive(Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Palette {
    background: String,
    text: String,
    surface: String,
    muted: String,
    hover: String,
    accent: String,
}

#[tauri::command]
pub async fn present_douyin_search(
    window: WebviewWindow,
    state: State<'_, crate::state::RuntimeState>,
    request: Request,
) -> Result<serde_json::Value, String> {
    crate::browser::verification::require_main(&window)?;
    crate::model::validate_id(&request.account_id)?;
    crate::model::validate_id(&request.lease)?;
    #[cfg(not(target_os = "windows"))]
    {
        let _ = state;
        Err("unsupported:当前平台不支持嵌入系统浏览器。".into())
    }
    #[cfg(target_os = "windows")]
    {
        let account = state.account(&request.account_id)?;
        if !account.enabled || account.platform_id != "douyin" {
            return Err("account-unavailable:抖音账号已停用或不可用。".into());
        }
        if request.query.is_empty() || request.query.chars().take(201).count() > 200 {
            return Err("invalid-input:搜索关键词无效。".into());
        }
        if request.bounds.is_some_and(|rect| {
            !(0..=16_384).contains(&rect.width) || !(0..=16_384).contains(&rect.height)
        }) {
            return Err("invalid-input:浏览器视口大小无效。".into());
        }
        if request.content.as_ref().is_some_and(|content| {
            [
                &content.palette.background,
                &content.palette.text,
                &content.palette.surface,
                &content.palette.muted,
                &content.palette.hover,
                &content.palette.accent,
            ]
            .iter()
            .any(|color| color.len() > 100)
                || content.rows.len() > 2000
                || content.rows.iter().any(|row| {
                    row.id.len() > 256
                        || row.title.len() > 2048
                        || row.artist.len() > 1024
                        || row.duration.len() > 32
                        || row.artwork.as_ref().is_some_and(|url| url.len() > 4096)
                })
        }) {
            return Err("limit-exceeded:歌曲列表超过嵌入显示预算。".into());
        }
        let account_id = request.account_id.clone();
        let host = super::dock::Host::from_window(window)?;
        state
            .douyin_browsers
            .action(
                &account_id,
                |reply| super::Action::Present(Box::new(request), host, reply),
                &tokio_util::sync::CancellationToken::new(),
            )
            .await
    }
}

#[cfg(target_os = "windows")]
pub(super) use windows::Surface;

#[cfg(target_os = "windows")]
mod windows {
    use super::{Content, Request};
    use crate::browser::{
        cdp::Cdp,
        douyin_browser::{dock, search::Pages, verification::Capture},
    };
    use serde_json::{Value, json};

    pub(crate) struct Surface {
        pid: u32,
        dock: Option<dock::Dock>,
        lease: String,
        session: String,
        context: i64,
        content: Option<Content>,
    }

    impl Surface {
        pub(crate) fn new(pid: u32) -> Self {
            if let Some(window) = dock::find_browser(pid) {
                dock::park_browser(window);
            }
            Self {
                pid,
                dock: None,
                lease: String::new(),
                session: String::new(),
                context: 0,
                content: None,
            }
        }

        pub(crate) fn hide(&self) {
            if let Some(dock) = &self.dock {
                dock.hide();
            }
        }

        pub(crate) async fn suspend(&mut self, cdp: &mut Cdp) {
            self.hide();
            if self.context != 0 {
                let _ = cdp.call(Some(&self.session), "Runtime.evaluate",
                    json!({"contextId":self.context,"expression":"globalThis.anyMusicSearch?.suspend()"})).await;
                self.context = 0;
            }
        }

        pub(crate) async fn update(
            &mut self,
            cdp: &mut Cdp,
            pages: &mut Pages,
            verification: Option<&Capture>,
            host: dock::Host,
            request: Request,
        ) -> Result<Value, String> {
            let Some(bounds) = request.bounds else {
                if self.lease == request.lease {
                    self.hide();
                    self.lease.clear();
                }
                return Ok(json!({"ready":false}));
            };
            let session = match (request.verification, verification) {
                (true, Some(active)) if active.matches_query(&request.query) => {
                    let session = active.session();
                    pages.touch_session(session).then(|| session.to_owned())
                }
                (false, None) => pages.presentation_tab(&request.query, false),
                _ => None,
            };
            let Some(session) = session else {
                if self.lease == request.lease {
                    self.hide();
                }
                return Ok(json!({"ready":false}));
            };
            let changed = self.lease != request.lease || self.session != session;
            if changed {
                self.hide();
                if self.dock.is_none() {
                    let browser =
                        dock::find_browser(self.pid).ok_or("无法唯一识别账号浏览器窗口。")?;
                    self.dock = Some(dock::Dock::create(host, browser, self.pid).await?);
                }
                cdp.call(Some(&session), "Page.bringToFront", json!({}))
                    .await?;
                self.lease = request.lease;
                if self.session != session {
                    self.context = 0;
                    self.content = None;
                }
                self.session = session;
            }
            let dirty = request.content.is_some();
            if let Some(content) = request.content {
                self.content = Some(content);
            }
            if self.content.is_none() {
                self.hide();
                return Ok(json!({"ready":false}));
            }
            if self.context == 0 {
                let frame = cdp
                    .call(Some(&self.session), "Page.getFrameTree", json!({}))
                    .await?;
                let frame = &frame["frameTree"]["frame"];
                let official = frame["url"]
                    .as_str()
                    .and_then(|url| reqwest::Url::parse(url).ok())
                    .is_some_and(|url| {
                        url.scheme() == "https"
                            && url.host_str() == Some("www.douyin.com")
                            && url.port_or_known_default() == Some(443)
                    });
                if !official {
                    return Ok(json!({"ready":false}));
                }
                let world = cdp
                    .call(
                        Some(&self.session),
                        "Page.createIsolatedWorld",
                        json!({"frameId":frame["id"],"worldName":"AnyMusicCatalog"}),
                    )
                    .await?;
                self.context = world["executionContextId"]
                    .as_i64()
                    .ok_or("无法初始化浏览器列表。")?;
                let source = include_str!("presentation-page.js");
                let result = self.evaluate(cdp, source).await?;
                if result != true {
                    self.context = 0;
                    return Ok(json!({"ready":false}));
                }
            }
            let mut send = dirty || changed;
            let mut result = self
                .evaluate(cdp, "globalThis.anyMusicSearch?.consume()")
                .await;
            let pending_action = result.as_ref().ok().map(|value| value["action"].clone());
            if result.as_ref().is_ok_and(Value::is_null) {
                // A fresh navigation destroyed the previous document. On the next update
                // resolve the new top-level origin and install the fixed script again.
                self.context = 0;
                self.hide();
                return Ok(json!({"ready":false}));
            }
            if result
                .as_ref()
                .is_ok_and(|value| value["needsContent"] == true)
            {
                send = true;
            }
            if send && let Some(content) = &self.content {
                result = self
                    .evaluate(
                        cdp,
                        &format!(
                            "globalThis.anyMusicSearch.update({}, {})",
                            serde_json::to_string(content).map_err(|_| "无法映射发现页歌曲。")?,
                            request.verification
                        ),
                    )
                    .await;
            }
            let result = match result {
                Ok(value) => value,
                Err(_) => {
                    self.context = 0;
                    self.hide();
                    return Ok(json!({"ready":false}));
                }
            };
            let action = pending_action
                .filter(|action| !action.is_null())
                .unwrap_or_else(|| result["action"].clone());
            if action["type"] == "actions" {
                self.hide();
                return Ok(json!({"ready":false,"action":action}));
            }
            let ready = self.dock.as_ref().unwrap().place(
                bounds,
                !request.verification || result["challengeVisible"] == true,
            )?;
            Ok(json!({"ready":ready,"action":action}))
        }

        async fn evaluate(&self, cdp: &mut Cdp, expression: &str) -> Result<Value, String> {
            let answer = cdp
                .call(
                    Some(&self.session),
                    "Runtime.evaluate",
                    json!({"contextId":self.context,"expression":expression,"returnByValue":true}),
                )
                .await?;
            if answer.get("exceptionDetails").is_some() {
                return Err("嵌入浏览器列表当前不可用。".into());
            }
            Ok(answer["result"]["value"].clone())
        }
    }
}
