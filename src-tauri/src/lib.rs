mod debug;
mod error;
mod models;
mod store;

use std::{
    path::PathBuf,
    process::Command,
    sync::{Arc, Mutex},
};

use debug::process as debug_process;
use models::{
    DocumentPayload, DocumentRecord, DocumentState, FolderRecord, FolderTreeNode,
    RenderedPagePayload,
};
use serde_json::json;
use store::{LibraryStore, RenderCache};
use tauri::{AppHandle, Manager, State};

struct AppState {
    lock: Arc<Mutex<()>>,
    render_cache: Arc<Mutex<RenderCache>>,
}

fn app_store(app: &AppHandle) -> Result<LibraryStore, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to resolve app data directory: {error}"))?;
    let document_dir = app
        .path()
        .document_dir()
        .map_err(|error| format!("Unable to resolve the user documents directory: {error}"))?;
    Ok(LibraryStore::new(app_dir, document_dir.join("Reader")))
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

fn run_logged_command<T>(
    name: &str,
    fields: serde_json::Value,
    action: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let process = debug_process(format!("command.{name}"), fields);
    let result = action();

    match &result {
        Ok(_) => process.finish(json!({})),
        Err(error) => process.fail(error, json!({})),
    }

    result
}

fn open_in_explorer(path: &str, select: bool) -> Result<(), String> {
    let mut command = Command::new("explorer.exe");
    if select {
        command.arg(format!("/select,{path}"));
    } else {
        command.arg(path);
    }

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Unable to open File Explorer: {error}"))
}

#[tauri::command]
fn get_library_root(app: AppHandle, state: State<'_, AppState>) -> Result<String, String> {
    run_logged_command("get_library_root", json!({}), || with_store(&app, state, |store| {
        store.library_root_string().map_err(|error| error.to_string())
    }))
}

#[tauri::command]
fn import_pdf(
    app: AppHandle,
    state: State<'_, AppState>,
    source_path: String,
    destination_folder_id: Option<String>,
) -> Result<DocumentRecord, String> {
    run_logged_command("import_pdf", json!({
        "destinationFolderId": destination_folder_id,
        "sourcePath": source_path,
    }), || with_store(&app, state, |store| {
        store
            .import_pdf(
                PathBuf::from(source_path).as_path(),
                destination_folder_id.as_deref(),
            )
            .map_err(|error| error.to_string())
    }))
}

#[tauri::command]
fn list_library(app: AppHandle, state: State<'_, AppState>) -> Result<FolderTreeNode, String> {
    run_logged_command("list_library", json!({}), || with_store(&app, state, |store| {
        store.list_library().map_err(|error| error.to_string())
    }))
}

#[tauri::command]
fn rescan_library(app: AppHandle, state: State<'_, AppState>) -> Result<FolderTreeNode, String> {
    run_logged_command("rescan_library", json!({}), || with_store(&app, state, |store| {
        store.rescan_library().map_err(|error| error.to_string())
    }))
}

#[tauri::command]
fn create_folder(
    app: AppHandle,
    state: State<'_, AppState>,
    name: String,
    parent_folder_id: Option<String>,
) -> Result<FolderRecord, String> {
    run_logged_command("create_folder", json!({
        "name": name,
        "parentFolderId": parent_folder_id,
    }), || with_store(&app, state, |store| {
        store
            .create_folder(&name, parent_folder_id.as_deref())
            .map_err(|error| error.to_string())
    }))
}

#[tauri::command]
fn move_document(
    app: AppHandle,
    state: State<'_, AppState>,
    document_id: String,
    destination_folder_id: String,
) -> Result<DocumentRecord, String> {
    run_logged_command("move_document", json!({
        "destinationFolderId": destination_folder_id,
        "documentId": document_id,
    }), || with_store(&app, state, |store| {
        store
            .move_document(&document_id, &destination_folder_id)
            .map_err(|error| error.to_string())
    }))
}

#[tauri::command]
fn rename_document(
    app: AppHandle,
    state: State<'_, AppState>,
    document_id: String,
    new_name: String,
) -> Result<DocumentRecord, String> {
    run_logged_command("rename_document", json!({
        "documentId": document_id,
        "newName": new_name,
    }), || with_store(&app, state, |store| {
        store
            .rename_document(&document_id, &new_name)
            .map_err(|error| error.to_string())
    }))
}

#[tauri::command]
fn rename_folder(
    app: AppHandle,
    state: State<'_, AppState>,
    folder_id: String,
    new_name: String,
) -> Result<FolderRecord, String> {
    run_logged_command("rename_folder", json!({
        "folderId": folder_id,
        "newName": new_name,
    }), || with_store(&app, state, |store| {
        store
            .rename_folder(&folder_id, &new_name)
            .map_err(|error| error.to_string())
    }))
}

#[tauri::command]
fn remove_from_library(
    app: AppHandle,
    state: State<'_, AppState>,
    document_id: String,
    destination_directory: String,
) -> Result<DocumentRecord, String> {
    run_logged_command("remove_from_library", json!({
        "destinationDirectory": destination_directory,
        "documentId": document_id,
    }), || with_store(&app, state, |store| {
        store
            .remove_from_library(&document_id, PathBuf::from(destination_directory).as_path())
            .map_err(|error| error.to_string())
    }))
}

#[tauri::command]
fn open_document(
    app: AppHandle,
    state: State<'_, AppState>,
    document_id: String,
) -> Result<DocumentPayload, String> {
    run_logged_command("open_document", json!({
        "documentId": document_id,
    }), || with_store(&app, state, |store| {
        store
            .open_document(&document_id)
            .map_err(|error| error.to_string())
    }))
}

#[tauri::command]
fn save_document_state(
    app: AppHandle,
    state: State<'_, AppState>,
    document_id: String,
    reader_state: DocumentState,
) -> Result<(), String> {
    run_logged_command("save_document_state", json!({
        "documentId": document_id,
        "page": reader_state.last_page,
        "zoom": reader_state.zoom,
    }), || with_store(&app, state, |store| {
        store
            .save_document_state(&document_id, reader_state)
            .map_err(|error| error.to_string())
    }))
}

#[tauri::command]
fn list_recent_documents(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<DocumentRecord>, String> {
    run_logged_command("list_recent_documents", json!({}), || with_store(&app, state, |store| {
        store
            .list_recent_documents()
            .map_err(|error| error.to_string())
    }))
}

#[tauri::command]
fn open_library_folder(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    run_logged_command("open_library_folder", json!({}), || with_store(&app, state, |store| {
        let path = store.folder_path_string(None).map_err(|error| error.to_string())?;
        open_in_explorer(&path, false)
    }))
}

#[tauri::command]
fn show_document_in_explorer(
    app: AppHandle,
    state: State<'_, AppState>,
    document_id: String,
) -> Result<(), String> {
    run_logged_command("show_document_in_explorer", json!({
        "documentId": document_id,
    }), || with_store(&app, state, |store| {
        let path = store
            .document_path_string(&document_id)
            .map_err(|error| error.to_string())?;
        open_in_explorer(&path, true)
    }))
}

#[tauri::command]
fn show_folder_in_explorer(
    app: AppHandle,
    state: State<'_, AppState>,
    folder_id: Option<String>,
) -> Result<(), String> {
    run_logged_command("show_folder_in_explorer", json!({
        "folderId": folder_id,
    }), || with_store(&app, state, |store| {
        let path = store
            .folder_path_string(folder_id.as_deref())
            .map_err(|error| error.to_string())?;
        open_in_explorer(&path, false)
    }))
}

#[tauri::command]
fn read_document_bytes(
    app: AppHandle,
    state: State<'_, AppState>,
    document_id: String,
) -> Result<Vec<u8>, String> {
    run_logged_command("read_document_bytes", json!({
        "documentId": document_id,
    }), || with_store(&app, state, |store| {
        store
            .read_document_bytes(&document_id)
            .map_err(|error| error.to_string())
    }))
}

#[tauri::command]
async fn render_pdf_page(
    app: AppHandle,
    state: State<'_, AppState>,
    document_id: String,
    page_number: u32,
) -> Result<RenderedPagePayload, String> {
    let process = debug_process(
        "command.render_pdf_page",
        json!({
            "documentId": document_id,
            "page": page_number,
        }),
    );

    let render_cache = state.render_cache.clone();
    let task_document_id = document_id.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        let store = app_store(&app)?;
        let request = store
            .prepare_render_request(&task_document_id, page_number)
            .map_err(|error| error.to_string())?;
        crate::debug::action(
            "command.render_pdf_page:document-path-resolved",
            json!({
                "cacheKey": request.cache_key.clone(),
                "documentId": request.document_id.clone(),
                "page": request.page_number,
            }),
        );

        LibraryStore::render_pdf_page_blocking(request, render_cache).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("Unable to join blocking render task: {error}"))?;

    if let Err(error) = &result {
        process.fail(error, json!({}));
    } else {
        process.finish(json!({}));
    }

    result
}

pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            lock: Arc::new(Mutex::new(())),
            render_cache: Arc::new(Mutex::new(RenderCache::default())),
        })
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_library_root,
            import_pdf,
            list_library,
            rescan_library,
            create_folder,
            move_document,
            rename_document,
            rename_folder,
            remove_from_library,
            open_document,
            save_document_state,
            list_recent_documents,
            open_library_folder,
            show_document_in_explorer,
            show_folder_in_explorer,
            read_document_bytes,
            render_pdf_page
        ])
        .run(tauri::generate_context!())
        .expect("error while running calm reader");
}
