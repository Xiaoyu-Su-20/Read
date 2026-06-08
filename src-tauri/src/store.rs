use std::{
    collections::{HashMap, HashSet},
    fs,
    fs::File,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
};

use chrono::Utc;
use mupdf::{Colorspace, Document, Matrix, Pixmap};
use serde::Serialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    debug::process as debug_process,
    error::{AppError, AppResult},
    models::{
        DocumentAvailability, DocumentPayload, DocumentRecord, DocumentState, FolderRecord,
        FolderTreeNode, LibraryIndex, NoteBlock, NoteBlockType, NoteDocument, NoteIndex,
        NoteIndexEntry, NoteInlineNode, NotePageLinkNode, NoteTextNode,
        RenderedPagePayload, ROOT_FOLDER_ID,
    },
};

const RENDERER_VERSION: &str = "mupdf-v2";
const BASE_PDF_RENDER_SCALE: f32 = 1.0;
const JPEG_QUALITY: u32 = 82;
pub const MAX_RENDER_CACHE_ENTRIES: usize = 20;
const DEFAULT_COLLECTIONS: [&str; 3] = ["Collection 1", "Collection 2", "Collection 3"];
const DEFAULT_COLLECTION_ID: &str = "Collection 1";
const NOTE_DOCUMENT_VERSION: u32 = 2;

#[derive(Debug, Clone)]
pub struct PageRenderRequest {
    pub document_id: String,
    pub fingerprint: String,
    pub document_path: String,
    pub page_number: u32,
    pub zoom: f32,
    pub cache_key: String,
    pub image_path: PathBuf,
}

#[derive(Debug, Clone)]
struct RenderCacheEntry {
    cache_key: String,
    fingerprint: String,
    image_path: PathBuf,
    page_number: u32,
    width: u32,
    height: u32,
    access_order: u64,
}

#[derive(Debug, Default)]
pub struct RenderCache {
    entries: HashMap<String, RenderCacheEntry>,
    next_access_order: u64,
}

impl RenderCache {
    fn next_access_order(&mut self) -> u64 {
        self.next_access_order = self.next_access_order.saturating_add(1);
        self.next_access_order
    }

    pub fn get(&mut self, request: &PageRenderRequest) -> Option<RenderedPagePayload> {
        let next_access_order = self.next_access_order();
        let should_remove = match self.entries.get(&request.cache_key) {
            Some(entry) => {
                entry.fingerprint != request.fingerprint
                    || entry.image_path != request.image_path
                    || !entry.image_path.exists()
            }
            None => return None,
        };

        if should_remove {
            self.entries.remove(&request.cache_key);
            return None;
        }

        let entry = self.entries.get_mut(&request.cache_key)?;
        entry.access_order = next_access_order;
        Some(RenderedPagePayload {
            image_path: entry.image_path.to_string_lossy().to_string(),
            page_number: entry.page_number,
            width: entry.width,
            height: entry.height,
            cache_key: entry.cache_key.clone(),
        })
    }

    pub fn insert(
        &mut self,
        request: &PageRenderRequest,
        width: u32,
        height: u32,
    ) -> Vec<PathBuf> {
        let access_order = self.next_access_order();
        let mut paths_to_remove = Vec::new();

        if let Some(previous) = self.entries.insert(
            request.cache_key.clone(),
            RenderCacheEntry {
                cache_key: request.cache_key.clone(),
                fingerprint: request.fingerprint.clone(),
                image_path: request.image_path.clone(),
                page_number: request.page_number,
                width,
                height,
                access_order,
            },
        ) {
            if previous.image_path != request.image_path {
                paths_to_remove.push(previous.image_path);
            }
        }

        while self.entries.len() > MAX_RENDER_CACHE_ENTRIES {
            let oldest_key = self
                .entries
                .iter()
                .min_by_key(|(_, entry)| entry.access_order)
                .map(|(key, _)| key.clone());

            let Some(oldest_key) = oldest_key else {
                break;
            };

            if let Some(removed) = self.entries.remove(&oldest_key) {
                if removed.image_path != request.image_path {
                    paths_to_remove.push(removed.image_path);
                }
            }
        }

        paths_to_remove
    }
}

pub fn timestamp() -> String {
    Utc::now().to_rfc3339()
}

#[derive(Debug, Clone)]
struct DocumentRenderSource {
    document: DocumentRecord,
    path: PathBuf,
}

#[derive(Debug, Clone)]
pub struct LibraryStore {
    app_dir: PathBuf,
    library_dir: PathBuf,
    legacy_library_dir: PathBuf,
    index_path: PathBuf,
    notes_dir: PathBuf,
    notes_index_path: PathBuf,
    states_dir: PathBuf,
    rendered_pages_dir: PathBuf,
}

impl LibraryStore {
    pub fn new(app_dir: impl AsRef<Path>, library_dir: impl AsRef<Path>) -> Self {
        let app_dir = app_dir.as_ref().to_path_buf();
        let library_dir = library_dir.as_ref().to_path_buf();

        Self {
            library_dir,
            legacy_library_dir: app_dir.join("library"),
            index_path: app_dir.join("library-index.json"),
            notes_dir: app_dir.join("notes"),
            notes_index_path: app_dir.join("notes").join("index.json"),
            states_dir: app_dir.join("document-states"),
            rendered_pages_dir: app_dir.join("rendered-pages"),
            app_dir,
        }
    }

    pub fn ensure_ready(&self) -> AppResult<()> {
        fs::create_dir_all(&self.app_dir)?;
        fs::create_dir_all(&self.notes_dir)?;
        fs::create_dir_all(&self.states_dir)?;
        fs::create_dir_all(&self.rendered_pages_dir)?;

        if !self.index_path.exists() {
            self.save_index(&LibraryIndex::default())?;
        }

        if !self.notes_index_path.exists() {
            self.save_notes_index(&NoteIndex::default())?;
        }

        fs::create_dir_all(&self.library_dir)?;
        self.migrate_legacy_library_root_if_needed()?;
        self.ensure_default_library_structure()?;
        Ok(())
    }

    pub fn library_root_string(&self) -> AppResult<String> {
        self.ensure_ready()?;
        Ok(self.library_root_path().to_string_lossy().to_string())
    }

    pub fn list_library(&self) -> AppResult<FolderTreeNode> {
        self.ensure_ready()?;
        self.reconcile_library()?;

        let index = self.load_index()?;
        let root = self.library_root_path();
        self.build_tree(&root, &index)
    }

    pub fn rescan_library(&self) -> AppResult<FolderTreeNode> {
        self.ensure_ready()?;
        self.reconcile_library()?;

        let index = self.load_index()?;
        let root = self.library_root_path();
        self.build_tree(&root, &index)
    }

    pub fn create_folder(
        &self,
        name: &str,
        parent_id: Option<&str>,
    ) -> AppResult<FolderRecord> {
        self.ensure_ready()?;
        let trimmed = name.trim();
        self.validate_folder_name(trimmed)?;

        let parent_id = parent_id.unwrap_or(ROOT_FOLDER_ID);
        self.ensure_collection_parent(parent_id)?;

        let root = self.library_root_path();
        let parent_path = self.resolve_folder_path(&root, parent_id)?;
        fs::create_dir_all(&parent_path)?;

        let folder_path = parent_path.join(trimmed);
        if folder_path.exists() {
            return Err(AppError::InvalidInput(format!(
                "A folder named \"{trimmed}\" already exists."
            )));
        }

        fs::create_dir_all(&folder_path)?;
        let relative_path = self.relative_to_root(&root, &folder_path)?;
        Ok(self.folder_record_for_relative(&relative_path))
    }

    pub fn import_pdf(
        &self,
        source_path: &Path,
        destination_folder_id: Option<&str>,
    ) -> AppResult<DocumentRecord> {
        self.ensure_ready()?;

        if !source_path.exists() {
            return Err(AppError::InvalidInput(format!(
                "Source file does not exist: {}",
                source_path.display()
            )));
        }

        if !self.is_pdf_path(source_path) {
            return Err(AppError::InvalidInput(
                "Only PDF files can be imported.".to_string(),
            ));
        }

        let root = self.library_root_path();
        let destination_folder_id = destination_folder_id.ok_or_else(|| {
            AppError::InvalidInput("Choose a collection before importing a PDF.".to_string())
        })?;
        let destination_folder_path = self.resolve_collection_path(&root, destination_folder_id)?;
        fs::create_dir_all(&destination_folder_path)?;

        let file_name = source_path
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| AppError::InvalidInput("Invalid source file name.".to_string()))?;
        let destination_path = self.unique_pdf_path(&destination_folder_path, file_name);

        fs::copy(source_path, &destination_path)?;
        let relative_path = self.relative_to_root(&root, &destination_path)?;
        let fingerprint = self.hash_file(&destination_path)?;
        let document = DocumentRecord {
            id: Uuid::new_v4().to_string(),
            title: destination_path
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("Untitled PDF")
                .to_string(),
            file_name: destination_path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("document.pdf")
                .to_string(),
            folder_id: self.folder_id_from_relative_path(&relative_path),
            relative_path,
            fingerprint: fingerprint.clone(),
            imported_at: timestamp(),
            last_opened_at: None,
            availability: DocumentAvailability::Available,
        };

        let state = DocumentState::new(document.id.clone(), fingerprint);
        self.write_state(&state)?;

        let mut index = self.load_index()?;
        index.documents.push(document.clone());
        self.save_index(&index)?;
        Ok(document)
    }

    pub fn move_document(
        &self,
        document_id: &str,
        destination_folder_id: &str,
    ) -> AppResult<DocumentRecord> {
        self.ensure_ready()?;
        let mut index = self.load_index()?;
        let root = self.library_root_path();
        let document_index = Self::find_document_index(&index, document_id)?;
        let document = index.documents[document_index].clone();
        self.ensure_document_available(&document)?;

        let destination_folder_path = self.resolve_collection_path(&root, destination_folder_id)?;
        fs::create_dir_all(&destination_folder_path)?;

        let current_path = self.absolute_document_path(&root, &document);
        let destination_path = self.unique_pdf_path(&destination_folder_path, &document.file_name);
        self.move_file(&current_path, &destination_path)?;
        let relative_path = self.relative_to_root(&root, &destination_path)?;

        index.documents[document_index].folder_id = self.folder_id_from_relative_path(&relative_path);
        index.documents[document_index].relative_path = relative_path;
        index.documents[document_index].availability = DocumentAvailability::Available;
        self.save_index(&index)?;
        Ok(index.documents[document_index].clone())
    }

    pub fn rename_document(&self, document_id: &str, new_name: &str) -> AppResult<DocumentRecord> {
        self.ensure_ready()?;
        let mut index = self.load_index()?;
        let root = self.library_root_path();
        let document_index = Self::find_document_index(&index, document_id)?;
        let document = index.documents[document_index].clone();
        self.ensure_document_available(&document)?;

        let current_path = self.absolute_document_path(&root, &document);
        let parent = current_path
            .parent()
            .ok_or_else(|| AppError::InvalidInput("Unable to resolve the document folder.".to_string()))?;
        let normalized_name = self.normalize_pdf_file_name(new_name)?;

        if normalized_name.eq_ignore_ascii_case(&document.file_name) {
            return Ok(document);
        }

        let destination_path = self.unique_pdf_path(parent, &normalized_name);

        self.move_file(&current_path, &destination_path)?;

        let relative_path = self.relative_to_root(&root, &destination_path)?;
        index.documents[document_index].file_name = destination_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("document.pdf")
            .to_string();
        index.documents[document_index].title = destination_path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("Untitled PDF")
            .to_string();
        index.documents[document_index].relative_path = relative_path;
        index.documents[document_index].availability = DocumentAvailability::Available;
        self.save_index(&index)?;
        Ok(index.documents[document_index].clone())
    }

    pub fn rename_folder(&self, folder_id: &str, new_name: &str) -> AppResult<FolderRecord> {
        self.ensure_ready()?;

        if folder_id == ROOT_FOLDER_ID {
            return Err(AppError::InvalidInput(
                "The library root cannot be renamed.".to_string(),
            ));
        }
        self.ensure_collection_id(folder_id)?;

        let trimmed = new_name.trim();
        self.validate_folder_name(trimmed)?;

        let root = self.library_root_path();
        let current_path = self.resolve_folder_path(&root, folder_id)?;
        let parent = current_path
            .parent()
            .ok_or_else(|| AppError::InvalidInput("Unable to resolve the folder parent.".to_string()))?;
        let destination_path = parent.join(trimmed);

        if destination_path.exists() {
            return Err(AppError::InvalidInput(format!(
                "A folder named \"{trimmed}\" already exists."
            )));
        }

        fs::rename(current_path, &destination_path)?;
        let relative_path = self.relative_to_root(&root, &destination_path)?;
        let mut index = self.load_index()?;
        self.rename_folder_documents(&mut index, folder_id, &relative_path);
        self.save_index(&index)?;
        Ok(self.folder_record_for_relative(&relative_path))
    }

    pub fn remove_from_library(
        &self,
        document_id: &str,
        destination_directory: &Path,
    ) -> AppResult<DocumentRecord> {
        self.ensure_ready()?;
        let mut index = self.load_index()?;
        fs::create_dir_all(destination_directory)?;
        let destination_directory = fs::canonicalize(destination_directory)?;
        let root = self.library_root_path();
        let canonical_root = fs::canonicalize(&root)?;

        if destination_directory.starts_with(&canonical_root) {
            return Err(AppError::InvalidInput(
                "Choose a destination outside the library folder.".to_string(),
            ));
        }

        let document_index = Self::find_document_index(&index, document_id)?;
        let document = index.documents[document_index].clone();
        self.ensure_document_available(&document)?;

        let source_path = self.absolute_document_path(&root, &document);
        let destination_path = self.unique_pdf_path(&destination_directory, &document.file_name);
        self.move_file(&source_path, &destination_path)?;

        index.documents[document_index].availability = DocumentAvailability::Missing;
        self.save_index(&index)?;
        Ok(index.documents[document_index].clone())
    }

    pub fn open_document(&self, document_id: &str) -> AppResult<DocumentPayload> {
        self.ensure_ready()?;

        let mut index = self.load_index()?;
        let document_index = Self::find_document_index(&index, document_id)?;

        let document = index.documents[document_index].clone();
        self.ensure_document_available(&document)?;

        let root = self.library_root_path();
        let file_path = self.absolute_document_path(&root, &document);
        if !file_path.exists() {
            return Err(AppError::InvalidInput(format!(
                "This PDF is currently unavailable: {}",
                document.relative_path
            )));
        }

        let page_count = self.document_page_count(&file_path)?;

        let mut state = self.read_state(&document)?;
        state.last_opened_at = Some(timestamp());
        self.write_state(&state)?;

        index.documents[document_index].last_opened_at = state.last_opened_at.clone();
        index.last_opened_document_id = Some(document.id.clone());
        self.save_index(&index)?;

        Ok(DocumentPayload {
            document: index.documents[document_index].clone(),
            state,
            file_path: file_path.to_string_lossy().to_string(),
            page_count,
        })
    }

    pub fn save_document_state(
        &self,
        document_id: &str,
        mut state: DocumentState,
    ) -> AppResult<()> {
        let process = debug_process(
            "store.save_document_state",
            json!({
                "documentId": document_id,
                "page": state.last_page,
                "zoom": state.zoom,
            }),
        );

        let result = (|| -> AppResult<()> {
            self.ensure_ready()?;
            process.checkpoint("ensure-ready", json!({}));

            let index = self.load_index()?;
            process.checkpoint("load-index", json!({}));
            let document_index = Self::find_document_index(&index, document_id)?;
            let document = index.documents[document_index].clone();

            if state.document_id != document.id {
                return Err(AppError::InvalidInput(
                    "Reader state document id does not match the target document.".to_string(),
                ));
            }

            state.fingerprint = document.fingerprint.clone();
            state.last_opened_at = Some(timestamp());
            self.write_state(&state)?;
            process.checkpoint("write-state", json!({}));
            process.checkpoint("skip-catalog-save", json!({}));
            Ok(())
        })();

        match &result {
            Ok(_) => process.finish(json!({})),
            Err(error) => process.fail(&error.to_string(), json!({})),
        }

        result
    }

    pub fn get_or_create_note_for_book(&self, document_id: &str) -> AppResult<NoteDocument> {
        self.ensure_ready()?;
        let document = self.find_document_by_id(document_id)?;
        let index = self.load_notes_index()?;

        let mut matching_entries = index
            .notes
            .iter()
            .filter(|entry| entry.book_id.as_deref() == Some(document_id))
            .cloned()
            .collect::<Vec<_>>();
        matching_entries.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));

        for entry in matching_entries {
            if let Ok(note) = self.load_note_document(&entry.id) {
                return Ok(note);
            }
        }

        let created_at = timestamp();
        let note = NoteDocument {
            id: Uuid::new_v4().to_string(),
            title: document.title,
            book_id: Some(document_id.to_string()),
            created_at: created_at.clone(),
            updated_at: created_at,
            version: NOTE_DOCUMENT_VERSION,
            blocks: vec![self.empty_note_block()],
        };

        self.save_note(note)
    }

    pub fn save_note(&self, mut note: NoteDocument) -> AppResult<NoteDocument> {
        self.ensure_ready()?;

        if let Some(book_id) = note.book_id.as_deref() {
            let _ = self.find_document_by_id(book_id)?;
        }

        self.normalize_note_document(&mut note);
        note.updated_at = timestamp();
        if note.created_at.trim().is_empty() {
            note.created_at = note.updated_at.clone();
        }

        self.write_json_atomically(&self.note_path(&note.id), &note)?;

        let mut index = self.load_notes_index()?;
        let metadata = self.note_index_entry(&note);
        if let Some(existing) = index.notes.iter_mut().find(|entry| entry.id == note.id) {
            *existing = metadata;
        } else {
            index.notes.push(metadata);
        }
        self.save_notes_index(&index)?;

        Ok(note)
    }

    pub fn list_recent_documents(&self) -> AppResult<Vec<DocumentRecord>> {
        self.ensure_ready()?;
        let mut index = self.load_index()?;

        for document in &mut index.documents {
            if let Ok(state) = self.read_state(document) {
                document.last_opened_at = state.last_opened_at.clone();
            }
        }

        index.documents.sort_by(|left, right| {
            (right.last_opened_at.as_deref().unwrap_or(""))
                .cmp(left.last_opened_at.as_deref().unwrap_or(""))
        });

        Ok(index.documents)
    }

    pub fn document_path_string(&self, document_id: &str) -> AppResult<String> {
        self.ensure_ready()?;

        let document = self.find_document_by_id(document_id)?;
        self.ensure_document_available(&document)?;
        let root = self.library_root_path();
        let path = self.absolute_document_path(&root, &document);
        if !path.exists() {
            return Err(AppError::InvalidInput(format!(
                "This PDF is currently unavailable: {}",
                document.relative_path
            )));
        }
        Ok(path.to_string_lossy().to_string())
    }

    pub fn folder_path_string(&self, folder_id: Option<&str>) -> AppResult<String> {
        self.ensure_ready()?;
        let root = self.library_root_path();
        let folder_path = self.resolve_folder_path(&root, folder_id.unwrap_or(ROOT_FOLDER_ID))?;
        Ok(folder_path.to_string_lossy().to_string())
    }

    pub fn read_document_bytes(&self, document_id: &str) -> AppResult<Vec<u8>> {
        self.ensure_ready()?;

        let document = self.find_document_by_id(document_id)?;
        self.ensure_document_available(&document)?;
        let root = self.library_root_path();
        let path = self.absolute_document_path(&root, &document);
        if !path.exists() {
            return Err(AppError::InvalidInput(format!(
                "This PDF is currently unavailable: {}",
                document.relative_path
            )));
        }
        Ok(fs::read(path)?)
    }

    pub fn prepare_render_request(
        &self,
        document_id: &str,
        page_number: u32,
        zoom: f32,
    ) -> AppResult<PageRenderRequest> {
        self.ensure_ready()?;

        if page_number == 0 {
            return Err(AppError::InvalidInput(
                "Page numbers must be 1-based.".to_string(),
            ));
        }

        if zoom <= 0.0 {
            return Err(AppError::InvalidInput(
                "Zoom must be greater than zero.".to_string(),
            ));
        }

        let source = self.document_render_source(document_id)?;
        let document_path = source.path.to_string_lossy().to_string();
        let cache_key = self.render_cache_key(&source.document.id, page_number, zoom);
        let image_path = self.render_output_path(
            &source.document.id,
            &source.document.fingerprint,
            page_number,
            zoom,
        );

        Ok(PageRenderRequest {
            document_id: source.document.id,
            fingerprint: source.document.fingerprint,
            document_path,
            page_number,
            zoom,
            cache_key,
            image_path,
        })
    }

    #[cfg(test)]
    pub fn render_pdf_page(
        &self,
        document_id: &str,
        page_number: u32,
        zoom: f32,
        render_cache: Arc<Mutex<RenderCache>>,
    ) -> AppResult<RenderedPagePayload> {
        let request = self.prepare_render_request(document_id, page_number, zoom)?;
        Self::render_pdf_page_blocking(request, render_cache)
    }

    pub fn render_pdf_page_blocking(
        request: PageRenderRequest,
        render_cache: Arc<Mutex<RenderCache>>,
    ) -> AppResult<RenderedPagePayload> {
        let process = debug_process(
            "store.render_pdf_page_blocking",
            json!({
                "cacheKey": request.cache_key,
                "documentId": request.document_id,
                "imagePath": request.image_path.to_string_lossy().to_string(),
                "page": request.page_number,
                "zoom": request.zoom,
            }),
        );

        let result = (|| -> AppResult<RenderedPagePayload> {
            if let Some(cached) = Self::render_cache_lookup(&render_cache, &request)? {
                process.checkpoint(
                    "cache-hit",
                    json!({
                        "height": cached.height,
                        "width": cached.width,
                    }),
                );
                return Ok(cached);
            }
            process.checkpoint("cache-miss", json!({}));

            let document = Document::open(&request.document_path).map_err(|error| {
                AppError::Render(format!("Unable to open PDF with MuPDF: {error}"))
            })?;

            let page_count = document
                .page_count()
                .map_err(|error| AppError::Render(format!("Unable to inspect PDF pages: {error}")))?;
            if request.page_number > page_count as u32 {
                return Err(AppError::InvalidInput(format!(
                    "Page {} is out of bounds for this document.",
                    request.page_number
                )));
            }
            process.checkpoint(
                "render-started",
                json!({
                    "pageCount": page_count,
                    "scale": BASE_PDF_RENDER_SCALE * request.zoom,
                }),
            );

            let page = document.load_page((request.page_number - 1) as i32).map_err(|error| {
                AppError::Render(format!(
                    "Unable to load page {} with MuPDF: {error}",
                    request.page_number
                ))
            })?;
            let render_scale = BASE_PDF_RENDER_SCALE * request.zoom;
            let matrix = Matrix::new_scale(render_scale, render_scale);
            let logical_rect = page
                .bounds()
                .map_err(|error| {
                    AppError::Render(format!("Unable to measure page bounds: {error}"))
                })?
                .transform(&matrix)
                .round();
            let width = logical_rect.width().max(1) as u32;
            let height = logical_rect.height().max(1) as u32;
            let colorspace = Colorspace::device_rgb();
            let pixmap = page
                .to_pixmap(&matrix, &colorspace, false, true)
                .map_err(|error| {
                    AppError::Render(format!(
                        "Unable to render page {} with MuPDF: {error}",
                        request.page_number
                    ))
                })?;
            process.checkpoint(
                "render-finished",
                json!({
                    "height": height,
                    "width": width,
                }),
            );

            write_pixmap_as_jpeg(&request.image_path, &pixmap, JPEG_QUALITY).map_err(|error| {
                AppError::Render(format!(
                    "Unable to write JPEG for page {}: {error}",
                    request.page_number
                ))
            })?;
            process.checkpoint(
                "image-written",
                json!({
                    "jpegQuality": JPEG_QUALITY,
                }),
            );

            let evicted_paths = Self::render_cache_store(&render_cache, &request, width, height)?;
            for path in evicted_paths {
                if path != request.image_path {
                    let _ = fs::remove_file(path);
                }
            }

            Ok(RenderedPagePayload {
                image_path: request.image_path.to_string_lossy().to_string(),
                page_number: request.page_number,
                width,
                height,
                cache_key: request.cache_key.clone(),
            })
        })();

        match &result {
            Ok(payload) => process.finish(json!({
                "cacheKey": payload.cache_key,
                "height": payload.height,
                "pageNumber": payload.page_number,
                "width": payload.width,
            })),
            Err(error) => process.fail(&error.to_string(), json!({})),
        }

        result
    }

    fn reconcile_library(&self) -> AppResult<()> {
        let root = self.library_root_path();
        let process = debug_process(
            "store.reconcile_library",
            json!({
                "root": root.to_string_lossy().to_string(),
            }),
        );

        let result = (|| -> AppResult<()> {
            let mut index = self.load_index()?;
            let previous_index = index.clone();
            self.ensure_default_library_structure()?;
            let migrated_root_pdfs = self.migrate_root_pdfs_into_default_collection(&root)?;
            let collection_paths = self.collection_paths(&root)?;
            let mut pdf_paths = Vec::new();

            for collection_path in &collection_paths {
                pdf_paths.extend(self.collect_immediate_pdf_paths(collection_path)?);
            }
            process.checkpoint(
                "scan-complete",
                json!({
                    "collectionCount": collection_paths.len(),
                    "migratedRootPdfCount": migrated_root_pdfs,
                    "pdfCount": pdf_paths.len(),
                }),
            );

            let existing_documents = index.documents.clone();
            let mut matched_ids = HashSet::new();
            let mut next_documents =
                Vec::with_capacity(existing_documents.len().max(pdf_paths.len()));

            for pdf_path in pdf_paths {
                let relative_path = self.relative_to_root(&root, &pdf_path)?;
                let fingerprint = self.hash_file(&pdf_path)?;

                let existing = self.match_existing_document(
                    &existing_documents,
                    &matched_ids,
                    &relative_path,
                    &fingerprint,
                    None,
                );

                let existing_id = existing.as_ref().map(|document| document.id.clone());
                let document_id = existing_id
                    .unwrap_or_else(|| Uuid::new_v4().to_string());

                let file_name = pdf_path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or("document.pdf")
                    .to_string();
                let title = pdf_path
                    .file_stem()
                    .and_then(|value| value.to_str())
                    .unwrap_or("Untitled PDF")
                    .to_string();

                let previous_document_id = existing.as_ref().map(|document| document.id.clone());
                let mut document = existing.unwrap_or(DocumentRecord {
                    id: document_id.clone(),
                    title: title.clone(),
                    file_name: file_name.clone(),
                    folder_id: self.folder_id_from_relative_path(&relative_path),
                    relative_path: relative_path.clone(),
                    fingerprint: fingerprint.clone(),
                    imported_at: timestamp(),
                    last_opened_at: None,
                    availability: DocumentAvailability::Available,
                });

                document.id = document_id.clone();
                document.title = title;
                document.file_name = file_name;
                document.folder_id = self.folder_id_from_relative_path(&relative_path);
                document.relative_path = relative_path;
                document.fingerprint = fingerprint;
                document.availability = DocumentAvailability::Available;

                let private_state = self
                    .read_state_file(&self.state_path(&document.id))
                    .ok()
                    .or_else(|| {
                        previous_document_id
                            .as_ref()
                            .and_then(|id| self.read_state_file(&self.state_path(id)).ok())
                    });
                let merged_state = self.merge_states(&document, private_state);
                document.last_opened_at = merged_state.last_opened_at.clone();
                self.write_state(&merged_state)?;

                if let Some(previous_document_id) = previous_document_id {
                    if previous_document_id != document.id {
                        let previous_state_path = self.state_path(&previous_document_id);
                        if previous_state_path.exists() {
                            fs::remove_file(previous_state_path)?;
                        }
                    }
                }

                matched_ids.insert(document.id.clone());
                next_documents.push(document);
            }

            for mut document in existing_documents {
                if matched_ids.contains(&document.id) {
                    continue;
                }

                let private_state = self.read_state_file(&self.state_path(&document.id)).ok();
                let merged_state = self.merge_states(&document, private_state);
                document.last_opened_at = merged_state.last_opened_at.clone();
                document.availability = DocumentAvailability::Missing;
                self.write_state(&merged_state)?;
                next_documents.push(document);
            }

            index.documents = next_documents;
            if index != previous_index {
                self.save_index(&index)?;
                process.checkpoint(
                    "save-index",
                    json!({
                        "documentCount": index.documents.len(),
                    }),
                );
            } else {
                process.checkpoint(
                    "skip-save-index",
                    json!({
                        "documentCount": index.documents.len(),
                    }),
                );
            }
            Ok(())
        })();

        match &result {
            Ok(_) => process.finish(json!({})),
            Err(error) => process.fail(&error.to_string(), json!({})),
        }

        result
    }

    fn merge_states(
        &self,
        document: &DocumentRecord,
        private_state: Option<DocumentState>,
    ) -> DocumentState {
        let selected =
            private_state.unwrap_or_else(|| DocumentState::new(document.id.clone(), document.fingerprint.clone()));

        let mut state = selected;
        state.document_id = document.id.clone();
        state.fingerprint = document.fingerprint.clone();
        state.last_page = state.last_page.max(1);
        if state.zoom <= 0.0 {
            state.zoom = 1.0;
        }
        state
    }

    fn match_existing_document(
        &self,
        documents: &[DocumentRecord],
        matched_ids: &HashSet<String>,
        relative_path: &str,
        fingerprint: &str,
        legacy_state: Option<&DocumentState>,
    ) -> Option<DocumentRecord> {
        documents
            .iter()
            .find(|document| {
                !matched_ids.contains(&document.id) && document.relative_path == relative_path
            })
            .cloned()
            .or_else(|| {
                legacy_state.and_then(|state| {
                    documents
                        .iter()
                        .find(|document| {
                            !matched_ids.contains(&document.id) && document.id == state.document_id
                        })
                        .cloned()
                })
            })
            .or_else(|| {
                documents
                    .iter()
                    .find(|document| {
                        !matched_ids.contains(&document.id) && document.fingerprint == fingerprint
                    })
                    .cloned()
            })
    }

    fn library_root_path(&self) -> PathBuf {
        self.library_dir.clone()
    }

    fn migrate_legacy_library_root_if_needed(&self) -> AppResult<()> {
        if self.library_dir == self.legacy_library_dir || !self.legacy_library_dir.exists() {
            return Ok(());
        }

        if !self.directory_is_empty(&self.library_dir)? || self.directory_is_empty(&self.legacy_library_dir)? {
            return Ok(());
        }

        let entries = fs::read_dir(&self.legacy_library_dir)?.collect::<Result<Vec<_>, _>>()?;
        for entry in entries {
            let source = entry.path();
            let destination = self.library_dir.join(entry.file_name());
            self.move_path(&source, &destination)?;
        }

        Ok(())
    }

    fn ensure_default_library_structure(&self) -> AppResult<()> {
        if self.collection_paths(&self.library_dir)?.is_empty() {
            for folder_name in DEFAULT_COLLECTIONS {
                fs::create_dir_all(self.library_dir.join(folder_name))?;
            }
        }

        Ok(())
    }

    fn load_index(&self) -> AppResult<LibraryIndex> {
        self.ensure_ready()?;
        let raw = fs::read_to_string(&self.index_path)?;
        Ok(serde_json::from_str(&raw)?)
    }

    fn save_index(&self, index: &LibraryIndex) -> AppResult<()> {
        let process = debug_process(
            "store.save_index",
            json!({
                "documentCount": index.documents.len(),
                "indexPath": self.index_path.to_string_lossy().to_string(),
                "lastOpenedDocumentId": index.last_opened_document_id,
            }),
        );

        let result = (|| -> AppResult<()> {
            let raw = serde_json::to_string_pretty(index)?;
            process.checkpoint(
                "serialize-complete",
                json!({
                    "byteCount": raw.len(),
                }),
            );
            fs::write(&self.index_path, &raw)?;
            process.checkpoint(
                "write-complete",
                json!({
                    "byteCount": raw.len(),
                }),
            );
            Ok(())
        })();

        match &result {
            Ok(_) => process.finish(json!({})),
            Err(error) => process.fail(&error.to_string(), json!({})),
        }

        result
    }

    fn load_notes_index(&self) -> AppResult<NoteIndex> {
        self.ensure_ready()?;
        let raw = fs::read_to_string(&self.notes_index_path)?;
        Ok(serde_json::from_str(&raw)?)
    }

    fn save_notes_index(&self, index: &NoteIndex) -> AppResult<()> {
        self.write_json_atomically(&self.notes_index_path, index)
    }

    fn build_tree(&self, root: &Path, index: &LibraryIndex) -> AppResult<FolderTreeNode> {
        let mut folders = Vec::new();
        for collection_path in self.collection_paths(root)? {
            let relative_path = self.relative_to_root(root, &collection_path)?;
            folders.push(self.build_collection_node(&relative_path, index));
        }

        folders.sort_by(|left, right| left.folder.name.cmp(&right.folder.name));

        Ok(FolderTreeNode {
            folder: self.folder_record_for_relative(""),
            folders,
            documents: Vec::new(),
        })
    }

    fn build_collection_node(&self, relative_path: &str, index: &LibraryIndex) -> FolderTreeNode {
        let mut documents = index
            .documents
            .iter()
            .filter(|document| {
                document.availability == DocumentAvailability::Available
                    && document.folder_id == relative_path
            })
            .cloned()
            .collect::<Vec<_>>();
        documents.sort_by(|left, right| left.title.cmp(&right.title));

        FolderTreeNode {
            folder: self.folder_record_for_relative(relative_path),
            folders: Vec::new(),
            documents,
        }
    }

    fn folder_record_for_relative(&self, relative_path: &str) -> FolderRecord {
        if relative_path.is_empty() {
            return FolderRecord {
                id: ROOT_FOLDER_ID.to_string(),
                name: "Library".to_string(),
                parent_id: None,
                created_at: None,
            };
        }

        let path = Path::new(relative_path);
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("Folder")
            .to_string();
        let parent_id = path.parent().and_then(|parent| {
            if parent.as_os_str().is_empty() {
                Some(ROOT_FOLDER_ID.to_string())
            } else {
                Some(parent.to_string_lossy().replace('\\', "/"))
            }
        });

        FolderRecord {
            id: relative_path.to_string(),
            name,
            parent_id,
            created_at: None,
        }
    }

    fn find_document_by_id(&self, document_id: &str) -> AppResult<DocumentRecord> {
        let index = self.load_index()?;
        index
            .documents
            .into_iter()
            .find(|document| document.id == document_id)
            .ok_or_else(|| AppError::DocumentNotFound(document_id.to_string()))
    }

    fn find_document_index(index: &LibraryIndex, document_id: &str) -> AppResult<usize> {
        index
            .documents
            .iter()
            .position(|document| document.id == document_id)
            .ok_or_else(|| AppError::DocumentNotFound(document_id.to_string()))
    }

    fn ensure_document_available(&self, document: &DocumentRecord) -> AppResult<()> {
        if document.availability == DocumentAvailability::Missing {
            return Err(AppError::InvalidInput(format!(
                "This PDF is currently unavailable: {}",
                document.relative_path
            )));
        }

        Ok(())
    }

    fn resolve_folder_path(&self, root: &Path, folder_id: &str) -> AppResult<PathBuf> {
        if folder_id == ROOT_FOLDER_ID {
            return Ok(root.to_path_buf());
        }

        self.validate_relative_path(folder_id)?;
        Ok(root.join(folder_id))
    }

    fn resolve_collection_path(&self, root: &Path, folder_id: &str) -> AppResult<PathBuf> {
        self.ensure_collection_id(folder_id)?;
        self.resolve_folder_path(root, folder_id)
    }

    fn absolute_document_path(&self, root: &Path, document: &DocumentRecord) -> PathBuf {
        root.join(&document.relative_path)
    }

    fn document_render_source(&self, document_id: &str) -> AppResult<DocumentRenderSource> {
        let index = self.load_index()?;
        let document = index
            .documents
            .into_iter()
            .find(|document| document.id == document_id)
            .ok_or_else(|| AppError::DocumentNotFound(document_id.to_string()))?;
        self.ensure_document_available(&document)?;

        let root = self.library_root_path();
        let path = self.absolute_document_path(&root, &document);
        if !path.exists() {
            return Err(AppError::InvalidInput(format!(
                "This PDF is currently unavailable: {}",
                document.relative_path
            )));
        }

        Ok(DocumentRenderSource { document, path })
    }

    fn folder_id_from_relative_path(&self, relative_path: &str) -> String {
        Path::new(relative_path)
            .parent()
            .and_then(|parent| {
                if parent.as_os_str().is_empty() {
                    None
                } else {
                    Some(parent.to_string_lossy().replace('\\', "/"))
                }
            })
            .unwrap_or_else(|| ROOT_FOLDER_ID.to_string())
    }

    fn rename_folder_documents(
        &self,
        index: &mut LibraryIndex,
        old_folder_id: &str,
        new_folder_id: &str,
    ) {
        let old_prefix = format!("{old_folder_id}/");
        let new_prefix = format!("{new_folder_id}/");

        for document in &mut index.documents {
            if document.folder_id == old_folder_id {
                document.folder_id = new_folder_id.to_string();
            } else if document.folder_id.starts_with(&old_prefix) {
                document.folder_id = format!(
                    "{}{}",
                    new_prefix,
                    document.folder_id.trim_start_matches(&old_prefix)
                );
            }

            if document.relative_path.starts_with(&old_prefix) {
                document.relative_path = format!(
                    "{}{}",
                    new_prefix,
                    document.relative_path.trim_start_matches(&old_prefix)
                );
            }
        }
    }

    fn ensure_collection_parent(&self, folder_id: &str) -> AppResult<()> {
        if folder_id == ROOT_FOLDER_ID {
            return Ok(());
        }

        Err(AppError::InvalidInput(
            "Collections can only be created at the library root.".to_string(),
        ))
    }

    fn ensure_collection_id(&self, folder_id: &str) -> AppResult<()> {
        if folder_id == ROOT_FOLDER_ID {
            return Err(AppError::InvalidInput(
                "Select a collection instead of the library root.".to_string(),
            ));
        }

        self.validate_relative_path(folder_id)?;
        if folder_id.contains('/') || folder_id.contains('\\') {
            return Err(AppError::InvalidInput(
                "Collections must be root-level folders.".to_string(),
            ));
        }

        Ok(())
    }

    fn collection_paths(&self, root: &Path) -> AppResult<Vec<PathBuf>> {
        let mut collections = fs::read_dir(root)?
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .map(|entry| entry.path())
            .filter(|path| path.is_dir())
            .collect::<Vec<_>>();
        collections.sort();
        Ok(collections)
    }

    fn migrate_root_pdfs_into_default_collection(&self, root: &Path) -> AppResult<usize> {
        let destination_directory = root.join(DEFAULT_COLLECTION_ID);
        fs::create_dir_all(&destination_directory)?;
        let pdf_paths = self.collect_immediate_pdf_paths(root)?;
        let mut migrated = 0;

        for pdf_path in pdf_paths {
            let file_name = pdf_path
                .file_name()
                .and_then(|value| value.to_str())
                .ok_or_else(|| AppError::InvalidInput("Invalid PDF file name.".to_string()))?;
            let destination_path = self.unique_pdf_path(&destination_directory, file_name);
            self.move_file(&pdf_path, &destination_path)?;

            migrated += 1;
        }

        Ok(migrated)
    }

    fn collect_immediate_pdf_paths(&self, directory: &Path) -> AppResult<Vec<PathBuf>> {
        self.collect_immediate_matching_paths(directory, |path| self.is_pdf_path(path))
    }

    fn collect_immediate_matching_paths(
        &self,
        directory: &Path,
        matches: impl Fn(&Path) -> bool + Copy,
    ) -> AppResult<Vec<PathBuf>> {
        let mut results = Vec::new();
        let mut entries = fs::read_dir(directory)?.collect::<Result<Vec<_>, _>>()?;
        entries.sort_by_key(|entry| entry.file_name());

        for entry in entries {
            let path = entry.path();
            if path.is_file() && matches(&path) {
                results.push(path);
            }
        }

        Ok(results)
    }

    fn move_file(&self, source: &Path, destination: &Path) -> AppResult<()> {
        match fs::rename(source, destination) {
            Ok(()) => Ok(()),
            Err(_) => {
                fs::copy(source, destination)?;
                fs::remove_file(source)?;
                Ok(())
            }
        }
    }

    fn move_path(&self, source: &Path, destination: &Path) -> AppResult<()> {
        match fs::rename(source, destination) {
            Ok(()) => Ok(()),
            Err(_) => {
                if source.is_dir() {
                    fs::create_dir_all(destination)?;
                    let entries = fs::read_dir(source)?.collect::<Result<Vec<_>, _>>()?;
                    for entry in entries {
                        let child_source = entry.path();
                        let child_destination = destination.join(entry.file_name());
                        self.move_path(&child_source, &child_destination)?;
                    }
                    fs::remove_dir(source)?;
                    Ok(())
                } else {
                    self.move_file(source, destination)
                }
            }
        }
    }

    fn directory_is_empty(&self, directory: &Path) -> AppResult<bool> {
        Ok(fs::read_dir(directory)?.next().is_none())
    }

    fn is_pdf_path(&self, path: &Path) -> bool {
        path.extension()
            .and_then(|value| value.to_str())
            .map(|value| value.eq_ignore_ascii_case("pdf"))
            == Some(true)
    }

    fn unique_pdf_path(&self, directory: &Path, original_name: &str) -> PathBuf {
        let stem = Path::new(original_name)
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("document");
        let extension = Path::new(original_name)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("pdf");

        let mut counter = 1;
        loop {
            let candidate_name = if counter == 1 {
                format!("{stem}.{extension}")
            } else {
                format!("{stem} ({counter}).{extension}")
            };
            let candidate_path = directory.join(candidate_name);
            if !candidate_path.exists() {
                return candidate_path;
            }
            counter += 1;
        }
    }

    fn normalize_pdf_file_name(&self, value: &str) -> AppResult<String> {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return Err(AppError::InvalidInput("File name cannot be empty.".to_string()));
        }
        if trimmed.contains('/') || trimmed.contains('\\') {
            return Err(AppError::InvalidInput(
                "File names cannot include path separators.".to_string(),
            ));
        }

        if trimmed.to_ascii_lowercase().ends_with(".pdf") {
            Ok(trimmed.to_string())
        } else {
            Ok(format!("{trimmed}.pdf"))
        }
    }

    fn validate_folder_name(&self, value: &str) -> AppResult<()> {
        if value.is_empty() {
            return Err(AppError::InvalidInput("Folder name cannot be empty.".to_string()));
        }
        if value.contains('/') || value.contains('\\') {
            return Err(AppError::InvalidInput(
                "Folder names cannot include path separators.".to_string(),
            ));
        }
        Ok(())
    }

    fn validate_relative_path(&self, value: &str) -> AppResult<()> {
        let path = Path::new(value);
        if path.is_absolute() {
            return Err(AppError::InvalidInput("Expected a relative library path.".to_string()));
        }

        for component in path.components() {
            match component {
                Component::Normal(_) => {}
                _ => {
                    return Err(AppError::InvalidInput(
                        "Invalid library path.".to_string(),
                    ))
                }
            }
        }

        Ok(())
    }

    fn hash_file(&self, path: &Path) -> AppResult<String> {
        let mut file = File::open(path)?;
        let mut buffer = [0u8; 8192];
        let mut hasher = Sha256::new();

        loop {
            let bytes_read = file.read(&mut buffer)?;
            if bytes_read == 0 {
                break;
            }
            hasher.update(&buffer[..bytes_read]);
        }

        Ok(format!("{:x}", hasher.finalize()))
    }

    fn document_page_count(&self, path: &Path) -> AppResult<u32> {
        let document_path = path.to_string_lossy().into_owned();
        let document = Document::open(&document_path)
            .map_err(|error| AppError::Render(format!("Unable to open PDF with MuPDF: {error}")))?;
        let page_count = document
            .page_count()
            .map_err(|error| AppError::Render(format!("Unable to inspect PDF pages: {error}")))?;
        Ok(page_count.max(1) as u32)
    }

    fn render_cache_key(&self, document_id: &str, page_number: u32, zoom: f32) -> String {
        format!("{document_id}:{page_number}:{zoom:.2}")
    }

    fn render_output_path(
        &self,
        document_id: &str,
        fingerprint: &str,
        page_number: u32,
        zoom: f32,
    ) -> PathBuf {
        let digest = Sha256::digest(
            format!("{RENDERER_VERSION}:{document_id}:{fingerprint}:{page_number}:{zoom:.2}")
                .as_bytes(),
        );
        self.rendered_pages_dir.join(format!(
            "{RENDERER_VERSION}-{}-p{page_number}-z{:.2}.jpg",
            &format!("{digest:x}")[..16]
            ,
            zoom
        ))
    }

    fn render_cache_lookup(
        render_cache: &Arc<Mutex<RenderCache>>,
        request: &PageRenderRequest,
    ) -> AppResult<Option<RenderedPagePayload>> {
        let mut cache = render_cache
            .lock()
            .map_err(|_| AppError::Render("Unable to lock render cache.".to_string()))?;
        Ok(cache.get(request))
    }

    fn render_cache_store(
        render_cache: &Arc<Mutex<RenderCache>>,
        request: &PageRenderRequest,
        width: u32,
        height: u32,
    ) -> AppResult<Vec<PathBuf>> {
        let mut cache = render_cache
            .lock()
            .map_err(|_| AppError::Render("Unable to lock render cache.".to_string()))?;
        Ok(cache.insert(request, width, height))
    }

    fn relative_to_root(&self, root: &Path, full_path: &Path) -> AppResult<String> {
        Ok(full_path
            .strip_prefix(root)?
            .to_string_lossy()
            .replace('\\', "/"))
    }

    fn state_path(&self, document_id: &str) -> PathBuf {
        self.states_dir.join(format!("{document_id}.json"))
    }

    fn note_path(&self, note_id: &str) -> PathBuf {
        self.notes_dir.join(format!("{note_id}.json"))
    }

    fn read_state(&self, document: &DocumentRecord) -> AppResult<DocumentState> {
        let state_path = self.state_path(&document.id);
        if state_path.exists() {
            let mut state = self.read_state_file(&state_path)?;
            state.document_id = document.id.clone();
            state.fingerprint = document.fingerprint.clone();
            return Ok(state);
        }

        let state = DocumentState::new(document.id.clone(), document.fingerprint.clone());
        self.write_state(&state)?;
        Ok(state)
    }

    fn read_state_file(&self, path: &Path) -> AppResult<DocumentState> {
        let raw = fs::read_to_string(path)?;
        Ok(serde_json::from_str(&raw)?)
    }

    fn write_state(&self, state: &DocumentState) -> AppResult<()> {
        let raw = serde_json::to_string_pretty(state)?;
        let mut file = File::create(self.state_path(&state.document_id))?;
        file.write_all(raw.as_bytes())?;
        Ok(())
    }

    fn load_note_document(&self, note_id: &str) -> AppResult<NoteDocument> {
        let raw = fs::read_to_string(self.note_path(note_id))?;
        let mut note: NoteDocument = serde_json::from_str(&raw)?;
        self.normalize_note_document(&mut note);
        Ok(note)
    }

    fn note_index_entry(&self, note: &NoteDocument) -> NoteIndexEntry {
        NoteIndexEntry {
            id: note.id.clone(),
            title: note.title.clone(),
            book_id: note.book_id.clone(),
            created_at: note.created_at.clone(),
            updated_at: note.updated_at.clone(),
            excerpt: self.note_excerpt(note),
        }
    }

    fn note_excerpt(&self, note: &NoteDocument) -> String {
        let mut excerpt = note
            .blocks
            .iter()
            .flat_map(|block| block.children.iter())
            .map(|child| match child {
                NoteInlineNode::Text(text) => text.text.trim(),
                NoteInlineNode::PageLink(page_link) => page_link.text.trim(),
            })
            .filter(|text| !text.is_empty())
            .collect::<Vec<_>>()
            .join(" ");

        if excerpt.len() > 160 {
            excerpt.truncate(160);
            excerpt.push_str("...");
        }

        excerpt
    }

    fn normalize_note_document(&self, note: &mut NoteDocument) {
        if note.version < NOTE_DOCUMENT_VERSION {
            note.version = NOTE_DOCUMENT_VERSION;
        }

        if note.title.trim().is_empty() {
            note.title = "Untitled note".to_string();
        } else {
            note.title = note.title.trim().to_string();
        }

        if note.blocks.is_empty() {
            note.blocks.push(self.empty_note_block());
        }

        for block in &mut note.blocks {
            if block.id.trim().is_empty() {
                block.id = Uuid::new_v4().to_string();
            }

            if block.children.is_empty() {
                if block.spans.is_empty() {
                    block.children.push(NoteInlineNode::Text(NoteTextNode {
                        text: String::new(),
                        bold: false,
                        italic: false,
                    }));
                } else {
                    block.children.extend(block.spans.iter().map(|span| {
                        NoteInlineNode::Text(NoteTextNode {
                            text: span.text.clone(),
                            bold: span.bold,
                            italic: span.italic,
                        })
                    }));
                }
            }

            block.children = self.normalize_note_inline_nodes(&block.children, note.book_id.as_deref());
            block.spans.clear();
        }
    }

    fn empty_note_block(&self) -> NoteBlock {
        NoteBlock {
            id: Uuid::new_v4().to_string(),
            r#type: NoteBlockType::Paragraph,
            children: vec![NoteInlineNode::Text(NoteTextNode {
                text: String::new(),
                bold: false,
                italic: false,
            })],
            spans: Vec::new(),
        }
    }

    fn normalize_note_inline_nodes(
        &self,
        nodes: &[NoteInlineNode],
        fallback_document_id: Option<&str>,
    ) -> Vec<NoteInlineNode> {
        let mut normalized = Vec::new();
        let mut pending_text: Option<NoteTextNode> = None;

        for node in nodes {
            match node {
                NoteInlineNode::Text(text) => {
                    let next = NoteTextNode {
                        text: text.text.clone(),
                        bold: text.bold,
                        italic: text.italic,
                    };

                    if let Some(current) = pending_text.as_mut() {
                        if current.bold == next.bold && current.italic == next.italic {
                            current.text.push_str(&next.text);
                            continue;
                        }
                    }

                    if let Some(current) = pending_text.replace(next) {
                        normalized.push(NoteInlineNode::Text(current));
                    }
                }
                NoteInlineNode::PageLink(page_link) => {
                    if let Some(current) = pending_text.take() {
                        normalized.push(NoteInlineNode::Text(current));
                    }

                    normalized.push(NoteInlineNode::PageLink(NotePageLinkNode {
                        id: if page_link.id.trim().is_empty() {
                            Uuid::new_v4().to_string()
                        } else {
                            page_link.id.clone()
                        },
                        text: page_link.text.clone(),
                        document_id: page_link
                            .document_id
                            .clone()
                            .or_else(|| fallback_document_id.map(ToOwned::to_owned)),
                        pdf_page_index: page_link.pdf_page_index,
                        book_page_label: page_link.book_page_label.trim().to_string(),
                        created_at: if page_link.created_at.trim().is_empty() {
                            timestamp()
                        } else {
                            page_link.created_at.clone()
                        },
                    }));
                }
            }
        }

        if let Some(current) = pending_text.take() {
            normalized.push(NoteInlineNode::Text(current));
        }

        if normalized.is_empty() {
            normalized.push(NoteInlineNode::Text(NoteTextNode {
                text: String::new(),
                bold: false,
                italic: false,
            }));
        }

        normalized
    }

    fn write_json_atomically<T: Serialize>(&self, path: &Path, value: &T) -> AppResult<()> {
        let raw = serde_json::to_string_pretty(value)?;
        self.write_string_atomically(path, &raw)
    }

    fn write_string_atomically(&self, path: &Path, raw: &str) -> AppResult<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }

        let file_name = path
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| AppError::InvalidInput("Invalid file path.".to_string()))?;
        let temp_path = path.with_file_name(format!("{file_name}.tmp"));

        let mut file = File::create(&temp_path)?;
        file.write_all(raw.as_bytes())?;
        file.sync_all()?;
        drop(file);

        fs::rename(temp_path, path)?;
        Ok(())
    }
}

#[cfg(target_os = "windows")]
fn write_pixmap_as_jpeg(path: &Path, pixmap: &Pixmap, quality: u32) -> Result<(), String> {
    use std::{ffi::c_void, os::windows::ffi::OsStrExt, ptr};

    type GpStatus = i32;
    type GpBitmap = c_void;
    type GpImage = c_void;
    type UlongPtr = usize;

    #[repr(C)]
    struct GdiplusStartupInput {
        gdi_plus_version: u32,
        debug_event_callback: *const c_void,
        suppress_background_thread: i32,
        suppress_external_codecs: i32,
    }

    #[repr(C)]
    struct Guid {
        data1: u32,
        data2: u16,
        data3: u16,
        data4: [u8; 8],
    }

    #[repr(C)]
    struct EncoderParameter {
        guid: Guid,
        number_of_values: u32,
        r#type: u32,
        value: *mut c_void,
    }

    #[repr(C)]
    struct EncoderParameters {
        count: u32,
        parameter: [EncoderParameter; 1],
    }

    const OK: GpStatus = 0;
    const PIXEL_FORMAT_24BPP_RGB: i32 = 137224;
    const ENCODER_PARAMETER_VALUE_TYPE_LONG: u32 = 4;

    #[link(name = "gdiplus")]
    unsafe extern "system" {
        fn GdiplusStartup(
            token: *mut UlongPtr,
            input: *const GdiplusStartupInput,
            output: *mut c_void,
        ) -> GpStatus;
        fn GdipCreateBitmapFromScan0(
            width: i32,
            height: i32,
            stride: i32,
            pixel_format: i32,
            scan0: *mut u8,
            bitmap: *mut *mut GpBitmap,
        ) -> GpStatus;
        fn GdipSaveImageToFile(
            image: *mut GpImage,
            filename: *const u16,
            clsid_encoder: *const Guid,
            encoder_params: *const EncoderParameters,
        ) -> GpStatus;
        fn GdipDisposeImage(image: *mut GpImage) -> GpStatus;
    }

    fn status_to_result(status: GpStatus, action: &str) -> Result<(), String> {
        if status == OK {
            Ok(())
        } else {
            Err(format!("{action} failed with GDI+ status {status}."))
        }
    }

    static GDI_PLUS_TOKEN: OnceLock<Result<UlongPtr, String>> = OnceLock::new();

    let token_result = GDI_PLUS_TOKEN.get_or_init(|| {
        let mut token = 0;
        let input = GdiplusStartupInput {
            gdi_plus_version: 1,
            debug_event_callback: ptr::null(),
            suppress_background_thread: 0,
            suppress_external_codecs: 0,
        };
        let status = unsafe { GdiplusStartup(&mut token, &input, ptr::null_mut()) };
        status_to_result(status, "GdiplusStartup").map(|_| token)
    });
    if let Err(error) = token_result {
        return Err(error.clone());
    }

    let width = pixmap.width();
    let height = pixmap.height();
    let component_count = pixmap.n() as usize;
    if component_count < 3 {
        return Err("MuPDF produced fewer than three color channels.".to_string());
    }

    let output_stride = ((width as usize * 3) + 3) & !3;
    let mut output = vec![0u8; output_stride * height as usize];
    let samples = pixmap.samples();

    for y in 0..height as usize {
        let source_row = y * width as usize * component_count;
        let target_row = y * output_stride;
        for x in 0..width as usize {
            let source_offset = source_row + (x * component_count);
            let target_offset = target_row + (x * 3);
            output[target_offset] = samples[source_offset + 2];
            output[target_offset + 1] = samples[source_offset + 1];
            output[target_offset + 2] = samples[source_offset];
        }
    }

    let jpeg_clsid = Guid {
        data1: 0x557cf401,
        data2: 0x1a04,
        data3: 0x11d3,
        data4: [0x9a, 0x73, 0x00, 0x00, 0xf8, 0x1e, 0xf3, 0x2e],
    };
    let encoder_quality_guid = Guid {
        data1: 0x1d5be4b5,
        data2: 0xfa4a,
        data3: 0x452d,
        data4: [0x9c, 0xdd, 0x5d, 0xb3, 0x51, 0x05, 0xe7, 0xeb],
    };
    let mut quality_value = quality;
    let encoder_parameters = EncoderParameters {
        count: 1,
        parameter: [EncoderParameter {
            guid: encoder_quality_guid,
            number_of_values: 1,
            r#type: ENCODER_PARAMETER_VALUE_TYPE_LONG,
            value: (&mut quality_value as *mut u32).cast(),
        }],
    };

    let mut bitmap = ptr::null_mut();
    let create_status = unsafe {
        GdipCreateBitmapFromScan0(
            width as i32,
            height as i32,
            output_stride as i32,
            PIXEL_FORMAT_24BPP_RGB,
            output.as_mut_ptr(),
            &mut bitmap,
        )
    };
    status_to_result(create_status, "GdipCreateBitmapFromScan0")?;

    let wide_path = path
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<u16>>();
    let save_result = unsafe {
        GdipSaveImageToFile(
            bitmap.cast(),
            wide_path.as_ptr(),
            &jpeg_clsid,
            &encoder_parameters,
        )
    };
    let dispose_result = unsafe { GdipDisposeImage(bitmap.cast()) };

    status_to_result(save_result, "GdipSaveImageToFile")?;
    status_to_result(dispose_result, "GdipDisposeImage")?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn write_pixmap_as_jpeg(_path: &Path, _pixmap: &Pixmap, _quality: u32) -> Result<(), String> {
    Err("JPEG output is only implemented for Windows in this build.".to_string())
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::Path,
        sync::{Arc, Mutex},
        thread,
        time::Duration,
    };

    use tempfile::tempdir;

    use super::{
        timestamp, LibraryStore, RenderCache, DEFAULT_COLLECTION_ID, DEFAULT_COLLECTIONS,
        NOTE_DOCUMENT_VERSION,
        MAX_RENDER_CACHE_ENTRIES,
    };
    use crate::models::{
        DocumentAvailability, DocumentState, NoteBlock, NoteDocument, NoteInlineNode, NoteSpan,
        NoteTextNode, ROOT_FOLDER_ID,
    };

    fn write_sample_pdf(path: &Path, label: &str) {
        write_valid_pdf(path, label);
    }

    fn write_valid_pdf(path: &Path, text: &str) {
        write_valid_pdf_pages(path, &[text]);
    }

    fn write_valid_pdf_pages(path: &Path, texts: &[&str]) {
        fn push_object(buffer: &mut Vec<u8>, offsets: &mut Vec<usize>, object_id: u32, body: &str) {
            offsets.push(buffer.len());
            buffer.extend_from_slice(format!("{object_id} 0 obj\n{body}\nendobj\n").as_bytes());
        }

        let mut pdf = b"%PDF-1.4\n".to_vec();
        let mut offsets = Vec::new();
        let page_count = texts.len().max(1) as u32;
        let font_object_id = 3 + (page_count * 2);

        let page_object_ids = (0..page_count)
            .map(|index| 3 + (index * 2))
            .collect::<Vec<_>>();
        let kids = page_object_ids
            .iter()
            .map(|object_id| format!("{object_id} 0 R"))
            .collect::<Vec<_>>()
            .join(" ");

        push_object(
            &mut pdf,
            &mut offsets,
            1,
            "<< /Type /Catalog /Pages 2 0 R >>",
        );
        push_object(
            &mut pdf,
            &mut offsets,
            2,
            &format!("<< /Type /Pages /Kids [{kids}] /Count {page_count} >>"),
        );

        for (index, text) in texts.iter().enumerate() {
            let page_object_id = 3 + (index as u32 * 2);
            let content_object_id = page_object_id + 1;
            let content = format!("BT /F1 18 Tf 40 120 Td ({text}) Tj ET");

            push_object(
                &mut pdf,
                &mut offsets,
                page_object_id,
                &format!(
                    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 {font_object_id} 0 R >> >> /Contents {content_object_id} 0 R >>"
                ),
            );
            push_object(
                &mut pdf,
                &mut offsets,
                content_object_id,
                &format!(
                    "<< /Length {} >>\nstream\n{}\nendstream",
                    content.len(),
                    content
                ),
            );
        }

        push_object(
            &mut pdf,
            &mut offsets,
            font_object_id,
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        );

        let xref_offset = pdf.len();
        pdf.extend_from_slice(format!("xref\n0 {}\n", offsets.len() + 1).as_bytes());
        pdf.extend_from_slice(b"0000000000 65535 f \n");
        for offset in offsets {
            pdf.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
        }
        pdf.extend_from_slice(
            format!(
                "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n",
                font_object_id + 1
            )
            .as_bytes(),
        );

        fs::write(path, pdf).unwrap();
    }

    fn create_render_cache() -> Arc<Mutex<RenderCache>> {
        Arc::new(Mutex::new(RenderCache::default()))
    }

    #[test]
    fn imports_pdf_without_creating_sidecar_files() {
        let temp = tempdir().unwrap();
        let source = temp.path().join("source.pdf");
        write_sample_pdf(&source, "hello");

        let store = LibraryStore::new(temp.path().join("app"), temp.path().join("Reader"));
        let record = store.import_pdf(&source, Some(DEFAULT_COLLECTION_ID)).unwrap();
        let root = Path::new(&store.library_root_string().unwrap()).to_path_buf();

        assert!(root.join(&record.relative_path).exists());
        assert!(!root.join(format!("{}.reader.json", record.file_name)).exists());
        assert!(temp
            .path()
            .join("app")
            .join("document-states")
            .join(format!("{}.json", record.id))
            .exists());
    }

    #[test]
    fn rescans_preserve_state_after_manual_rename() {
        let temp = tempdir().unwrap();
        let source = temp.path().join("paper.pdf");
        write_sample_pdf(&source, "paper");

        let store = LibraryStore::new(temp.path().join("app"), temp.path().join("Reader"));
        let record = store.import_pdf(&source, Some(DEFAULT_COLLECTION_ID)).unwrap();

        let mut state = store.open_document(&record.id).unwrap().state;
        state.last_page = 24;
        state.zoom = 1.25;
        store.save_document_state(&record.id, state).unwrap();

        let root = Path::new(&store.library_root_string().unwrap()).to_path_buf();
        fs::rename(
            root.join(DEFAULT_COLLECTION_ID).join("paper.pdf"),
            root.join(DEFAULT_COLLECTION_ID).join("paper-renamed.pdf"),
        )
        .unwrap();

        store.rescan_library().unwrap();
        let reopened = store.open_document(&record.id).unwrap();

        assert_eq!(
            reopened.document.relative_path,
            format!("{DEFAULT_COLLECTION_ID}/paper-renamed.pdf")
        );
        assert_eq!(reopened.state.last_page, 24);
        assert!((reopened.state.zoom - 1.25).abs() < f32::EPSILON);
    }

    #[test]
    fn marks_missing_documents_without_dropping_metadata() {
        let temp = tempdir().unwrap();
        let source = temp.path().join("missing.pdf");
        write_sample_pdf(&source, "missing");

        let store = LibraryStore::new(temp.path().join("app"), temp.path().join("Reader"));
        let record = store.import_pdf(&source, Some(DEFAULT_COLLECTION_ID)).unwrap();

        let root = Path::new(&store.library_root_string().unwrap()).to_path_buf();
        fs::remove_file(root.join(&record.relative_path)).unwrap();

        store.rescan_library().unwrap();
        let recents = store.list_recent_documents().unwrap();
        let missing = recents.iter().find(|document| document.id == record.id).unwrap();

        assert_eq!(missing.availability, DocumentAvailability::Missing);
    }

    #[test]
    fn creates_default_collections_when_library_is_empty() {
        let temp = tempdir().unwrap();
        let store = LibraryStore::new(temp.path().join("app"), temp.path().join("Reader"));

        let library = store.list_library().unwrap();
        let collection_names = library
            .folders
            .iter()
            .map(|folder| folder.folder.name.as_str())
            .collect::<Vec<_>>();

        assert_eq!(collection_names, DEFAULT_COLLECTIONS);
    }

    #[test]
    fn migrates_root_level_pdfs_into_collection_one() {
        let temp = tempdir().unwrap();
        let root = temp.path().join("Reader");
        fs::create_dir_all(&root).unwrap();
        write_sample_pdf(&root.join("loose.pdf"), "loose");

        let store = LibraryStore::new(temp.path().join("app"), &root);
        let library = store.list_library().unwrap();
        let collection_one = library
            .folders
            .iter()
            .find(|folder| folder.folder.id == DEFAULT_COLLECTION_ID)
            .unwrap();

        assert!(root.join(DEFAULT_COLLECTION_ID).join("loose.pdf").exists());
        assert_eq!(collection_one.documents.len(), 1);
        assert_eq!(collection_one.documents[0].relative_path, "Collection 1/loose.pdf");
    }

    #[test]
    fn ignores_nested_folders_when_reconciling_collections() {
        let temp = tempdir().unwrap();
        let root = temp.path().join("Reader");
        let nested = root.join(DEFAULT_COLLECTION_ID).join("Nested");
        fs::create_dir_all(&nested).unwrap();
        write_sample_pdf(&nested.join("hidden.pdf"), "hidden");
        write_sample_pdf(&root.join(DEFAULT_COLLECTION_ID).join("visible.pdf"), "visible");

        let store = LibraryStore::new(temp.path().join("app"), &root);
        let library = store.list_library().unwrap();
        let collection_one = library
            .folders
            .iter()
            .find(|folder| folder.folder.id == DEFAULT_COLLECTION_ID)
            .unwrap();

        assert_eq!(collection_one.folders.len(), 0);
        assert_eq!(
            collection_one
                .documents
                .iter()
                .map(|document| document.file_name.as_str())
                .collect::<Vec<_>>(),
            vec!["visible.pdf"]
        );
    }

    #[test]
    fn rejects_importing_a_pdf_into_the_library_root() {
        let temp = tempdir().unwrap();
        let source = temp.path().join("root.pdf");
        write_sample_pdf(&source, "root");

        let store = LibraryStore::new(temp.path().join("app"), temp.path().join("Reader"));
        let error = store.import_pdf(&source, Some(ROOT_FOLDER_ID)).unwrap_err();

        assert!(error.to_string().contains("collection"));
    }

    #[test]
    fn rejects_state_for_wrong_document_id() {
        let temp = tempdir().unwrap();
        let source = temp.path().join("wrong.pdf");
        write_sample_pdf(&source, "wrong");

        let store = LibraryStore::new(temp.path().join("app"), temp.path().join("Reader"));
        let record = store.import_pdf(&source, Some(DEFAULT_COLLECTION_ID)).unwrap();

        let state = DocumentState::new("something-else".to_string(), record.fingerprint.clone());
        let error = store.save_document_state(&record.id, state).unwrap_err();
        assert!(error.to_string().contains("document id"));
    }

    #[test]
    fn save_document_state_does_not_require_library_rescan() {
        let temp = tempdir().unwrap();
        let source = temp.path().join("state.pdf");
        write_sample_pdf(&source, "state");

        let store = LibraryStore::new(temp.path().join("app"), temp.path().join("Reader"));
        let record = store.import_pdf(&source, Some(DEFAULT_COLLECTION_ID)).unwrap();

        let root = Path::new(&store.library_root_string().unwrap()).to_path_buf();
        fs::rename(
            root.join(&record.relative_path),
            root.join(DEFAULT_COLLECTION_ID).join("state-moved.pdf"),
        )
        .unwrap();

        let mut state = DocumentState::new(record.id.clone(), record.fingerprint.clone());
        state.last_page = 9;
        state.zoom = 1.0;
        store.save_document_state(&record.id, state).unwrap();

        let recents = store.list_recent_documents().unwrap();
        let saved = recents.iter().find(|document| document.id == record.id).unwrap();

        assert_eq!(
            saved.relative_path,
            format!("{DEFAULT_COLLECTION_ID}/state.pdf")
        );
        assert_eq!(store.open_document(&record.id).unwrap_err().to_string().contains("unavailable"), true);
    }

    #[test]
    fn save_document_state_does_not_rewrite_library_index() {
        let temp = tempdir().unwrap();
        let source = temp.path().join("catalog.pdf");
        write_sample_pdf(&source, "catalog");

        let store = LibraryStore::new(temp.path().join("app"), temp.path().join("Reader"));
        let record = store.import_pdf(&source, Some(DEFAULT_COLLECTION_ID)).unwrap();
        let before = store.load_index().unwrap();

        let mut state = DocumentState::new(record.id.clone(), record.fingerprint.clone());
        state.last_page = 12;
        state.zoom = 1.3;
        store.save_document_state(&record.id, state).unwrap();

        let after = store.load_index().unwrap();
        assert_eq!(after, before);

        let recents = store.list_recent_documents().unwrap();
        let updated = recents.iter().find(|document| document.id == record.id).unwrap();
        assert!(updated.last_opened_at.is_some());
    }

    #[test]
    fn get_or_create_note_for_book_creates_note_file_and_index_entry() {
        let temp = tempdir().unwrap();
        let source = temp.path().join("notes.pdf");
        write_sample_pdf(&source, "notes");

        let app_dir = temp.path().join("app");
        let store = LibraryStore::new(&app_dir, temp.path().join("Reader"));
        let record = store.import_pdf(&source, Some(DEFAULT_COLLECTION_ID)).unwrap();

        let note = store.get_or_create_note_for_book(&record.id).unwrap();
        let index = store.load_notes_index().unwrap();

        assert!(app_dir.join("notes").join(format!("{}.json", note.id)).exists());
        assert_eq!(note.book_id.as_deref(), Some(record.id.as_str()));
        assert!(index.notes.iter().any(|entry| entry.id == note.id));
    }

    #[test]
    fn get_or_create_note_for_book_returns_most_recent_existing_note() {
        let temp = tempdir().unwrap();
        let source = temp.path().join("recent-note.pdf");
        write_sample_pdf(&source, "recent-note");

        let store = LibraryStore::new(temp.path().join("app"), temp.path().join("Reader"));
        let record = store.import_pdf(&source, Some(DEFAULT_COLLECTION_ID)).unwrap();

        let older = store
            .save_note(NoteDocument {
                id: uuid::Uuid::new_v4().to_string(),
                title: "Older".to_string(),
                book_id: Some(record.id.clone()),
                created_at: timestamp(),
                updated_at: timestamp(),
                version: NOTE_DOCUMENT_VERSION,
                blocks: vec![store.empty_note_block()],
            })
            .unwrap();
        thread::sleep(Duration::from_millis(15));
        let newer = store
            .save_note(NoteDocument {
                id: uuid::Uuid::new_v4().to_string(),
                title: "Newer".to_string(),
                book_id: Some(record.id.clone()),
                created_at: timestamp(),
                updated_at: timestamp(),
                version: NOTE_DOCUMENT_VERSION,
                blocks: vec![store.empty_note_block()],
            })
            .unwrap();

        let selected = store.get_or_create_note_for_book(&record.id).unwrap();
        assert_ne!(older.id, newer.id);
        assert_eq!(selected.id, newer.id);
    }

    #[test]
    fn save_note_updates_note_file_and_index_metadata() {
        let temp = tempdir().unwrap();
        let source = temp.path().join("save-note.pdf");
        write_sample_pdf(&source, "save-note");

        let app_dir = temp.path().join("app");
        let store = LibraryStore::new(&app_dir, temp.path().join("Reader"));
        let record = store.import_pdf(&source, Some(DEFAULT_COLLECTION_ID)).unwrap();
        let note = store.get_or_create_note_for_book(&record.id).unwrap();

        let saved = store
            .save_note(NoteDocument {
                title: "Reading Notes".to_string(),
                blocks: vec![NoteBlock {
                    id: "heading".to_string(),
                    r#type: crate::models::NoteBlockType::Heading1,
                    children: vec![NoteInlineNode::Text(NoteTextNode {
                        text: "Important".to_string(),
                        bold: false,
                        italic: false,
                    })],
                    spans: vec![NoteSpan {
                        text: "Important".to_string(),
                        bold: false,
                        italic: false,
                    }],
                }],
                ..note
            })
            .unwrap();

        let raw = fs::read_to_string(app_dir.join("notes").join(format!("{}.json", saved.id))).unwrap();
        let stored_note: NoteDocument = serde_json::from_str(&raw).unwrap();
        let index = store.load_notes_index().unwrap();
        let entry = index.notes.iter().find(|entry| entry.id == saved.id).unwrap();

        assert_eq!(stored_note.title, "Reading Notes");
        assert_eq!(entry.title, "Reading Notes");
        assert_eq!(entry.excerpt, "Important");
    }

    #[test]
    fn save_note_supports_standalone_notes() {
        let temp = tempdir().unwrap();
        let app_dir = temp.path().join("app");
        let store = LibraryStore::new(&app_dir, temp.path().join("Reader"));

        let saved = store
            .save_note(NoteDocument {
                id: uuid::Uuid::new_v4().to_string(),
                title: "Standalone".to_string(),
                book_id: None,
                created_at: timestamp(),
                updated_at: timestamp(),
                version: NOTE_DOCUMENT_VERSION,
                blocks: vec![NoteBlock {
                    id: "body".to_string(),
                    r#type: crate::models::NoteBlockType::Paragraph,
                    children: vec![NoteInlineNode::Text(NoteTextNode {
                        text: "Freeform".to_string(),
                        bold: false,
                        italic: true,
                    })],
                    spans: vec![NoteSpan {
                        text: "Freeform".to_string(),
                        bold: false,
                        italic: true,
                    }],
                }],
            })
            .unwrap();

        let index = store.load_notes_index().unwrap();
        let entry = index.notes.iter().find(|entry| entry.id == saved.id).unwrap();

        assert!(app_dir.join("notes").join(format!("{}.json", saved.id)).exists());
        assert!(entry.book_id.is_none());
    }

    #[test]
    fn save_note_migrates_legacy_spans_into_children() {
        let temp = tempdir().unwrap();
        let source = temp.path().join("legacy-spans.pdf");
        write_sample_pdf(&source, "legacy-spans");

        let app_dir = temp.path().join("app");
        let store = LibraryStore::new(&app_dir, temp.path().join("Reader"));
        let record = store.import_pdf(&source, Some(DEFAULT_COLLECTION_ID)).unwrap();
        let note = store.get_or_create_note_for_book(&record.id).unwrap();

        let saved = store
            .save_note(NoteDocument {
                blocks: vec![NoteBlock {
                    id: "legacy".to_string(),
                    r#type: crate::models::NoteBlockType::Paragraph,
                    children: Vec::new(),
                    spans: vec![NoteSpan {
                        text: "(p. 45)".to_string(),
                        bold: false,
                        italic: false,
                    }],
                }],
                ..note
            })
            .unwrap();

        match &saved.blocks[0].children[0] {
            NoteInlineNode::Text(text) => assert_eq!(text.text, "(p. 45)"),
            _ => panic!("expected migrated text node"),
        }
        assert!(saved.blocks[0].spans.is_empty());
    }

    #[test]
    fn reconcile_library_skips_index_write_when_catalog_is_unchanged() {
        let temp = tempdir().unwrap();
        let source = temp.path().join("steady.pdf");
        write_sample_pdf(&source, "steady");

        let app_dir = temp.path().join("app");
        let store = LibraryStore::new(&app_dir, temp.path().join("Reader"));
        let _record = store.import_pdf(&source, Some(DEFAULT_COLLECTION_ID)).unwrap();

        let index_path = app_dir.join("library-index.json");
        let before = fs::metadata(&index_path).unwrap().modified().unwrap();
        thread::sleep(Duration::from_millis(1100));

        let _ = store.list_library().unwrap();

        let after = fs::metadata(&index_path).unwrap().modified().unwrap();
        assert_eq!(after, before);
    }

    #[test]
    fn rename_folder_updates_document_paths_without_rescan() {
        let temp = tempdir().unwrap();
        let source = temp.path().join("foldered.pdf");
        write_sample_pdf(&source, "foldered");

        let store = LibraryStore::new(temp.path().join("app"), temp.path().join("Reader"));
        let folder = store.create_folder("Shelf", Some(ROOT_FOLDER_ID)).unwrap();
        let record = store.import_pdf(&source, Some(&folder.id)).unwrap();

        let renamed = store.rename_folder(&folder.id, "Archive").unwrap();
        let reopened = store.open_document(&record.id).unwrap();

        assert_eq!(renamed.id, "Archive");
        assert_eq!(reopened.document.folder_id, "Archive");
        assert_eq!(reopened.document.relative_path, "Archive/foldered.pdf");
    }

    #[test]
    fn render_pdf_page_rejects_missing_document() {
        let temp = tempdir().unwrap();
        let store = LibraryStore::new(temp.path().join("app"), temp.path().join("Reader"));
        let render_cache = create_render_cache();

        let error = store
            .render_pdf_page("missing-document", 1, 1.0, render_cache)
            .unwrap_err();
        assert!(error.to_string().contains("Document not found"));
    }

    #[test]
    fn render_pdf_page_rejects_out_of_range_page() {
        let temp = tempdir().unwrap();
        let source = temp.path().join("render.pdf");
        write_valid_pdf(&source, "Render me");

        let store = LibraryStore::new(temp.path().join("app"), temp.path().join("Reader"));
        let record = store.import_pdf(&source, Some(DEFAULT_COLLECTION_ID)).unwrap();
        let render_cache = create_render_cache();

        let error = store
            .render_pdf_page(&record.id, 2, 1.0, render_cache)
            .unwrap_err();
        assert!(error.to_string().contains("out of bounds"));
    }

    #[test]
    fn render_cache_key_uses_the_document_page_and_zoom() {
        let temp = tempdir().unwrap();
        let store = LibraryStore::new(temp.path().join("app"), temp.path().join("Reader"));

        assert_eq!(store.render_cache_key("doc-a", 4, 1.25), "doc-a:4:1.25");
    }

    #[test]
    fn render_pdf_page_reuses_cached_file() {
        let temp = tempdir().unwrap();
        let source = temp.path().join("cached.pdf");
        write_valid_pdf(&source, "Cache test");

        let store = LibraryStore::new(temp.path().join("app"), temp.path().join("Reader"));
        let record = store.import_pdf(&source, Some(DEFAULT_COLLECTION_ID)).unwrap();
        let render_cache = create_render_cache();

        let first = store
            .render_pdf_page(&record.id, 1, 1.0, render_cache.clone())
            .unwrap();
        fs::write(&first.image_path, b"sentinel").unwrap();

        let second = store.render_pdf_page(&record.id, 1, 1.0, render_cache).unwrap();
        let cached_contents = fs::read(&second.image_path).unwrap();

        assert_eq!(first.cache_key, second.cache_key);
        assert_eq!(second.page_number, 1);
        assert_eq!(cached_contents, b"sentinel");
    }

    #[test]
    fn open_document_reports_lightweight_page_count() {
        let temp = tempdir().unwrap();
        let source = temp.path().join("paged.pdf");
        write_valid_pdf_pages(&source, &["One", "Two", "Three"]);

        let store = LibraryStore::new(temp.path().join("app"), temp.path().join("Reader"));
        let record = store.import_pdf(&source, Some(DEFAULT_COLLECTION_ID)).unwrap();
        let payload = store.open_document(&record.id).unwrap();

        assert_eq!(payload.page_count, 3);
        assert_eq!(payload.state.last_page, 1);
    }

    #[test]
    fn render_cache_evicts_oldest_entries_beyond_the_limit() {
        let temp = tempdir().unwrap();
        let render_cache = create_render_cache();
        let mut previous_paths = Vec::new();

        for page_number in 1..=(MAX_RENDER_CACHE_ENTRIES as u32 + 1) {
            let image_path = temp.path().join(format!("page-{page_number}.jpg"));
            fs::write(&image_path, format!("page-{page_number}")).unwrap();
            let request = super::PageRenderRequest {
                document_id: "doc".to_string(),
                fingerprint: "fingerprint".to_string(),
                document_path: "doc.pdf".to_string(),
                page_number,
                zoom: 1.0,
                cache_key: format!("doc:{page_number}:1.00"),
                image_path: image_path.clone(),
            };

            let evicted_paths = {
                let mut cache = render_cache.lock().unwrap();
                cache.insert(&request, 600, 800)
            };

            previous_paths.push(image_path);
            if page_number as usize <= MAX_RENDER_CACHE_ENTRIES {
                assert!(evicted_paths.is_empty());
            } else {
                assert_eq!(evicted_paths, vec![previous_paths[0].clone()]);
            }
        }

        let cache_keys = {
            let cache = render_cache.lock().unwrap();
            cache.entries.keys().cloned().collect::<Vec<_>>()
        };

        assert_eq!(cache_keys.len(), MAX_RENDER_CACHE_ENTRIES);
        assert!(!cache_keys.contains(&"doc:1:1.00".to_string()));
        assert!(cache_keys.contains(&format!("doc:{}:1.00", MAX_RENDER_CACHE_ENTRIES + 1)));
    }
}
