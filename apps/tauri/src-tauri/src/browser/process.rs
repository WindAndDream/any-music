//! Persistent account profiles. The process and its descendants are owned by one native actor.
use crate::browser::cdp::Cdp;
use fs2::FileExt;
use std::{
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Duration,
};
use tokio_util::sync::CancellationToken;

pub struct AccountProcess {
    pub visible: bool,
    #[cfg(not(target_os = "windows"))]
    child: std::process::Child,
    #[cfg(target_os = "windows")]
    child: desktop::BrowserProcess,
    directory: PathBuf,
    _lock: std::fs::File,
    #[cfg(target_os = "windows")]
    monitor: Option<windows::Monitor>,
}
impl AccountProcess {
    pub fn remember_browser(&self, kind: &str) -> Result<(), String> {
        if !matches!(kind, "chrome" | "edge") {
            return Err("invalid-input:账号浏览器类型无效。".into());
        }
        crate::storage::vault::write_atomic(
            &self.directory.join(".account-browser"),
            kind.as_bytes(),
        )
    }
    pub fn start(
        root: &Path,
        account_id: &str,
        browser: &Path,
        proxy: Option<&str>,
        visible: bool,
    ) -> Result<Self, String> {
        crate::model::validate_id(account_id)?;
        // Windows canonical paths have a \\?\ prefix which Chrome's command-line Profile
        // parser does not accept. Validate with canonical paths, launch with an absolute path.
        let launch_directory = std::path::absolute(root)
            .map_err(|_| "无法定位账号目录。")?
            .join(account_id);
        std::fs::create_dir_all(root).map_err(|_| "无法创建账号目录。")?;
        let root = root.canonicalize().map_err(|_| "无法检查账号目录。")?;
        let directory = root.join(account_id);
        std::fs::create_dir_all(&directory).map_err(|_| "无法创建账号 Profile。")?;
        let directory = directory
            .canonicalize()
            .map_err(|_| "无法检查账号 Profile。")?;
        if directory.parent() != Some(root.as_path()) {
            return Err("拒绝使用账号目录以外的 Profile。".into());
        }
        let lock = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(directory.join(".account-profile-lock"))
            .map_err(|_| "无法锁定账号 Profile。")?;
        lock.try_lock_exclusive()
            .map_err(|_| "此账号 Profile 正在使用，请关闭该账号的浏览器后重试。")?;
        let _ = std::fs::remove_file(directory.join("DevToolsActivePort"));
        #[cfg(target_os = "windows")]
        let monitor = if visible {
            None
        } else {
            Some(windows::Monitor::new()?)
        };
        let mut command = Command::new(browser);
        command
            .arg(format!("--user-data-dir={}", launch_directory.display()))
            .args([
                "--remote-debugging-port=0",
                "--remote-debugging-address=127.0.0.1",
                "--no-first-run",
                "--no-default-browser-check",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        match proxy {
            Some(proxy) => {
                command.arg(format!("--proxy-server={proxy}"));
            }
            None => {
                command.arg("--no-proxy-server");
            }
        }
        if visible || cfg!(target_os = "windows") {
            command.arg("about:blank");
        } else {
            command.arg("--no-startup-window");
        }
        #[cfg(target_os = "windows")]
        let child = desktop::BrowserProcess::start(&command, !visible)?;
        #[cfg(not(target_os = "windows"))]
        let child = command.spawn().map_err(|_| "无法启动账号浏览器。")?;
        Ok(Self {
            visible,
            child,
            directory,
            _lock: lock,
            #[cfg(target_os = "windows")]
            monitor,
        })
    }
    pub fn exited(&mut self) -> Result<bool, String> {
        #[cfg(target_os = "windows")]
        {
            // Chrome may replace its launcher while an owned browser process keeps running.
            self.child.tree_exited()
        }
        #[cfg(not(target_os = "windows"))]
        {
            self.child
                .try_wait()
                .map(|value| value.is_some())
                .map_err(|_| "network-error:无法检查账号浏览器进程。".into())
        }
    }
    pub fn window_seen(&self) -> bool {
        #[cfg(target_os = "windows")]
        {
            self.monitor
                .as_ref()
                .is_some_and(|m| m.seen(self.child.id()))
        }
        #[cfg(not(target_os = "windows"))]
        {
            false
        }
    }
    /// The root can exit while Chrome descendants still own Profile/Singleton handles.
    /// Keep the profile lock until the whole owned tree has finished, including forced exit.
    pub async fn wait_for_exit(&mut self, budget: Duration) -> Result<(), String> {
        let work = async {
            loop {
                if self.exited()? {
                    return Ok(());
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        };
        tokio::time::timeout(budget, work)
            .await
            .map_err(|_| "request-timeout:旧账号浏览器尚未完全退出，请稍后重试。".to_string())?
    }
    pub fn terminate(&mut self) {
        #[cfg(target_os = "windows")]
        self.child.stop();
        #[cfg(not(target_os = "windows"))]
        let _ = self.child.kill();
    }
    fn startup_error(&mut self) -> String {
        #[cfg(target_os = "windows")]
        let code = self
            .child
            .exit_code()
            .map(|code| format!("（进程退出码 {code}）"));
        #[cfg(not(target_os = "windows"))]
        let code = self
            .child
            .try_wait()
            .ok()
            .flatten()
            .map(|code| format!("（{code}）"));
        format!(
            "network-error:账号浏览器在连接前退出{}；请关闭此账号的旧验证窗口后重试。",
            code.unwrap_or_default()
        )
    }
    pub async fn connect(&mut self, cancel: &CancellationToken) -> Result<Cdp, String> {
        let work = async {
            loop {
                if self.exited()? {
                    return Err(self.startup_error());
                }
                if let Ok(text) =
                    tokio::fs::read_to_string(self.directory.join("DevToolsActivePort")).await
                {
                    let mut lines = text.lines();
                    if let (Some(port), Some(path)) = (
                        lines
                            .next()
                            .and_then(|v| v.parse::<u16>().ok())
                            .filter(|v| *v > 0),
                        lines.next().filter(|v| {
                            v.starts_with("/devtools/browser/")
                                && !v.contains(['?', '#', '\r', '\n'])
                        }),
                    ) {
                        // Actor cancellation ends operations first; leave the socket available
                        // briefly for Browser.close so Chrome can flush its persistent Profile.
                        return Cdp::connect(
                            &format!("ws://127.0.0.1:{port}{path}"),
                            &CancellationToken::new(),
                        )
                        .await;
                    }
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        };
        tokio::select! {_=cancel.cancelled()=>Err("operation-cancelled:账号浏览器启动已取消。".into()),result=tokio::time::timeout(Duration::from_secs(20),work)=>result.map_err(|_|"request-timeout:账号浏览器启动超时。".to_string()).and_then(|v|v)}
    }
}
impl Drop for AccountProcess {
    fn drop(&mut self) {
        #[cfg(target_os = "windows")]
        self.child.stop();
        #[cfg(not(target_os = "windows"))]
        {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
        // The persistent Profile survives cancellation, app exit and a browser restart.
    }
}

#[cfg(target_os = "windows")]
mod desktop;

#[cfg(target_os = "windows")]
pub(crate) mod windows {
    use std::{
        collections::HashSet,
        ffi::c_void,
        os::windows::io::AsRawHandle,
        process::Child,
        sync::{
            Arc, Mutex,
            atomic::{AtomicBool, Ordering},
        },
        thread::JoinHandle,
        time::Duration,
    };
    type Handle = *mut c_void;
    #[repr(C)]
    #[derive(Default)]
    struct BasicLimits {
        process_time: i64,
        job_time: i64,
        flags: u32,
        minimum: usize,
        maximum: usize,
        active: u32,
        affinity: usize,
        priority: u32,
        scheduling: u32,
    }
    #[repr(C)]
    #[derive(Default)]
    struct ExtendedLimits {
        basic: BasicLimits,
        io: [u64; 6],
        process_memory: usize,
        job_memory: usize,
        peak_process: usize,
        peak_job: usize,
    }
    #[repr(C)]
    #[derive(Default)]
    struct Accounting {
        times: [i64; 4],
        faults: u32,
        total: u32,
        active: u32,
        terminated: u32,
    }
    #[repr(C)]
    #[derive(Default)]
    struct Message {
        window: Handle,
        message: u32,
        wparam: usize,
        lparam: isize,
        time: u32,
        point: [i32; 2],
        private: u32,
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn CreateJobObjectW(attributes: Handle, name: *const u16) -> Handle;
        fn SetInformationJobObject(job: Handle, class: u32, info: *const c_void, size: u32) -> i32;
        fn AssignProcessToJobObject(job: Handle, process: Handle) -> i32;
        fn TerminateJobObject(job: Handle, code: u32) -> i32;
        fn QueryInformationJobObject(
            job: Handle,
            class: u32,
            info: *mut c_void,
            size: u32,
            written: *mut u32,
        ) -> i32;
        fn CloseHandle(handle: Handle) -> i32;
    }
    #[link(name = "user32")]
    unsafe extern "system" {
        fn SetWinEventHook(
            min: u32,
            max: u32,
            module: Handle,
            callback: unsafe extern "system" fn(Handle, u32, Handle, i32, i32, u32, u32),
            process: u32,
            thread: u32,
            flags: u32,
        ) -> Handle;
        fn UnhookWinEvent(hook: Handle) -> i32;
        fn PeekMessageW(
            message: *mut Message,
            window: Handle,
            min: u32,
            max: u32,
            remove: u32,
        ) -> i32;
        fn GetWindowThreadProcessId(window: Handle, process: *mut u32) -> u32;
        fn GetAncestor(window: Handle, flags: u32) -> Handle;
    }
    pub struct Job(usize);
    impl Job {
        pub fn new(child: &Child) -> Result<Self, String> {
            Self::from_handle(child.as_raw_handle())
        }
        pub(crate) fn from_handle(process: Handle) -> Result<Self, String> {
            let handle = unsafe { CreateJobObjectW(std::ptr::null_mut(), std::ptr::null()) };
            if handle.is_null() {
                return Err(super::desktop::last_error("无法创建浏览器进程隔离"));
            }
            let job = Self(handle as usize);
            let mut limits = ExtendedLimits::default();
            limits.basic.flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            if unsafe {
                SetInformationJobObject(
                    handle,
                    9,
                    &limits as *const _ as *const c_void,
                    std::mem::size_of::<ExtendedLimits>() as u32,
                )
            } == 0
            {
                return Err(super::desktop::last_error("无法设置浏览器进程隔离"));
            }
            if unsafe { AssignProcessToJobObject(handle, process) } == 0 {
                return Err(super::desktop::last_error("无法隔离浏览器进程"));
            }
            Ok(job)
        }
        pub fn stop(&self) {
            unsafe {
                TerminateJobObject(self.0 as Handle, 0);
            }
        }
        pub(crate) fn active_processes(&self) -> Result<u32, String> {
            let mut info = Accounting::default();
            if unsafe {
                QueryInformationJobObject(
                    self.0 as Handle,
                    1,
                    &mut info as *mut _ as *mut c_void,
                    std::mem::size_of::<Accounting>() as u32,
                    std::ptr::null_mut(),
                )
            } == 0
            {
                return Err(super::desktop::last_error("无法检查账号浏览器进程树"));
            }
            Ok(info.active)
        }
        pub(crate) fn wait_for_exit(&self, budget: Duration) -> Result<(), String> {
            let started = std::time::Instant::now();
            while self.active_processes()? != 0 {
                if started.elapsed() >= budget {
                    return Err("request-timeout:账号浏览器进程树尚未退出。".into());
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            Ok(())
        }
    }
    impl Drop for Job {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0 as Handle);
            }
        }
    }
    // The callback runs on the hook thread. It stores process IDs only, never titles or page data.
    thread_local! {static SHOWN: std::cell::RefCell<Option<Arc<Mutex<HashSet<u32>>>>> = const {std::cell::RefCell::new(None)};}
    unsafe extern "system" fn shown(
        _hook: Handle,
        _event: u32,
        window: Handle,
        object: i32,
        _child: i32,
        _thread: u32,
        _time: u32,
    ) {
        if object != 0 || window.is_null() || unsafe { GetAncestor(window, 2) } != window {
            return;
        }
        let mut pid = 0;
        unsafe {
            GetWindowThreadProcessId(window, &mut pid);
        }
        SHOWN.with(|slot| {
            if let Some(shown) = slot.borrow().as_ref() {
                shown.lock().unwrap().insert(pid);
            }
        });
    }
    pub struct Monitor {
        stop: Arc<AtomicBool>,
        shown: Arc<Mutex<HashSet<u32>>>,
        thread: Option<JoinHandle<()>>,
    }
    impl Monitor {
        pub fn new() -> Result<Self, String> {
            let stop = Arc::new(AtomicBool::new(false));
            let shown_ids = Arc::new(Mutex::new(HashSet::new()));
            let done = stop.clone();
            let ids = shown_ids.clone();
            let (ready, wait) = std::sync::mpsc::channel();
            let thread = std::thread::spawn(move || {
                SHOWN.with(|slot| *slot.borrow_mut() = Some(ids));
                let hook = unsafe {
                    SetWinEventHook(0x8002, 0x8002, std::ptr::null_mut(), shown, 0, 0, 0)
                };
                let _ = ready.send(!hook.is_null());
                if hook.is_null() {
                    return;
                }
                while !done.load(Ordering::SeqCst) {
                    let mut message = Message::default();
                    while unsafe { PeekMessageW(&mut message, std::ptr::null_mut(), 0, 0, 1) } != 0
                    {
                    }
                    std::thread::sleep(Duration::from_millis(5));
                }
                unsafe {
                    UnhookWinEvent(hook);
                }
            });
            if !wait.recv_timeout(Duration::from_secs(2)).unwrap_or(false) {
                stop.store(true, Ordering::SeqCst);
                let _ = thread.join();
                return Err("无法监测试验浏览器窗口。".into());
            }
            Ok(Self {
                stop,
                shown: shown_ids,
                thread: Some(thread),
            })
        }
        pub fn seen(&self, pid: u32) -> bool {
            self.shown.lock().unwrap().contains(&pid)
        }
    }
    impl Drop for Monitor {
        fn drop(&mut self) {
            self.stop.store(true, Ordering::SeqCst);
            if let Some(thread) = self.thread.take() {
                let _ = thread.join();
            }
        }
    }
}
