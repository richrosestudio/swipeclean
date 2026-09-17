mod duplicates;
mod protect;
mod scan;
mod trash_ops;
mod types;

use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;

use tauri::{Manager, State};

use protect::{ProtectionSettings, RootCheck};
use types::{FindDuplicatesResult, ScanComplete, ScanRequest, ScannedFile, TrashItemResult};

pub struct AppState {
    pub cancel_scan: AtomicBool,
    pub last_scan: Mutex<Vec<ScannedFile>>,
}

fn config_dir(app: &tauri::AppHandle) -> std::path::PathBuf {
    app.path().app_config_dir().unwrap_or_else(|_| {
        dirs::config_dir()
            .unwrap_or_else(std::env::temp_dir)
            .join("com.richrose.swipeclean")
    })
}

#[tauri::command]
fn scan_folder(
    app: tauri::AppHandle,
    state: State<AppState>,
    request: ScanRequest,
) -> Result<ScanComplete, String> {
    scan::scan_folder(app, state, request)
}

#[tauri::command]
fn cancel_scan(state: State<AppState>) {
    scan::cancel_scan(state);
}

#[tauri::command]
fn move_to_trash(app: tauri::AppHandle, paths: Vec<String>) -> Vec<TrashItemResult> {
    trash_ops::move_to_trash(&app, paths)
}

#[tauri::command]
fn restore_from_trash(paths: Vec<String>) -> Vec<TrashItemResult> {
    trash_ops::restore_from_trash(paths)
}

#[tauri::command]
fn read_file_bytes(path: String, max_bytes: usize) -> Result<Vec<u8>, String> {
    let cap = max_bytes.min(50 * 1024 * 1024);
    scan::read_file_bytes(path, cap)
}

#[tauri::command]
fn find_duplicates(
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<FindDuplicatesResult, String> {
    duplicates::find_duplicates(app, state)
}

#[tauri::command]
fn get_protection_settings(app: tauri::AppHandle) -> ProtectionSettings {
    protect::load_settings(&config_dir(&app))
}

#[tauri::command]
fn save_protection_settings(
    app: tauri::AppHandle,
    settings: ProtectionSettings,
) -> Result<ProtectionSettings, String> {
    protect::save_settings(&config_dir(&app), settings)
}

#[tauri::command]
fn check_scan_root(path: String) -> RootCheck {
    protect::check_scan_root(Path::new(&path))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            cancel_scan: AtomicBool::new(false),
            last_scan: Mutex::new(Vec::new()),
        })
        .invoke_handler(tauri::generate_handler![
            scan_folder,
            cancel_scan,
            move_to_trash,
            restore_from_trash,
            read_file_bytes,
            find_duplicates,
            get_protection_settings,
            save_protection_settings,
            check_scan_root
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
