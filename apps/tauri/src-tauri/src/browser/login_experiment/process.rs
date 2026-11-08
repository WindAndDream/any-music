//! Disposable system-browser process. A Windows job owns descendants as well as the launcher.
use super::Mode;
use crate::browser::cdp::Cdp;
use std::{
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    time::Duration,
};
use tokio_util::sync::CancellationToken;

pub struct Process {
    child: Child,
    #[cfg(target_os = "windows")]
    job: windows::Job,
    #[cfg(target_os = "windows")]
    monitor: windows::Monitor,
    pub directory: PathBuf,
}
impl Process {
    pub fn start(
        browser: &Path,
        directory: &Path,
        mode: Mode,
        visible: bool,
    ) -> Result<Self, String> {
        std::fs::create_dir_all(directory).map_err(|_| "无法创建临时浏览器目录。")?;
        let _ = std::fs::remove_file(directory.join("DevToolsActivePort"));
        #[cfg(target_os = "windows")]
        let monitor = windows::Monitor::new()?;
        let mut command = Command::new(browser);
        command
            .arg(format!("--user-data-dir={}", directory.display()))
            .args([
                "--remote-debugging-port=0",
                "--remote-debugging-address=127.0.0.1",
                "--no-first-run",
                "--no-default-browser-check",
                "--no-proxy-server",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        if visible {
            command.arg("https://www.douyin.com/");
        } else {
            match mode {
                Mode::HeadedHidden => {
                    command.arg("--no-startup-window");
                }
                Mode::Headless => {
                    command.args(["--headless", "--window-size=1280,850", "about:blank"]);
                }
            }
        }
        let child = command.spawn().map_err(|_| "无法启动专属试验浏览器。")?;
        #[cfg(target_os = "windows")]
        let mut child = child;
        #[cfg(target_os = "windows")]
        let job = match windows::Job::new(&child) {
            Ok(job) => job,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }
        };
        Ok(Self {
            child,
            #[cfg(target_os = "windows")]
            job,
            #[cfg(target_os = "windows")]
            monitor,
            directory: directory.into(),
        })
    }
    pub fn window_seen(&self) -> bool {
        #[cfg(target_os = "windows")]
        {
            self.monitor.seen(self.child.id())
        }
        #[cfg(not(target_os = "windows"))]
        {
            false
        }
    }
    pub fn exited(&mut self) -> bool {
        self.child.try_wait().ok().flatten().is_some()
    }
    pub async fn connect(&mut self, cancel: &CancellationToken) -> Result<Cdp, String> {
        let wait = async {
            loop {
                if self.exited() {
                    return Err("试验浏览器提前退出。".into());
                }
                if let Ok(text) =
                    tokio::fs::read_to_string(self.directory.join("DevToolsActivePort")).await
                {
                    let mut lines = text.lines();
                    if let (Some(port), Some(path)) = (
                        lines
                            .next()
                            .and_then(|s| s.parse::<u16>().ok())
                            .filter(|p| *p > 0),
                        lines.next().filter(|s| {
                            s.starts_with("/devtools/browser/")
                                && !s.contains(['\r', '\n', '?', '#'])
                        }),
                    ) {
                        return Cdp::connect(&format!("ws://127.0.0.1:{port}{path}"), cancel).await;
                    }
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        };
        tokio::select! {
            _ = cancel.cancelled() => Err("试验已取消。".into()),
            value = tokio::time::timeout(Duration::from_secs(30),wait) => value.map_err(|_|"试验浏览器启动超时。".to_string()).and_then(|v|v),
        }
    }
    pub fn stop(&mut self) {
        #[cfg(target_os = "windows")]
        self.job.stop();
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
impl Drop for Process {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Never recursively remove a renderer-supplied or computed unverified path.
pub fn cleanup(root: &Path, directory: &Path) -> Result<(), String> {
    if !directory.exists() {
        return Ok(());
    }
    let root = root.canonicalize().map_err(|_| "无法检查试验目录。")?;
    let directory = directory
        .canonicalize()
        .map_err(|_| "无法检查临时 Profile。")?;
    let name = directory
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("试验目录无效。")?;
    if directory.parent() != Some(root.as_path()) || uuid::Uuid::parse_str(name).is_err() {
        return Err("拒绝清理试验根目录以外的路径。".into());
    }
    std::fs::remove_dir_all(directory)
        .map_err(|_| "临时 Profile 清理失败，请检查浏览器是否已退出。".into())
}

#[cfg(target_os = "windows")]
use crate::browser::process::windows;

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cleanup_is_scoped() {
        let root = std::env::temp_dir().join(format!("any-music-cleanup-{}", uuid::Uuid::new_v4()));
        let profile = root.join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(&profile).unwrap();
        assert!(cleanup(&root, &root).is_err());
        assert!(cleanup(&root, &profile).is_ok());
        std::fs::remove_dir(root).unwrap();
    }
}
