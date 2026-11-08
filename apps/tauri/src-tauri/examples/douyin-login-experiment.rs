//! Opt-in live driver for the same native controller as the development panel.
//! Run only after an explicit user request. QR artifacts are temporary and removed on exit.
#[cfg(all(debug_assertions, target_os = "windows"))]
fn main() {
    let _input_echo = ConsoleInputEcho::disable();
    use any_music_tauri_lib::login_experiment::{Manager, Mode};
    use base64::Engine;
    use std::{io::BufRead, time::Duration};
    tauri::async_runtime::block_on(async {
        let mode = match std::env::args().nth(1).as_deref() {
            Some("headed-hidden") => Mode::HeadedHidden,
            Some("headless") => Mode::Headless,
            _ => {
                eprintln!("Specify headed-hidden or headless.");
                return;
            }
        };
        let root = std::env::temp_dir().join("any-music-login-experiments");
        let manager = Manager::default();
        let run = match manager.start(root.clone(), mode).await {
            Ok(run) => run,
            Err(error) => {
                eprintln!("{error}");
                return;
            }
        };
        let qr_path = root.join(format!("{run}.png"));
        let (input_tx, mut input) = tokio::sync::mpsc::channel::<String>(4);
        std::thread::spawn(move || {
            for line in std::io::stdin().lock().lines() {
                let Ok(line) = line else { break };
                if input_tx.blocking_send(line).is_err() {
                    break;
                }
            }
        });
        let mut tick = tokio::time::interval(Duration::from_secs(1));
        let mut last = String::new();
        let mut last_qr = String::new();
        let mut input_open = true;
        loop {
            tokio::select! {
                _=tick.tick()=>{
                    let Ok(snapshot)=manager.status(&run).await else{break};
                    let mut public=serde_json::to_value(&snapshot).unwrap();
                    if let Some(image)=public["login"]["qrImage"].as_str()
                        && image!=last_qr {last_qr=image.into();if let Some(encoded)=image.strip_prefix("data:image/png;base64,")&& let Ok(bytes)=base64::engine::general_purpose::STANDARD.decode(encoded)&& std::fs::write(&qr_path,bytes).is_ok(){println!("QR_FILE={}",qr_path.display());}}
                    public["login"].as_object_mut().map(|value|value.remove("qrImage"));
                    let text=public.to_string();if text!=last{println!("{text}");last=text;}
                    if snapshot.cleanup!="pending"{break}
                }
                line=input.recv(), if input_open=>{
                    let Some(line)=line else{input_open=false;continue};
                    let result=if line=="cancel"{break}else if line=="sms"{manager.sms(&run,None).await}else if let Some(code)=line.strip_prefix("code "){manager.sms(&run,Some(code.trim().into())).await}
                        else if line=="visible"{manager.visible(&run).await}else{Err("Use sms, code <six digits>, visible, or cancel.".into())};
                    if let Err(error)=result{eprintln!("{error}");}
                }
            }
        }
        if let Ok(snapshot) = manager.status(&run).await {
            let mut report = serde_json::to_value(snapshot).unwrap();
            report["login"].as_object_mut().map(|v| v.remove("qrImage"));
            println!("FINAL_OBSERVATION={report}");
        }
        if let Ok(Some(snapshot)) = manager.cancel(&run).await {
            println!("CLEANUP={}", snapshot.cleanup);
        }
        let _ = std::fs::remove_file(&qr_path);
    });
}
/// Avoid echoing a user's one-time SMS code into a captured terminal transcript.
#[cfg(all(debug_assertions, target_os = "windows"))]
struct ConsoleInputEcho(Option<(usize, u32)>);
#[cfg(all(debug_assertions, target_os = "windows"))]
#[link(name = "kernel32")]
unsafe extern "system" {
    fn GetStdHandle(kind: u32) -> *mut std::ffi::c_void;
    fn GetConsoleMode(handle: *mut std::ffi::c_void, mode: *mut u32) -> i32;
    fn SetConsoleMode(handle: *mut std::ffi::c_void, mode: u32) -> i32;
}
#[cfg(all(debug_assertions, target_os = "windows"))]
impl ConsoleInputEcho {
    fn disable() -> Self {
        let handle = unsafe { GetStdHandle(-10i32 as u32) };
        let mut mode = 0;
        if unsafe { GetConsoleMode(handle, &mut mode) } != 0
            && unsafe { SetConsoleMode(handle, mode & !4) } != 0
        {
            Self(Some((handle as usize, mode)))
        } else {
            Self(None)
        }
    }
}
#[cfg(all(debug_assertions, target_os = "windows"))]
impl Drop for ConsoleInputEcho {
    fn drop(&mut self) {
        if let Some((handle, mode)) = self.0 {
            unsafe {
                SetConsoleMode(handle as *mut std::ffi::c_void, mode);
            }
        }
    }
}
#[cfg(not(all(debug_assertions, target_os = "windows")))]
fn main() {
    eprintln!("This opt-in driver is only available in a Windows debug build.");
}
