//! Windows process-tree ownership for the development-only system-browser experiment.
//! Production account pages are embedded WebViews and start no external browser.

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
    // Capture GetLastError before cleanup calls replace it. Never include command lines/Profile data.
    fn last_error(stage: &str) -> String {
        format!(
            "network-error:{stage}（Windows 错误码 {}）。",
            std::io::Error::last_os_error().raw_os_error().unwrap_or(0)
        )
    }
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
            let process = child.as_raw_handle();
            let handle = unsafe { CreateJobObjectW(std::ptr::null_mut(), std::ptr::null()) };
            if handle.is_null() {
                return Err(last_error("无法创建浏览器进程隔离"));
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
                return Err(last_error("无法设置浏览器进程隔离"));
            }
            if unsafe { AssignProcessToJobObject(handle, process) } == 0 {
                return Err(last_error("无法隔离浏览器进程"));
            }
            Ok(job)
        }
        pub fn stop(&self) {
            unsafe {
                TerminateJobObject(self.0 as Handle, 0);
            }
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
