//! Windows hosts the real Chromium HWND in a clipping child window. CDP remains
//! responsible for the page and never transports frames or mouse input.
use serde::Deserialize;
use std::{ptr::null_mut, sync::Arc};
use tauri::WebviewWindow;
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, RECT},
    UI::WindowsAndMessaging::{
        CreateWindowExW, DestroyWindow, EnumChildWindows, EnumWindows, GWL_STYLE, GetClassNameW,
        GetClientRect, GetParent, GetWindowLongPtrW, GetWindowRect, GetWindowThreadProcessId,
        HWND_TOP, SW_HIDE, SW_SHOWNOACTIVATE, SWP_FRAMECHANGED, SWP_HIDEWINDOW, SWP_NOACTIVATE,
        SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SWP_SHOWWINDOW, SetParent, SetWindowLongPtrW,
        SetWindowPos, ShowWindowAsync, WS_CAPTION, WS_CHILD, WS_CLIPCHILDREN, WS_CLIPSIBLINGS,
        WS_POPUP, WS_THICKFRAME, WS_VISIBLE,
    },
};

#[derive(Clone, Copy, Deserialize)]
pub(super) struct Rect {
    pub left: i32,
    pub top: i32,
    pub width: i32,
    pub height: i32,
}

fn window_class(window: HWND, expected: &str) -> bool {
    let mut name = [0u16; 64];
    let size = unsafe { GetClassNameW(window, name.as_mut_ptr(), name.len() as i32) };
    size > 0
        && expected
            .encode_utf16()
            .eq(name[..size as usize].iter().copied())
}

fn owner(window: HWND) -> u32 {
    let mut pid = 0;
    unsafe { GetWindowThreadProcessId(window, &mut pid) };
    pid
}

pub(super) fn find_browser(pid: u32) -> Option<usize> {
    unsafe extern "system" fn visit(window: HWND, param: LPARAM) -> i32 {
        // EnumWindows calls this synchronously with the search tuple below.
        let search = unsafe { &mut *(param as *mut (u32, Vec<usize>)) };
        if owner(window) == search.0 && window_class(window, "Chrome_WidgetWin_1") {
            search.1.push(window as usize);
        }
        1
    }
    let mut search = (pid, Vec::new());
    unsafe { EnumWindows(Some(visit), &mut search as *mut _ as LPARAM) };
    (search.1.len() == 1).then(|| search.1[0])
}

pub(super) fn park_browser(browser: usize) {
    unsafe { ShowWindowAsync(browser as HWND, SW_HIDE) };
}

fn bounds(window: HWND) -> Option<RECT> {
    let mut rect = RECT::default();
    (unsafe { GetWindowRect(window, &mut rect) } != 0).then_some(rect)
}

fn viewport(browser: HWND) -> Option<RECT> {
    unsafe extern "system" fn visit(window: HWND, param: LPARAM) -> i32 {
        let largest = unsafe { &mut *(param as *mut Option<RECT>) };
        if window_class(window, "Chrome_RenderWidgetHostHWND")
            && unsafe { GetWindowLongPtrW(window, GWL_STYLE) } as u32 & WS_VISIBLE != 0
            && let Some(rect) = bounds(window)
            && largest
                .as_ref()
                .is_none_or(|previous| area(&rect) > area(previous))
        {
            *largest = Some(rect);
        }
        1
    }
    let mut largest: Option<RECT> = None;
    unsafe { EnumChildWindows(browser, Some(visit), &mut largest as *mut _ as LPARAM) };
    largest
}

fn area(rect: &RECT) -> i64 {
    i64::from(rect.right - rect.left) * i64::from(rect.bottom - rect.top)
}

fn insets(outer: &RECT, content: &RECT) -> Option<[i32; 4]> {
    let margins = [
        content.left - outer.left,
        content.top - outer.top,
        outer.right - content.right,
        outer.bottom - content.bottom,
    ];
    (area(content) > 0 && margins.iter().all(|value| (0..=512).contains(value))).then_some(margins)
}

type Dispatch = dyn Fn(Box<dyn FnOnce() + Send>) -> Result<(), String> + Send + Sync;

/// The browser actor receives only the native parent and its main-thread dispatcher.
/// This keeps Tauri's event loop out of standalone actor tests and CDP workers.
pub(super) struct Host {
    parent: usize,
    dispatch: Arc<Dispatch>,
}

impl Host {
    pub(super) fn from_window(window: WebviewWindow) -> Result<Self, String> {
        let parent = window.hwnd().map_err(|_| "无法定位发现页的主窗口。")?.0 as usize;
        Ok(Self {
            parent,
            dispatch: Arc::new(move |task| {
                window
                    .run_on_main_thread(task)
                    .map_err(|_| "应用主窗口已结束。".to_string())
            }),
        })
    }
}

pub(super) struct Dock {
    dispatch: Arc<Dispatch>,
    holder: usize,
    browser: usize,
    pid: u32,
    original_style: isize,
}

impl Dock {
    pub(super) async fn create(host: Host, browser: usize, pid: u32) -> Result<Self, String> {
        let (reply, result) = tokio::sync::oneshot::channel();
        let parent = host.parent;
        (host.dispatch)(Box::new(move || {
            let hwnd = unsafe {
                CreateWindowExW(
                    0,
                    windows_sys::w!("STATIC"),
                    null_mut(),
                    WS_CHILD | WS_CLIPCHILDREN | WS_CLIPSIBLINGS,
                    0,
                    0,
                    0,
                    0,
                    parent as HWND,
                    null_mut(),
                    null_mut(),
                    null_mut(),
                )
            };
            let holder = (!hwnd.is_null()).then_some(hwnd as usize);
            if let Err(Some(holder)) = reply.send(holder) {
                unsafe { DestroyWindow(holder as HWND) };
            }
        }))?;
        let holder = result
            .await
            .ok()
            .flatten()
            .ok_or("无法创建发现页的浏览器容器。")?;
        let original_style = unsafe { GetWindowLongPtrW(browser as HWND, GWL_STYLE) };
        let dock = Self {
            dispatch: host.dispatch,
            holder,
            browser,
            pid,
            original_style,
        };
        let browser = browser as HWND;
        if owner(browser) != pid {
            return Err("账号浏览器窗口已结束。".into());
        }
        let style = original_style as u32;
        unsafe {
            SetWindowLongPtrW(
                browser,
                GWL_STYLE,
                ((style & !(WS_POPUP | WS_CAPTION | WS_THICKFRAME)) | WS_CHILD) as isize,
            );
            SetParent(browser, holder as HWND);
        }
        if unsafe { GetParent(browser) } != holder as HWND {
            unsafe { SetWindowLongPtrW(browser, GWL_STYLE, style as isize) };
            return Err("无法将账号浏览器嵌入发现页。".into());
        }
        // Restore within the hidden parent. The clipping bounds are installed before reveal.
        unsafe { ShowWindowAsync(browser, SW_SHOWNOACTIVATE) };
        Ok(dock)
    }

    pub(super) fn hide(&self) {
        // Keep hide and place ordered. A queued ShowWindowAsync could hide a newer placement.
        unsafe {
            SetWindowPos(
                self.holder as HWND,
                null_mut(),
                0,
                0,
                0,
                0,
                SWP_HIDEWINDOW | SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER,
            );
        }
    }

    pub(super) fn place(&self, rect: Rect, reveal: bool) -> Result<bool, String> {
        let browser = self.browser as HWND;
        let holder = self.holder as HWND;
        if owner(browser) != self.pid || unsafe { GetParent(browser) } != holder {
            return Err("账号浏览器窗口已结束。".into());
        }
        let parent = unsafe { GetParent(holder) };
        let mut client = RECT::default();
        if unsafe { GetClientRect(parent, &mut client) } == 0 {
            return Err("发现页浏览器容器已结束。".into());
        }
        let width = rect.width.min(client.right.saturating_sub(rect.left));
        let height = rect.height.min(client.bottom.saturating_sub(rect.top));
        if rect.left < 0 || rect.top < 0 || width < 64 || height < 64 {
            self.hide();
            return Ok(false);
        }
        // Use Chromium's WebContents accessibility HWND only as a geometry probe.
        // The actual composition and input stay with its owning browser window.
        let margins = bounds(browser)
            .and_then(|outer| viewport(browser).and_then(|view| insets(&outer, &view)));
        // The negative rectangle lets Chromium lay out WebContents while the app clips
        // everything until the page and its native content bounds are both available.
        let visible = margins.is_some() && reveal;
        let (holder_left, holder_top) = if visible {
            (rect.left, rect.top)
        } else {
            (-width, -height)
        };
        let [left, top, right, bottom] = margins.unwrap_or([0; 4]);
        let child_flags = SWP_NOACTIVATE
            | SWP_SHOWWINDOW
            | if margins.is_none() {
                SWP_FRAMECHANGED
            } else {
                0
            };
        unsafe {
            let place_holder = || {
                SetWindowPos(
                    holder,
                    HWND_TOP,
                    holder_left,
                    holder_top,
                    width,
                    height,
                    SWP_NOACTIVATE | SWP_SHOWWINDOW,
                ) != 0
            };
            if (!visible && !place_holder())
                || SetWindowPos(
                    browser,
                    HWND_TOP,
                    -left,
                    -top,
                    width + left + right,
                    height + top + bottom,
                    child_flags,
                ) == 0
                || (visible && !place_holder())
            {
                self.hide();
                return Err("无法更新发现页的浏览器大小。".into());
            }
        }
        Ok(visible)
    }
}

impl Drop for Dock {
    fn drop(&mut self) {
        let holder = self.holder;
        let browser = self.browser;
        let pid = self.pid;
        let original_style = self.original_style;
        let _ = (self.dispatch)(Box::new(move || unsafe {
            let parent = holder as HWND;
            let child = browser as HWND;
            if owner(child) == pid && GetParent(child) == parent {
                ShowWindowAsync(child, SW_HIDE);
                SetParent(child, null_mut());
                SetWindowLongPtrW(child, GWL_STYLE, original_style & !(WS_VISIBLE as isize));
            }
            DestroyWindow(parent);
        }));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clips_native_toolbar_using_content_bounds() {
        let outer = RECT {
            left: 20,
            top: 30,
            right: 820,
            bottom: 630,
        };
        let content = RECT {
            left: 24,
            top: 116,
            right: 816,
            bottom: 626,
        };
        assert_eq!(insets(&outer, &content), Some([4, 86, 4, 4]));
        assert!(insets(&outer, &RECT { top: 29, ..content }).is_none());
    }
}
