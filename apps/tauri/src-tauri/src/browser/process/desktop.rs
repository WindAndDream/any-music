//! Windows headed browsers run on an inactive desktop. Never switch the user's desktop.
//! Suspended launch joins the kill-on-close Job before Chrome can create descendants.
use super::windows::Job;
use std::{ffi::c_void, os::windows::ffi::OsStrExt, process::Command};
type Handle = *mut c_void;
// Capture GetLastError before cleanup calls replace it. Never include command lines/Profile data.
pub(super) fn last_error(stage: &str) -> String {
    format!(
        "network-error:{stage}（Windows 错误码 {}）。",
        std::io::Error::last_os_error().raw_os_error().unwrap_or(0)
    )
}
#[repr(C)]
struct Startup {
    size: u32,
    reserved: *mut u16,
    desktop: *mut u16,
    title: *mut u16,
    position_size_count: [u32; 7],
    flags: u32,
    show: u16,
    reserved_size: u16,
    reserved_bytes: *mut u8,
    input: Handle,
    output: Handle,
    error: Handle,
}
#[repr(C)]
struct ProcessInfo {
    process: Handle,
    thread: Handle,
    pid: u32,
    tid: u32,
}
#[link(name = "user32")]
unsafe extern "system" {
    fn CreateDesktopW(
        name: *const u16,
        device: Handle,
        mode: Handle,
        flags: u32,
        access: u32,
        attributes: Handle,
    ) -> Handle;
    fn CloseDesktop(desktop: Handle) -> i32;
}
#[link(name = "kernel32")]
unsafe extern "system" {
    fn CreateProcessW(
        app: *const u16,
        command: *mut u16,
        process_attributes: Handle,
        thread_attributes: Handle,
        inherit: i32,
        flags: u32,
        environment: Handle,
        directory: *const u16,
        startup: *const Startup,
        info: *mut ProcessInfo,
    ) -> i32;
    fn ResumeThread(thread: Handle) -> u32;
    fn CloseHandle(handle: Handle) -> i32;
    fn WaitForSingleObject(handle: Handle, milliseconds: u32) -> u32;
    fn TerminateProcess(handle: Handle, code: u32) -> i32;
    fn GetExitCodeProcess(handle: Handle, code: *mut u32) -> i32;
}
struct Desktop(usize);
impl Drop for Desktop {
    fn drop(&mut self) {
        unsafe {
            CloseDesktop(self.0 as Handle);
        }
    }
}
pub(super) struct BrowserProcess {
    process: usize,
    pid: u32,
    job: Job,
    _desktop: Option<Desktop>,
}
// Quote each UTF-16 argument according to CreateProcess/CommandLineToArgvW rules.
fn quote(argument: &std::ffi::OsStr) -> Vec<u16> {
    let mut out = vec![b'"' as u16];
    let mut slashes = 0;
    for ch in argument.encode_wide() {
        if ch == b'\\' as u16 {
            slashes += 1;
            continue;
        }
        out.extend(std::iter::repeat_n(
            b'\\' as u16,
            if ch == b'"' as u16 {
                slashes * 2 + 1
            } else {
                slashes
            },
        ));
        slashes = 0;
        out.push(ch);
    }
    out.extend(std::iter::repeat_n(b'\\' as u16, slashes * 2));
    out.push(b'"' as u16);
    out
}
impl BrowserProcess {
    pub(super) fn start(command: &Command, hidden: bool) -> Result<Self, String> {
        let mut desktop_name: Vec<u16> = format!("AnyMusic_{}", uuid::Uuid::new_v4().simple())
            .encode_utf16()
            .chain([0])
            .collect();
        let desktop = if hidden {
            // GENERIC_ALL on an unpredictable desktop name in the current user's window station.
            let handle = unsafe {
                CreateDesktopW(
                    desktop_name.as_ptr(),
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    0,
                    0x10000000,
                    std::ptr::null_mut(),
                )
            };
            if handle.is_null() {
                return Err(last_error("无法创建隐藏账号桌面"));
            }
            Some(Desktop(handle as usize))
        } else {
            None
        };
        let app: Vec<u16> = command.get_program().encode_wide().chain([0]).collect();
        let mut line = quote(command.get_program());
        for arg in command.get_args() {
            line.push(b' ' as u16);
            line.extend(quote(arg));
        }
        line.push(0);
        let mut startup: Startup = unsafe { std::mem::zeroed() };
        startup.size = std::mem::size_of::<Startup>() as u32;
        startup.flags = 0x80; // STARTF_FORCEOFFFEEDBACK; no cursor change on the active desktop.
        if hidden {
            startup.desktop = desktop_name.as_mut_ptr();
        }
        let mut info: ProcessInfo = unsafe { std::mem::zeroed() };
        // No inherited handles, no shell, inherited environment; all credentials remain in Profile.
        if unsafe {
            CreateProcessW(
                app.as_ptr(),
                line.as_mut_ptr(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                0,
                0x08000004,
                std::ptr::null_mut(),
                std::ptr::null(),
                &startup,
                &mut info,
            )
        } == 0
        {
            return Err(last_error("无法启动账号浏览器"));
        }
        let result = Job::from_handle(info.process);
        if result.is_err() {
            unsafe {
                TerminateProcess(info.process, 1);
            }
        }
        let result = result.and_then(|job| {
            if unsafe { ResumeThread(info.thread) } == u32::MAX {
                let error = last_error("无法恢复账号浏览器进程");
                job.stop();
                Err(error)
            } else {
                Ok(job)
            }
        });
        unsafe {
            CloseHandle(info.thread);
        }
        match result {
            Ok(job) => Ok(Self {
                process: info.process as usize,
                pid: info.pid,
                job,
                _desktop: desktop,
            }),
            Err(error) => {
                unsafe {
                    WaitForSingleObject(info.process, 3000);
                    CloseHandle(info.process);
                }
                Err(error)
            }
        }
    }
    #[cfg(test)]
    pub(super) fn exited(&self) -> bool {
        unsafe { WaitForSingleObject(self.process as Handle, 0) == 0 }
    }
    pub(super) fn tree_exited(&self) -> Result<bool, String> {
        self.job.active_processes().map(|count| count == 0)
    }
    pub(super) fn exit_code(&self) -> Option<u32> {
        let mut code = 0;
        (unsafe { GetExitCodeProcess(self.process as Handle, &mut code) } != 0).then_some(code)
    }
    pub(super) fn id(&self) -> u32 {
        self.pid
    }
    pub(super) fn stop(&self) {
        self.job.stop();
    }
}
impl Drop for BrowserProcess {
    fn drop(&mut self) {
        self.stop();
        // Waiting only on the launcher races the next Chrome instance against old descendants.
        // AccountProcess retains its profile lock while this field is dropped.
        let _ = self.job.wait_for_exit(std::time::Duration::from_secs(5));
        unsafe {
            WaitForSingleObject(self.process as Handle, 3000);
            CloseHandle(self.process as Handle);
        }
        // The desktop handle closes after its owned browser tree has been terminated.
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn command_arguments_preserve_spaces_quotes_and_trailing_slashes() {
        let encoded = |value: &str| String::from_utf16(&quote(value.as_ref())).unwrap();
        assert_eq!(
            encoded("C:\\Account Profiles\\"),
            "\"C:\\Account Profiles\\\\\""
        );
        assert_eq!(encoded("a\"b"), "\"a\\\"b\"");
        assert_eq!(encoded(""), "\"\"");
        assert_eq!(std::mem::size_of::<Startup>(), 104);
    }
    #[test]
    fn missing_executable_reports_launch_stage_and_windows_code() {
        // This nonexistent executable cannot launch a browser or open a window.
        let command = Command::new(
            std::env::temp_dir().join(format!("any-music-missing-{}.exe", uuid::Uuid::new_v4())),
        );
        let error = BrowserProcess::start(&command, false).err().unwrap();
        assert!(error.starts_with("network-error:无法启动账号浏览器"));
        assert!(error.contains("Windows 错误码 2"));
    }
    #[test]
    fn profile_handoff_waits_for_descendants_after_the_launcher_exits() {
        // Launch only this test binary, without UI or any browser/network access.
        let ready = std::env::temp_dir().join(format!("any-music-job-{}", uuid::Uuid::new_v4()));
        let mut command = Command::new(std::env::current_exe().unwrap());
        command.args(["--ignored", "--exact", owned_tree_fixture_name()]);
        // CreateProcessW inherits the environment, so the fixture path must be an argument.
        command.arg(ready.as_os_str());
        let process = BrowserProcess::start(&command, false).unwrap();
        let started = std::time::Instant::now();
        while !process.exited() && started.elapsed() < std::time::Duration::from_secs(10) {
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        assert!(
            ready.exists(),
            "descendant must be ready before the launcher exits"
        );
        assert!(process.exited());
        assert!(!process.tree_exited().unwrap());
        assert_eq!(process.exit_code(), Some(0));
        process.stop();
        process
            .job
            .wait_for_exit(std::time::Duration::from_secs(5))
            .unwrap();
        assert!(process.tree_exited().unwrap());
        drop(process);
        std::fs::remove_file(ready).unwrap();
    }
    #[test]
    #[ignore = "subprocess fixture; executed only by the owned-tree regression"]
    // This fixture deliberately exits before its descendant; the parent regression
    // proves that the owning Windows Job waits for and terminates that whole tree.
    #[allow(clippy::zombie_processes)]
    fn owned_tree_fixture() {
        use std::os::windows::process::CommandExt;
        let Some(ready) =
            std::env::args_os().find(|arg| arg.to_string_lossy().contains("any-music-job-"))
        else {
            return;
        };
        if std::env::var_os("ANY_MUSIC_JOB_LEAF").is_some() {
            std::fs::write(&ready, "ready").unwrap();
            std::thread::sleep(std::time::Duration::from_secs(30));
            return;
        }
        let mut child = Command::new(std::env::current_exe().unwrap());
        child
            .args(["--ignored", "--exact", owned_tree_fixture_name()])
            .arg(&ready)
            .env("ANY_MUSIC_JOB_LEAF", "1")
            .creation_flags(0x08000000)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        let _child = child.spawn().unwrap();
        let started = std::time::Instant::now();
        while !std::path::Path::new(&ready).exists() {
            assert!(started.elapsed() < std::time::Duration::from_secs(10));
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
    }

    fn owned_tree_fixture_name() -> &'static str {
        // libtest names omit the crate prefix; derive the rest so module moves cannot skip the fixture.
        concat!(module_path!(), "::owned_tree_fixture")
            .split_once("::")
            .unwrap()
            .1
    }
}
