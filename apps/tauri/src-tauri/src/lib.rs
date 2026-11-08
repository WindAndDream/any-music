//! Native composition root: module wiring, IPC registration and application lifecycle.
#[cfg(all(
    mobile,
    any(feature = "s03-isolation-probe", feature = "s15-acceptance")
))]
compile_error!("Desktop acceptance harnesses cannot be assembled in mobile builds.");
mod accounts;
mod browser;
mod ipc;
mod isolation;
mod media;
mod model;
mod network;
mod plugins;
#[cfg(feature = "s15-acceptance")]
mod s15_acceptance;
#[cfg(feature = "s15-acceptance")]
pub use s15_acceptance::run as run_s15_acceptance;
mod state;
mod storage;
mod system;

#[cfg(feature = "s03-isolation-probe")]
pub use isolation::prototype::run as run_isolation_prototype;

// The standalone experiment example keeps its existing public import path.
pub use browser::login_experiment;
use tauri::Manager;
#[cfg(desktop)]
use tauri_plugin_deep_link::DeepLinkExt;

// macOS can embed Info.plist only once per binary. Every caller still receives a
// fresh context/authority, including isolated ACL tests and diagnostic examples.
fn application_context() -> tauri::Context<tauri::Wry> {
    tauri::generate_context!()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(target_os = "android")]
    let builder = builder.plugin(system::android::init());
    #[cfg(desktop)]
    let builder = plugins::executor::register(builder);
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .on_page_load(|webview, payload| {
            if webview.label() == "main"
                && matches!(payload.event(), tauri::webview::PageLoadEvent::Started)
                && let Some(state) = webview.try_state::<state::RuntimeState>()
            {
                state.download_schedules.clear();
            }
        })
        .setup(|app| {
            app.manage(plugins::executor::Executors::default());
            app.manage(plugins::control::DeliveryState::default());
            #[cfg(desktop)]
            for slot in 0..3 {
                app.add_capability(plugins::executor::capability(slot))?;
            }
            app.manage(plugins::dev::DevSessions::default());
            app.manage(plugins::PluginAuthority::new(
                app.path().app_local_data_dir()?,
            ));
            #[cfg(desktop)]
            {
                let incoming: Vec<_> = std::env::args_os()
                    .skip(1)
                    .map(std::path::PathBuf::from)
                    .filter(|path| {
                        path.extension()
                            .is_some_and(|ext| ext.eq_ignore_ascii_case("amplugin"))
                    })
                    .collect();
                plugins::delivery::preview_selected_paths(app.handle(), &incoming);
                let links: Vec<_> = std::env::args()
                    .skip(1)
                    .filter(|arg| arg.starts_with("anymusic://"))
                    .collect();
                plugins::delivery::preview_links(app.handle(), &links);
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    plugins::delivery::preview_links(
                        &handle,
                        &event
                            .urls()
                            .into_iter()
                            .map(|u| u.to_string())
                            .collect::<Vec<_>>(),
                    )
                });
            }
            let mut runtime = state::RuntimeState::new(app.path().app_local_data_dir()?)
                .map_err(std::io::Error::other)?;
            runtime.resource_cache = storage::resource_cache::ResourceCache::new(
                runtime.directory.clone(),
                app.path().app_cache_dir()?.join("resources"),
            );
            #[cfg(target_os = "android")]
            let runtime = {
                let mut runtime = runtime;
                runtime.credential_key_loader = Some(system::android::key_loader(app.handle()));
                runtime
            };
            accounts::deletion::schedule(runtime.directory.clone());
            app.manage(runtime);
            #[cfg(any(desktop, target_os = "android"))]
            media::start(app.handle().clone()).map_err(std::io::Error::other)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            #[cfg(mobile)]
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Suspended) {
                system::lifecycle::suspend(window.app_handle());
            }
            #[cfg(desktop)]
            if window.label() == "main"
                && let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) =
                    event
            {
                plugins::delivery::preview_selected_paths(window.app_handle(), paths);
            }
        })
        .invoke_handler(ipc::handler())
        .build(application_context())
        .expect("Unable to build Any Music Tauri runtime")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<plugins::dev::DevSessions>().stop();
                app.state::<plugins::executor::Executors>().stop_all();
                let state = app.state::<state::RuntimeState>();
                state.download_schedules.clear();
                tauri::async_runtime::block_on(state.experiments.shutdown());
                tauri::async_runtime::block_on(state.douyin_browsers.shutdown());
                let ids = state
                    .browsers
                    .lock()
                    .unwrap()
                    .keys()
                    .cloned()
                    .collect::<Vec<_>>();
                for id in ids {
                    browser::verification::stop_browser(&state, &id);
                }
                state.requests.lock().unwrap().cancel_all();
            }
        });
}
