mod debug;
mod error;
mod models;
mod normalization;
mod store;

use std::{
    collections::HashMap,
    path::PathBuf,
    process::Command,
    sync::{Arc, Condvar, Mutex},
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use debug::process as debug_process;
use models::{
    DocumentPayload, DocumentRecord, DocumentState, FolderRecord, FolderTreeNode, NoteDocument,
    RenderedPagePayload,
};
use normalization::{new_manifest_cache, ManifestCache, NormalizationWorker};
use serde_json::{json, Value};
use store::{LibraryStore, RenderCache};
use tauri::{webview::PageLoadEvent, AppHandle, Manager, State};

struct AppState {
    lock: Arc<Mutex<()>>,
    render_cache: Arc<Mutex<RenderCache>>,
    in_flight_renders: Arc<Mutex<HashMap<String, Arc<InFlightRender>>>>,
    active_reader_generation: Arc<Mutex<Option<ActiveReaderGeneration>>>,
    normalization_worker: NormalizationWorker,
    normalization_cache: ManifestCache,
}

#[derive(Clone)]
struct ActiveReaderGeneration {
    document_id: String,
    generation_id: String,
}

struct InFlightRender {
    result: Mutex<Option<Result<RenderedPagePayload, String>>>,
    ready: Condvar,
}

fn epoch_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

impl InFlightRender {
    fn new() -> Self {
        Self {
            result: Mutex::new(None),
            ready: Condvar::new(),
        }
    }
}

fn set_active_reader_generation(
    active_reader_generation: &Arc<Mutex<Option<ActiveReaderGeneration>>>,
    document_id: &str,
    generation_id: &str,
) -> Result<(), String> {
    let mut guard = active_reader_generation
        .lock()
        .map_err(|_| "Unable to lock active reader generation.".to_string())?;
    *guard = Some(ActiveReaderGeneration {
        document_id: document_id.to_string(),
        generation_id: generation_id.to_string(),
    });
    Ok(())
}

fn is_active_reader_generation(
    active_reader_generation: &Arc<Mutex<Option<ActiveReaderGeneration>>>,
    document_id: &str,
    generation_id: Option<&str>,
) -> Result<bool, String> {
    let Some(generation_id) = generation_id else {
        return Ok(true);
    };

    let guard = active_reader_generation
        .lock()
        .map_err(|_| "Unable to lock active reader generation.".to_string())?;
    Ok(matches!(
        guard.as_ref(),
        Some(active)
            if active.document_id == document_id && active.generation_id == generation_id
    ))
}

fn run_or_join_in_flight_render(
    request: store::PageRenderRequest,
    render_cache: Arc<Mutex<RenderCache>>,
    in_flight_renders: Arc<Mutex<HashMap<String, Arc<InFlightRender>>>>,
) -> Result<RenderedPagePayload, String> {
    let cache_key = request.cache_key.clone();

    let (entry, is_leader) = {
        let mut in_flight = in_flight_renders
            .lock()
            .map_err(|_| "Unable to lock in-flight render state.".to_string())?;

        if let Some(existing) = in_flight.get(&cache_key) {
            (existing.clone(), false)
        } else {
            let created = Arc::new(InFlightRender::new());
            in_flight.insert(cache_key.clone(), created.clone());
            (created, true)
        }
    };

    if !is_leader {
        crate::debug::action(
            "command.render_pdf_page:join-in-flight",
            json!({
                "cacheKey": cache_key,
                "documentId": request.document_id,
                "documentGenerationId": request.document_generation_id,
                "page": request.page_number,
                "requestSequence": request.request_sequence,
                "zoom": request.zoom,
            }),
        );

        let mut guard = entry
            .result
            .lock()
            .map_err(|_| "Unable to lock in-flight render result.".to_string())?;
        while guard.is_none() {
            guard = entry
                .ready
                .wait(guard)
                .map_err(|_| "Unable to wait for in-flight render result.".to_string())?;
        }
        return guard
            .clone()
            .ok_or_else(|| "Unable to resolve in-flight render result.".to_string())?;
    }

    let result = LibraryStore::render_pdf_page_blocking(request, render_cache)
        .map_err(|error| error.to_string());

    {
        let mut guard = entry
            .result
            .lock()
            .map_err(|_| "Unable to lock in-flight render result.".to_string())?;
        *guard = Some(result.clone());
        entry.ready.notify_all();
    }

    let mut in_flight = in_flight_renders
        .lock()
        .map_err(|_| "Unable to lock in-flight render state.".to_string())?;
    in_flight.remove(&cache_key);

    result
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
    run_logged_command("get_library_root", json!({}), || {
        with_store(&app, state, |store| {
            store
                .library_root_string()
                .map_err(|error| error.to_string())
        })
    })
}

#[tauri::command]
fn import_pdf(
    app: AppHandle,
    state: State<'_, AppState>,
    source_path: String,
    destination_folder_id: Option<String>,
) -> Result<DocumentRecord, String> {
    run_logged_command(
        "import_pdf",
        json!({
            "destinationFolderId": destination_folder_id,
            "sourcePath": source_path,
        }),
        || {
            let worker = state.normalization_worker.clone();
            let result = with_store(&app, state, |store| {
                let record = store
                    .import_pdf(
                        PathBuf::from(source_path).as_path(),
                        destination_folder_id.as_deref(),
                    )
                    .map_err(|error| error.to_string())?;
                let job = store.prepare_normalization_job(&record.id).ok();
                Ok((record, job))
            })?;
            if let Some(job) = result.1 {
                if let Err(error) = worker.schedule(job) {
                    crate::debug::action(
                        "normalization.schedule-error",
                        json!({"error": error.to_string()}),
                    );
                }
            }
            Ok(result.0)
        },
    )
}

#[tauri::command]
fn list_library(app: AppHandle, state: State<'_, AppState>) -> Result<FolderTreeNode, String> {
    run_logged_command("list_library", json!({}), || {
        with_store(&app, state, |store| {
            store.list_library().map_err(|error| error.to_string())
        })
    })
}

#[tauri::command]
fn rescan_library(app: AppHandle, state: State<'_, AppState>) -> Result<FolderTreeNode, String> {
    run_logged_command("rescan_library", json!({}), || {
        with_store(&app, state, |store| {
            store.rescan_library().map_err(|error| error.to_string())
        })
    })
}

#[tauri::command]
fn create_folder(
    app: AppHandle,
    state: State<'_, AppState>,
    name: String,
    parent_folder_id: Option<String>,
) -> Result<FolderRecord, String> {
    run_logged_command(
        "create_folder",
        json!({
            "name": name,
            "parentFolderId": parent_folder_id,
        }),
        || {
            with_store(&app, state, |store| {
                store
                    .create_folder(&name, parent_folder_id.as_deref())
                    .map_err(|error| error.to_string())
            })
        },
    )
}

#[tauri::command]
fn move_document(
    app: AppHandle,
    state: State<'_, AppState>,
    document_id: String,
    destination_folder_id: String,
) -> Result<DocumentRecord, String> {
    run_logged_command(
        "move_document",
        json!({
            "destinationFolderId": destination_folder_id,
            "documentId": document_id,
        }),
        || {
            with_store(&app, state, |store| {
                store
                    .move_document(&document_id, &destination_folder_id)
                    .map_err(|error| error.to_string())
            })
        },
    )
}

#[tauri::command]
fn rename_document(
    app: AppHandle,
    state: State<'_, AppState>,
    document_id: String,
    new_name: String,
) -> Result<DocumentRecord, String> {
    run_logged_command(
        "rename_document",
        json!({
            "documentId": document_id,
            "newName": new_name,
        }),
        || {
            with_store(&app, state, |store| {
                store
                    .rename_document(&document_id, &new_name)
                    .map_err(|error| error.to_string())
            })
        },
    )
}

#[tauri::command]
fn rename_folder(
    app: AppHandle,
    state: State<'_, AppState>,
    folder_id: String,
    new_name: String,
) -> Result<FolderRecord, String> {
    run_logged_command(
        "rename_folder",
        json!({
            "folderId": folder_id,
            "newName": new_name,
        }),
        || {
            with_store(&app, state, |store| {
                store
                    .rename_folder(&folder_id, &new_name)
                    .map_err(|error| error.to_string())
            })
        },
    )
}

#[tauri::command]
fn delete_folder(
    app: AppHandle,
    state: State<'_, AppState>,
    folder_id: String,
) -> Result<FolderRecord, String> {
    run_logged_command(
        "delete_folder",
        json!({
            "folderId": folder_id,
        }),
        || {
            with_store(&app, state, |store| {
                store
                    .delete_folder(&folder_id)
                    .map_err(|error| error.to_string())
            })
        },
    )
}

#[tauri::command]
fn remove_from_library(
    app: AppHandle,
    state: State<'_, AppState>,
    document_id: String,
    destination_directory: String,
) -> Result<DocumentRecord, String> {
    run_logged_command(
        "remove_from_library",
        json!({
            "destinationDirectory": destination_directory,
            "documentId": document_id,
        }),
        || {
            with_store(&app, state, |store| {
                store
                    .remove_from_library(
                        &document_id,
                        PathBuf::from(destination_directory).as_path(),
                    )
                    .map_err(|error| error.to_string())
            })
        },
    )
}

#[tauri::command]
fn open_document(
    app: AppHandle,
    state: State<'_, AppState>,
    document_id: String,
    open_session_id: Option<String>,
) -> Result<DocumentPayload, String> {
    run_logged_command(
        "open_document",
        json!({
            "documentId": document_id,
            "openSessionId": open_session_id,
        }),
        || {
            let worker = state.normalization_worker.clone();
            let active_reader_generation = state.active_reader_generation.clone();
            let result = with_store(&app, state, |store| {
                let payload = store
                    .open_document(&document_id)
                    .map_err(|error| error.to_string())?;
                let mut job = store.prepare_normalization_job(&document_id).ok();
                if let Some(job) = job.as_mut() {
                    job.page_count = payload.page_count;
                }
                Ok((payload, job))
            })?;
            if let Some(job) = result.1 {
                if let Err(error) = worker.schedule(job) {
                    crate::debug::action(
                        "normalization.schedule-error",
                        json!({"error": error.to_string()}),
                    );
                }
            }
            if let Some(session_id) = open_session_id.as_deref() {
                set_active_reader_generation(
                    &active_reader_generation,
                    &document_id,
                    session_id,
                )?;
            }
            Ok(result.0)
        },
    )
}

#[tauri::command]
fn save_document_state(
    app: AppHandle,
    state: State<'_, AppState>,
    document_id: String,
    reader_state: DocumentState,
) -> Result<(), String> {
    run_logged_command(
        "save_document_state",
        json!({
            "documentId": document_id,
            "page": reader_state.last_page,
            "zoom": reader_state.zoom,
        }),
        || {
            with_store(&app, state, |store| {
                store
                    .save_document_state(&document_id, reader_state)
                    .map_err(|error| error.to_string())
            })
        },
    )
}

#[tauri::command]
fn get_or_create_note_for_book(
    app: AppHandle,
    state: State<'_, AppState>,
    document_id: String,
) -> Result<NoteDocument, String> {
    run_logged_command(
        "get_or_create_note_for_book",
        json!({
            "documentId": document_id,
        }),
        || {
            with_store(&app, state, |store| {
                store
                    .get_or_create_note_for_book(&document_id)
                    .map_err(|error| error.to_string())
            })
        },
    )
}

#[tauri::command]
fn save_note(
    app: AppHandle,
    state: State<'_, AppState>,
    note: NoteDocument,
) -> Result<NoteDocument, String> {
    run_logged_command(
        "save_note",
        json!({
            "bookId": note.book_id.clone(),
            "noteId": note.id.clone(),
        }),
        || {
            with_store(&app, state, |store| {
                store.save_note(note).map_err(|error| error.to_string())
            })
        },
    )
}

#[tauri::command]
fn log_note_debug_event(event: String, fields: Value) -> Result<(), String> {
    crate::debug::action(&event, fields);
    Ok(())
}

#[tauri::command]
fn list_recent_documents(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<DocumentRecord>, String> {
    run_logged_command("list_recent_documents", json!({}), || {
        with_store(&app, state, |store| {
            store
                .list_recent_documents()
                .map_err(|error| error.to_string())
        })
    })
}

#[tauri::command]
fn open_library_folder(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    run_logged_command("open_library_folder", json!({}), || {
        with_store(&app, state, |store| {
            let path = store
                .folder_path_string(None)
                .map_err(|error| error.to_string())?;
            open_in_explorer(&path, false)
        })
    })
}

#[tauri::command]
fn show_document_in_explorer(
    app: AppHandle,
    state: State<'_, AppState>,
    document_id: String,
) -> Result<(), String> {
    run_logged_command(
        "show_document_in_explorer",
        json!({
            "documentId": document_id,
        }),
        || {
            with_store(&app, state, |store| {
                let path = store
                    .document_path_string(&document_id)
                    .map_err(|error| error.to_string())?;
                open_in_explorer(&path, true)
            })
        },
    )
}

#[tauri::command]
fn show_folder_in_explorer(
    app: AppHandle,
    state: State<'_, AppState>,
    folder_id: Option<String>,
) -> Result<(), String> {
    run_logged_command(
        "show_folder_in_explorer",
        json!({
            "folderId": folder_id,
        }),
        || {
            with_store(&app, state, |store| {
                let path = store
                    .folder_path_string(folder_id.as_deref())
                    .map_err(|error| error.to_string())?;
                open_in_explorer(&path, false)
            })
        },
    )
}

#[tauri::command]
fn read_document_bytes(
    app: AppHandle,
    state: State<'_, AppState>,
    document_id: String,
) -> Result<Vec<u8>, String> {
    run_logged_command(
        "read_document_bytes",
        json!({
            "documentId": document_id,
        }),
        || {
            with_store(&app, state, |store| {
                store
                    .read_document_bytes(&document_id)
                    .map_err(|error| error.to_string())
            })
        },
    )
}

#[tauri::command]
async fn render_pdf_page(
    app: AppHandle,
    state: State<'_, AppState>,
    document_id: String,
    page_number: u32,
    zoom: f32,
    open_session_id: Option<String>,
    request_sequence: Option<u32>,
) -> Result<RenderedPagePayload, String> {
    let process = debug_process(
        "command.render_pdf_page",
        json!({
            "documentId": document_id,
            "documentGenerationId": open_session_id,
            "openSessionId": open_session_id,
            "page": page_number,
            "requestSequence": request_sequence,
            "zoom": zoom,
        }),
    );

    let render_cache = state.render_cache.clone();
    let in_flight_renders = state.in_flight_renders.clone();
    let active_reader_generation = state.active_reader_generation.clone();
    let normalization_cache = state.normalization_cache.clone();
    let task_document_id = document_id.clone();
    let task_open_session_id = open_session_id.clone();
    let queued_at = Instant::now();

    let result = tauri::async_runtime::spawn_blocking(move || {
        crate::debug::action(
            "command.render_pdf_page:execution-started",
            json!({
                "documentId": task_document_id,
                "documentGenerationId": task_open_session_id,
                "page": page_number,
                "queuedWaitMs": queued_at.elapsed().as_millis(),
                "requestSequence": request_sequence,
                "zoom": zoom,
            }),
        );

        if !is_active_reader_generation(
            &active_reader_generation,
            &task_document_id,
            task_open_session_id.as_deref(),
        )? {
            crate::debug::action(
                "command.render_pdf_page:skipped-stale-generation",
                json!({
                    "documentId": task_document_id,
                    "documentGenerationId": task_open_session_id,
                    "page": page_number,
                    "requestSequence": request_sequence,
                    "zoom": zoom,
                }),
            );
            return Err("Stale render request skipped.".to_string());
        }

        let store = app_store(&app)?;
        let mut request = store
            .prepare_render_request(&task_document_id, page_number, zoom, &normalization_cache)
            .map_err(|error| error.to_string())?;
        request.document_generation_id = task_open_session_id.clone();
        request.request_sequence = request_sequence;
        crate::debug::action(
            "command.render_pdf_page:document-path-resolved",
            json!({
                "cacheKey": request.cache_key.clone(),
                "documentId": request.document_id.clone(),
                "documentGenerationId": request.document_generation_id,
                "page": request.page_number,
                "requestSequence": request.request_sequence,
                "zoom": request.zoom,
            }),
        );

        run_or_join_in_flight_render(request, render_cache, in_flight_renders)
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
        .plugin(tauri_plugin_dialog::init())
        .on_page_load(|_webview, payload| {
            let event = match payload.event() {
                PageLoadEvent::Started => "started",
                PageLoadEvent::Finished => "finished",
            };

            crate::debug::action(
                &format!("webview.page-load:{event}"),
                json!({
                    "epochMs": epoch_ms(),
                    "url": payload.url(),
                }),
            );
        })
        .setup(|app| {
            let startup_started_at = Instant::now();
            crate::debug::action(
                "app.setup:start",
                json!({
                    "elapsedMs": 0,
                }),
            );

            let app_dir = app.path().app_data_dir()?;
            crate::debug::action(
                "app.setup:app-data-dir",
                json!({
                    "appDir": app_dir.to_string_lossy().to_string(),
                    "elapsedMs": startup_started_at.elapsed().as_millis(),
                }),
            );

            let document_dir = app.path().document_dir()?.join("Reader");
            crate::debug::action(
                "app.setup:document-dir",
                json!({
                    "documentDir": document_dir.to_string_lossy().to_string(),
                    "elapsedMs": startup_started_at.elapsed().as_millis(),
                }),
            );

            let paths = store::paths::StorePaths::new(app_dir, document_dir);
            paths.ensure_storage_dirs()?;
            crate::debug::action(
                "app.setup:storage-ready",
                json!({
                    "elapsedMs": startup_started_at.elapsed().as_millis(),
                }),
            );

            let normalization_cache = new_manifest_cache();
            let normalization_worker = NormalizationWorker::start(
                app.handle().clone(),
                paths,
                normalization_cache.clone(),
            );
            crate::debug::action(
                "app.setup:normalization-worker-ready",
                json!({
                    "elapsedMs": startup_started_at.elapsed().as_millis(),
                }),
            );

            app.manage(AppState {
                lock: Arc::new(Mutex::new(())),
                render_cache: Arc::new(Mutex::new(RenderCache::default())),
                in_flight_renders: Arc::new(Mutex::new(HashMap::new())),
                active_reader_generation: Arc::new(Mutex::new(None)),
                normalization_worker,
                normalization_cache,
            });
            crate::debug::action(
                "app.setup:finish",
                json!({
                    "elapsedMs": startup_started_at.elapsed().as_millis(),
                }),
            );
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_library_root,
            import_pdf,
            list_library,
            rescan_library,
            create_folder,
            move_document,
            rename_document,
            rename_folder,
            delete_folder,
            remove_from_library,
            open_document,
            save_document_state,
            get_or_create_note_for_book,
            save_note,
            log_note_debug_event,
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
