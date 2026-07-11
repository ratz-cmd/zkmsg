// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
use db::AppState;
use std::sync::Mutex;

fn main() {
    tauri::Builder::default()
        // Manage the SQLCipher database state
        .manage(AppState {
            db: Mutex::new(None),
        })
        // Register all IPC commands explicitly here so they are exposed to the frontend
        .invoke_handler(tauri::generate_handler![
            db::unlock_database,
            db::lock_database,
            db::load_messages,
            db::save_ratchet_and_message,
            db::get_or_create_identity
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
