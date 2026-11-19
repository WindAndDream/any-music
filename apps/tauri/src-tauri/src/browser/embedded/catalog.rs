//! Native placement for the inline Discover page. Its lease is independent of login dialogs.
use super::{Bounds, HIDDEN_ORIGIN, Host};
use std::sync::Mutex;
use tauri::{LogicalPosition, LogicalSize, Manager, Rect, Webview};
use tokio::sync::watch;

#[derive(Default)]
pub(in crate::browser) struct Surface {
    current: Mutex<Option<Lease>>,
}

struct Lease {
    id: String,
    account: String,
    bounds: Option<Bounds>,
    webview: Option<Webview>,
    ready: watch::Sender<bool>,
}

impl Surface {
    pub(in crate::browser) fn reserve(&self, id: &str, account: &str) -> watch::Receiver<bool> {
        let (ready, receiver) = watch::channel(false);
        let mut current = self.current.lock().unwrap();
        if let Some(previous) = current.as_ref().and_then(|lease| lease.webview.as_ref()) {
            park(previous);
        }
        *current = Some(Lease {
            id: id.into(),
            account: account.into(),
            bounds: None,
            webview: None,
            ready,
        });
        receiver
    }

    pub(in crate::browser) fn owns(&self, id: &str) -> bool {
        self.current
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(|lease| lease.id == id)
    }

    pub(in crate::browser) fn reveal(
        &self,
        host: &Host,
        id: &str,
        label: &str,
    ) -> Result<(), String> {
        let mut current = self.current.lock().unwrap();
        let lease = current
            .as_mut()
            .filter(|lease| lease.id == id)
            .ok_or("operation-cancelled:抖音搜索页面已关闭。")?;
        if !host.owns(label, &lease.account) {
            return Err("operation-cancelled:抖音搜索页面已关闭。".into());
        }
        let webview = host
            .app
            .get()
            .and_then(|app| app.get_webview(label))
            .ok_or("operation-cancelled:抖音搜索页面已关闭。")?;
        if let Some(bounds) = lease.bounds {
            place(&webview, bounds)?;
        }
        lease.webview = Some(webview);
        lease.ready.send_replace(true);
        Ok(())
    }

    pub(in crate::browser) fn layout(
        &self,
        id: &str,
        bounds: Option<Bounds>,
    ) -> Result<bool, String> {
        if bounds.is_some_and(|bounds| !bounds.valid() || bounds.x < 0.0 || bounds.y < 0.0) {
            return Err("invalid-input:页面区域无效。".into());
        }
        let mut current = self.current.lock().unwrap();
        let Some(lease) = current.as_mut().filter(|lease| lease.id == id) else {
            return Ok(false);
        };
        if lease.bounds != bounds {
            if let Some(webview) = &lease.webview {
                match bounds {
                    Some(bounds) => place(webview, bounds)?,
                    None => park(webview),
                }
            }
            lease.bounds = bounds;
        }
        Ok(true)
    }

    pub(in crate::browser) fn close(&self, id: &str) {
        let mut current = self.current.lock().unwrap();
        if current.as_ref().is_some_and(|lease| lease.id == id)
            && let Some(lease) = current.take()
            && let Some(webview) = &lease.webview
        {
            park(webview);
        }
    }
}

fn place(webview: &Webview, bounds: Bounds) -> Result<(), String> {
    // Leave focus in the product until the user interacts with the official page.
    webview
        .set_bounds(Rect {
            position: LogicalPosition::new(bounds.x, bounds.y).into(),
            size: LogicalSize::new(bounds.width, bounds.height).into(),
        })
        .map_err(|_| "network-error:无法显示抖音搜索页面。".into())
}

fn park(webview: &Webview) {
    // Keep the last viewport size while hidden behind a product dialog.
    let _ = webview.set_position(LogicalPosition::new(HIDDEN_ORIGIN, 0.0));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replacement_ignores_stale_layout_and_close() {
        let surface = Surface::default();
        let old = surface.reserve("old", "account");
        let current = surface.reserve("new", "account");
        assert!(old.has_changed().is_err());
        assert!(!*current.borrow());
        surface.close("old");
        assert!(!surface.layout("old", None).unwrap());
        assert!(surface.layout("new", None).unwrap());
        surface.close("new");
        assert!(!surface.owns("new"));
    }
}
