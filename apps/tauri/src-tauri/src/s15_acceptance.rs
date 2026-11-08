//! Explicit opt-in local acceptance executable. Always uses a new, empty temporary root;
//! no product account/media server or user profile is loaded. Never called by the product.
use crate::plugins::{self, PluginAuthority};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
pub fn run() {
    assert!(
        cfg!(windows),
        "S15 acceptance currently supports Windows only"
    );
    let root = std::env::temp_dir().join(format!("any-music-s15-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).expect("new acceptance root");
    let report = std::env::var_os("AM_S15_CONTROL_FILE").expect("explicit report file");
    let port = std::env::var("AM_S15_MAIN_PORT").expect("explicit debug port");
    let mut context = crate::application_context();
    context.config_mut().app.windows.clear();
    plugins::executor::register(tauri::Builder::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .invoke_handler(crate::ipc::handler())
        .setup(move|app|{
            let authority=if std::env::var_os("AM_S15_USE_PRODUCTION_ADMISSION").is_some(){PluginAuthority::new(root.join("native"))}else{PluginAuthority::accepted(root.join("native"))};
            app.manage(authority);
            app.manage(plugins::executor::Executors::default());
            app.manage(plugins::control::DeliveryState::default());
            app.manage(plugins::dev::DevSessions::default());
            app.manage(crate::state::RuntimeState::new(root.join("product")).map_err(std::io::Error::other)?);
            for slot in 0..3 {app.add_capability(plugins::executor::capability(slot))?;}
            WebviewWindowBuilder::new(app,"main",WebviewUrl::App("index.html".into()))
                .title("Any Music S15 acceptance — empty temporary data")
                .data_directory(root.join("main")).inner_size(1280.0,850.0)
                .additional_browser_args(&format!("--remote-debugging-port={port} --remote-debugging-address=127.0.0.1"))
                .build()?;
            #[cfg(windows)]
            if let Ok(base)=std::env::var("AM_S15_EXECUTOR_BASE_PORT").unwrap_or_default().parse::<u16>() {
                WebviewWindowBuilder::new(app,"s15-peer",WebviewUrl::External("https://am-plugin-0.localhost/index.html".parse().unwrap()))
                    .data_directory(root.join("same-origin-peer")).visible(false).focused(false).use_https_scheme(true)
                    .additional_browser_args(&format!("--remote-debugging-port={} --remote-debugging-address=127.0.0.1",base+3)).build()?;
            }
            #[cfg(windows)]
            let pairing=std::env::var_os("AM_S15_DEV_PROJECT").map(|p|tauri::async_runtime::block_on(async {plugins::dev::begin_selected(app.handle().clone(),p.into())}).expect("explicit DEV project"));
            #[cfg(not(windows))]
            let pairing:Option<String>=None;
            std::fs::write(report,serde_json::to_vec(&serde_json::json!({"root":root,"os":std::env::consts::OS,"arch":std::env::consts::ARCH,"osBuild":plugins::target::os_build(),"webview":tauri::webview_version().unwrap_or_default(),"pairing":pairing})).unwrap())?;
            Ok(())
        })
        .on_window_event(|window,event|{if window.label()=="main" {
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop{paths,..})=event {plugins::delivery::preview_selected_paths(window.app_handle(),paths);}
            if matches!(event,tauri::WindowEvent::Destroyed) {window.app_handle().exit(0);}
        }})
        .build(context).expect("S15 explicit acceptance app")
        .run(|app,event|if matches!(event,tauri::RunEvent::Exit){app.state::<plugins::dev::DevSessions>().stop();app.state::<plugins::executor::Executors>().stop_all();});
}
