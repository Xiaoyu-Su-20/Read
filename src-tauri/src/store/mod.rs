use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use chrono::Utc;
use serde_json::json;
use uuid::Uuid;

use crate::{
    debug::process as debug_process,
    error::{AppError, AppResult},
    models::{
        DocumentAvailability, DocumentPayload, DocumentRecord, DocumentState, FolderRecord,
        FolderTreeNode, LibraryIndex, NoteDocument, NoteIndex, RenderedPagePayload, ROOT_FOLDER_ID,
    },
    normalization::{ready_manifest_for, ManifestCache, NormalizationJob},
};

mod catalog;
mod notes;
pub(crate) mod paths;
mod render;
mod state;

#[cfg(test)]
pub use render::MAX_RENDER_CACHE_ENTRIES;
pub use render::{
    DisplayListWarmupRequest, NativeOutlineRequest, NativeTextPageRequest, PageRenderRequest,
    RenderCache, RenderSessionRegistry,
};

use catalog::CatalogStore;
use notes::NoteStore;
use paths::StorePaths;
use render::PdfRenderStore;
use state::DocumentStateStore;

const DEFAULT_COLLECTIONS: [&str; 3] = ["Collection 1", "Collection 2", "Collection 3"];
const DEFAULT_COLLECTION_ID: &str = "Collection 1";
const NOTE_DOCUMENT_VERSION: u32 = 2;

pub fn timestamp() -> String {
    Utc::now().to_rfc3339()
}

#[derive(Debug, Clone)]
pub struct LibraryStore {
    paths: StorePaths,
    catalog: CatalogStore,
    states: DocumentStateStore,
    notes: NoteStore,
    renderer: PdfRenderStore,
}

impl LibraryStore {
    pub fn new(app_dir: impl AsRef<Path>, library_dir: impl AsRef<Path>) -> Self {
        Self {
            paths: StorePaths::new(app_dir, library_dir),
            catalog: CatalogStore,
            states: DocumentStateStore,
            notes: NoteStore,
            renderer: PdfRenderStore,
        }
    }

    pub fn ensure_ready(&self) -> AppResult<()> {
        self.paths.ensure_storage_dirs()?;

        if !self.paths.index_path.exists() {
            self.catalog
                .save_index(&self.paths, &LibraryIndex::default())?;
        }

        if !self.paths.notes_index_path.exists() {
            self.notes
                .save_notes_index(&self.paths, &NoteIndex::default())?;
        }

        self.catalog.ensure_default_library_structure(&self.paths)?;
        Ok(())
    }

    pub fn library_root_string(&self) -> AppResult<String> {
        self.ensure_ready()?;
        Ok(self.paths.library_root_path().to_string_lossy().to_string())
    }

    pub fn list_library(&self) -> AppResult<FolderTreeNode> {
        self.ensure_ready()?;
        self.catalog.reconcile_library(&self.paths, &self.states)?;

        let index = self.catalog.load_index(&self.paths)?;
        self.catalog.build_tree(&self.paths, &index)
    }

    pub fn rescan_library(&self) -> AppResult<FolderTreeNode> {
        self.ensure_ready()?;
        self.catalog.reconcile_library(&self.paths, &self.states)?;

        let index = self.catalog.load_index(&self.paths)?;
        self.catalog.build_tree(&self.paths, &index)
    }

    pub fn create_folder(&self, name: &str, parent_id: Option<&str>) -> AppResult<FolderRecord> {
        self.ensure_ready()?;
        self.catalog.create_folder(&self.paths, name, parent_id)
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

        if !self.paths.is_pdf_path(source_path) {
            return Err(AppError::InvalidInput(
                "Only PDF files can be imported.".to_string(),
            ));
        }

        let root = self.paths.library_root_path();
        let destination_folder_id = destination_folder_id.ok_or_else(|| {
            AppError::InvalidInput("Choose a collection before importing a PDF.".to_string())
        })?;
        if destination_folder_id == ROOT_FOLDER_ID {
            return Err(AppError::InvalidInput(
                "Choose a collection before importing a PDF.".to_string(),
            ));
        }
        let destination_folder_path = self
            .paths
            .resolve_collection_path(&root, destination_folder_id)?;
        fs::create_dir_all(&destination_folder_path)?;

        let file_name = source_path
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| AppError::InvalidInput("Invalid source file name.".to_string()))?;
        let destination_path = self
            .paths
            .unique_pdf_path(&destination_folder_path, file_name);

        fs::copy(source_path, &destination_path)?;
        let relative_path = self.paths.relative_to_root(&root, &destination_path)?;
        let fingerprint = self.catalog.hash_file(&destination_path)?;
        let (file_size_bytes, file_modified_ms) =
            self.catalog.file_metadata_signature(&destination_path)?;
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
            folder_id: self.paths.folder_id_from_relative_path(&relative_path),
            relative_path,
            fingerprint: fingerprint.clone(),
            file_size_bytes: Some(file_size_bytes),
            file_modified_ms: Some(file_modified_ms),
            imported_at: timestamp(),
            last_opened_at: None,
            availability: DocumentAvailability::Available,
        };

        let state = DocumentState::new(document.id.clone(), fingerprint);
        self.states.write_state(&self.paths, &state)?;

        let mut index = self.catalog.load_index(&self.paths)?;
        index.documents.push(document.clone());
        self.catalog.save_index(&self.paths, &index)?;
        Ok(document)
    }

    pub fn move_document(
        &self,
        document_id: &str,
        destination_folder_id: &str,
    ) -> AppResult<DocumentRecord> {
        self.ensure_ready()?;
        self.catalog
            .move_document(&self.paths, document_id, destination_folder_id)
    }

    pub fn rename_document(&self, document_id: &str, new_name: &str) -> AppResult<DocumentRecord> {
        self.ensure_ready()?;
        self.catalog
            .rename_document(&self.paths, document_id, new_name)
    }

    pub fn rename_folder(&self, folder_id: &str, new_name: &str) -> AppResult<FolderRecord> {
        self.ensure_ready()?;
        self.catalog.rename_folder(&self.paths, folder_id, new_name)
    }

    pub fn delete_folder(&self, folder_id: &str) -> AppResult<FolderRecord> {
        self.ensure_ready()?;
        self.catalog.delete_folder(&self.paths, folder_id)
    }

    pub fn remove_from_library(
        &self,
        document_id: &str,
        destination_directory: &Path,
    ) -> AppResult<DocumentRecord> {
        self.ensure_ready()?;
        self.catalog
            .move_document_out_of_library(&self.paths, document_id, destination_directory)
    }

    pub fn open_document(&self, document_id: &str) -> AppResult<DocumentPayload> {
        self.ensure_ready()?;

        let mut index = self.catalog.load_index(&self.paths)?;
        let document_index = CatalogStore::find_document_index(&index, document_id)?;
        let document = index.documents[document_index].clone();
        self.catalog.ensure_document_available(&document)?;

        let file_path = self.resolved_document_path(&document)?;
        let page_count = self.renderer.document_page_count(&file_path)?;

        let mut state = self.states.load_for(&self.paths, &document)?;
        state.last_opened_at = Some(timestamp());
        self.states
            .save_for(&self.paths, &document, state.clone())?;

        index.documents[document_index].last_opened_at = state.last_opened_at.clone();
        index.last_opened_document_id = Some(document.id.clone());
        self.catalog.save_index(&self.paths, &index)?;

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

            let index = self.catalog.load_index(&self.paths)?;
            process.checkpoint("load-index", json!({}));
            let document_index = CatalogStore::find_document_index(&index, document_id)?;
            let document = index.documents[document_index].clone();

            if state.document_id != document.id {
                return Err(AppError::InvalidInput(
                    "Reader state document id does not match the target document.".to_string(),
                ));
            }

            state.fingerprint = document.fingerprint.clone();
            state.last_opened_at = Some(timestamp());
            self.states.save_for(&self.paths, &document, state)?;
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
        let document = self.catalog.find_document_by_id(&self.paths, document_id)?;
        self.notes.get_or_create_for_book(&self.paths, &document)
    }

    pub fn save_note(&self, note: NoteDocument) -> AppResult<NoteDocument> {
        self.ensure_ready()?;

        if let Some(book_id) = note.book_id.as_deref() {
            let _ = self.catalog.find_document_by_id(&self.paths, book_id)?;
        }

        self.notes.save(&self.paths, note)
    }

    pub fn list_recent_documents(&self) -> AppResult<Vec<DocumentRecord>> {
        self.ensure_ready()?;
        self.catalog
            .list_recent_documents(&self.paths, &self.states)
    }

    pub fn document_path_string(&self, document_id: &str) -> AppResult<String> {
        self.ensure_ready()?;

        let document = self.catalog.find_document_by_id(&self.paths, document_id)?;
        self.catalog.ensure_document_available(&document)?;
        let path = self.resolved_document_path(&document)?;
        Ok(path.to_string_lossy().to_string())
    }

    pub fn folder_path_string(&self, folder_id: Option<&str>) -> AppResult<String> {
        self.ensure_ready()?;
        let root = self.paths.library_root_path();
        let folder_path = self
            .paths
            .resolve_folder_path(&root, folder_id.unwrap_or(ROOT_FOLDER_ID))?;
        Ok(folder_path.to_string_lossy().to_string())
    }

    pub fn read_document_bytes(&self, document_id: &str) -> AppResult<Vec<u8>> {
        self.ensure_ready()?;

        let document = self.catalog.find_document_by_id(&self.paths, document_id)?;
        self.catalog.ensure_document_available(&document)?;
        let path = self.resolved_document_path(&document)?;
        Ok(fs::read(path)?)
    }

    pub fn prepare_render_request(
        &self,
        document_id: &str,
        page_number: u32,
        zoom: f32,
        manifest_cache: &ManifestCache,
    ) -> AppResult<PageRenderRequest> {
        self.ensure_ready()?;
        let document = self.catalog.find_document_by_id(&self.paths, document_id)?;
        self.catalog.ensure_document_available(&document)?;
        let path = self.resolved_document_path(&document)?;
        let normalization = ready_manifest_for(
            &self.paths,
            manifest_cache,
            &document.id,
            &document.fingerprint,
        )?;
        self.renderer.prepare_request(
            &self.paths,
            &document,
            &path,
            page_number,
            zoom,
            normalization,
        )
    }

    pub fn prepare_display_list_warmup_request(
        &self,
        document_id: &str,
        page_numbers: Vec<u32>,
    ) -> AppResult<DisplayListWarmupRequest> {
        self.ensure_ready()?;
        let document = self.catalog.find_document_by_id(&self.paths, document_id)?;
        self.catalog.ensure_document_available(&document)?;
        let path = self.resolved_document_path(&document)?;

        Ok(DisplayListWarmupRequest {
            document_id: document.id,
            document_generation_id: None,
            fingerprint: document.fingerprint,
            document_path: path.to_string_lossy().to_string(),
            page_numbers,
        })
    }

    pub fn prepare_native_text_page_request(
        &self,
        document_id: &str,
        page_number: u32,
    ) -> AppResult<NativeTextPageRequest> {
        self.ensure_ready()?;
        let document = self.catalog.find_document_by_id(&self.paths, document_id)?;
        self.catalog.ensure_document_available(&document)?;
        let path = self.resolved_document_path(&document)?;

        Ok(NativeTextPageRequest {
            document_id: document.id,
            document_generation_id: None,
            fingerprint: document.fingerprint,
            document_path: path.to_string_lossy().to_string(),
            page_number,
        })
    }

    pub fn prepare_native_outline_request(
        &self,
        document_id: &str,
    ) -> AppResult<NativeOutlineRequest> {
        self.ensure_ready()?;
        let document = self.catalog.find_document_by_id(&self.paths, document_id)?;
        self.catalog.ensure_document_available(&document)?;
        let path = self.resolved_document_path(&document)?;

        Ok(NativeOutlineRequest {
            document_id: document.id,
            document_generation_id: None,
            fingerprint: document.fingerprint,
            document_path: path.to_string_lossy().to_string(),
        })
    }

    pub fn prepare_normalization_job(&self, document_id: &str) -> AppResult<NormalizationJob> {
        self.ensure_ready()?;
        let document = self.catalog.find_document_by_id(&self.paths, document_id)?;
        self.catalog.ensure_document_available(&document)?;
        let document_path = self.resolved_document_path(&document)?;
        Ok(NormalizationJob {
            document_id: document.id,
            fingerprint: document.fingerprint,
            document_path,
            page_count: 0,
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
        let cache = crate::normalization::new_manifest_cache();
        let request = self.prepare_render_request(document_id, page_number, zoom, &cache)?;
        Self::render_pdf_page_blocking(request, render_cache, RenderSessionRegistry::default())
    }

    #[cfg(test)]
    pub fn render_pdf_page_with_sessions(
        &self,
        document_id: &str,
        page_number: u32,
        zoom: f32,
        render_cache: Arc<Mutex<RenderCache>>,
        render_sessions: RenderSessionRegistry,
    ) -> AppResult<RenderedPagePayload> {
        let cache = crate::normalization::new_manifest_cache();
        let request = self.prepare_render_request(document_id, page_number, zoom, &cache)?;
        Self::render_pdf_page_blocking(request, render_cache, render_sessions)
    }

    pub fn render_pdf_page_blocking(
        request: PageRenderRequest,
        render_cache: Arc<Mutex<RenderCache>>,
        render_sessions: RenderSessionRegistry,
    ) -> AppResult<RenderedPagePayload> {
        PdfRenderStore::render_pdf_page_blocking(request, render_cache, render_sessions)
    }

    #[cfg(test)]
    pub fn render_cache_key(&self, document_id: &str, page_number: u32, zoom: f32) -> String {
        self.renderer
            .render_cache_key(document_id, page_number, zoom)
    }

    fn resolved_document_path(&self, document: &DocumentRecord) -> AppResult<PathBuf> {
        let root = self.paths.library_root_path();
        let path = self.paths.absolute_document_path(&root, document);
        if !path.exists() {
            return Err(AppError::InvalidInput(format!(
                "This PDF is currently unavailable: {}",
                document.relative_path
            )));
        }
        Ok(path)
    }
}

#[cfg(test)]
mod tests;
