mod error;
mod models;
mod store;

use std::{path::PathBuf, sync::Mutex};

use models::{DocumentPayload, DocumentRecord, DocumentState, FolderRecord, FolderTreeNode};
use store::LibraryStore;
use tauri::{AppHandle, Manager, State};

struct AppState {
    lock: Mutex<()>,
}

fn app_store(app: &AppHandle) -> Result<LibraryStore, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to resolve app data directory: {error}"))?;
    Ok(LibraryStore::new(app_dir))
}

fn with_store<T>(
    app: &AppHandle,
    state: State<'_, AppState>,
    action: impl FnOnce(LibraryStore) -> Result<T, String>,
) -> Result<T, String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "Unable to lock application state.".to_string())?;
    let store = app_store(app)?;
    action(store)
}

#[tauri::command]
fn import_pdf(
    app: AppHandle,
    state: State<'_, AppState>,
    source_path: String,
    destination_folder_id: Option<String>,
) -> Result<DocumentRecord, String> {
    with_store(&app, state, |store| {
        store
            .import_pdf(
                PathBuf::from(source_path).as_path(),
                destination_folder_id.as_deref(),
            )
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn list_library(app: AppHandle, state: State<'_, AppState>) -> Result<FolderTreeNode, String> {
    with_store(&app, state, |store| {
        store.list_library().map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn create_folder(
    app: AppHandle,
    state: State<'_, AppState>,
    name: String,
    parent_folder_id: Option<String>,
) -> Result<FolderRecord, String> {
    with_store(&app, state, |store| {
        store
            .create_folder(&name, parent_folder_id.as_deref())
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn move_document(
    app: AppHandle,
    state: State<'_, AppState>,
    document_id: String,
    destination_folder_id: String,
) -> Result<DocumentRecord, String> {
    with_store(&app, state, |store| {
        store
            .move_document(&document_id, &destination_folder_id)
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn open_document(
    app: AppHandle,
    state: State<'_, AppState>,
    document_id: String,
) -> Result<DocumentPayload, String> {
    with_store(&app, state, |store| {
        store
            .open_document(&document_id)
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn save_document_state(
    app: AppHandle,
    state: State<'_, AppState>,
    document_id: String,
    reader_state: DocumentState,
) -> Result<(), String> {
    with_store(&app, state, |store| {
        store
            .save_document_state(&document_id, reader_state)
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn list_recent_documents(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<DocumentRecord>, String> {
    with_store(&app, state, |store| {
        store
            .list_recent_documents()
            .map_err(|error| error.to_string())
    })
}

pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            lock: Mutex::new(()),
        })
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            import_pdf,
            list_library,
            create_folder,
            move_document,
            open_document,
            save_document_state,
            list_recent_documents
        ])
        .run(tauri::generate_context!())
        .expect("error while running calm reader");
}
