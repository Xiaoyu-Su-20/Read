use std::{
    fs,
    fs::File,
    io::{Read, Write},
    path::{Path, PathBuf},
};

use chrono::Utc;
use sanitize_filename::sanitize;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::{
        Bookmark, DocumentPayload, DocumentRecord, DocumentState, FolderRecord, FolderTreeNode,
        LibraryIndex, ReaderPreferences, ROOT_FOLDER_ID,
    },
};

pub fn timestamp() -> String {
    Utc::now().to_rfc3339()
}

#[derive(Debug, Clone)]
pub struct LibraryStore {
    library_dir: PathBuf,
    index_path: PathBuf,
}

impl LibraryStore {
    pub fn new(app_dir: impl AsRef<Path>) -> Self {
        let app_dir = app_dir.as_ref().to_path_buf();
        let library_dir = app_dir.join("library");
        let index_path = app_dir.join("library-index.json");

        Self { library_dir, index_path }
    }

    pub fn ensure_ready(&self) -> AppResult<()> {
        fs::create_dir_all(&self.library_dir)?;
        if !self.index_path.exists() {
            self.save_index(&LibraryIndex::default())?;
        }
        Ok(())
    }

    pub fn list_library(&self) -> AppResult<FolderTreeNode> {
        self.ensure_ready()?;
        let index = self.load_index()?;
        self.build_tree(&index, ROOT_FOLDER_ID)
    }

    pub fn create_folder(
        &self,
        name: &str,
        parent_id: Option<&str>,
    ) -> AppResult<FolderRecord> {
        self.ensure_ready()?;
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err(AppError::InvalidInput("Folder name cannot be empty.".to_string()));
        }

        let mut index = self.load_index()?;
        let parent_id = parent_id.unwrap_or(ROOT_FOLDER_ID).to_string();

        self.folder_from_index(&index, &parent_id)?;

        let folder = FolderRecord {
            id: Uuid::new_v4().to_string(),
            name: trimmed.to_string(),
            parent_id: Some(parent_id),
            created_at: timestamp(),
        };

        let folder_path = self.folder_path(&index, &folder.id, Some(&folder))?;
        fs::create_dir_all(folder_path)?;

        index.folders.push(folder.clone());
        self.save_index(&index)?;
        Ok(folder)
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
        if source_path
            .extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.eq_ignore_ascii_case("pdf"))
            != Some(true)
        {
            return Err(AppError::InvalidInput(
                "Only PDF files can be imported.".to_string(),
            ));
        }

        let mut index = self.load_index()?;
        let folder_id = destination_folder_id.unwrap_or(ROOT_FOLDER_ID).to_string();
        self.folder_from_index(&index, &folder_id)?;

        let folder_path = self.folder_path(&index, &folder_id, None)?;
        fs::create_dir_all(&folder_path)?;

        let original_name = source_path
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| AppError::InvalidInput("Invalid source file name.".to_string()))?;
        let destination_path = self.unique_pdf_path(&folder_path, original_name);
        fs::copy(source_path, &destination_path)?;

        let fingerprint = self.hash_file(&destination_path)?;
        let document_id = Uuid::new_v4().to_string();
        let sidecar_path = self.sidecar_path_for_pdf(&destination_path);
        let state = DocumentState::new(document_id.clone(), fingerprint.clone());
        self.write_state(&sidecar_path, &state)?;

        let imported_at = timestamp();
        let relative_path = self.relative_to_library(&destination_path)?;
        let sidecar_relative_path = self.relative_to_library(&sidecar_path)?;

        let title = destination_path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or("Untitled PDF")
            .to_string();

        let record = DocumentRecord {
            id: document_id,
            title,
            file_name: destination_path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or(original_name)
                .to_string(),
            folder_id,
            relative_path,
            sidecar_relative_path,
            fingerprint,
            imported_at,
            last_opened_at: None,
        };

        index.documents.push(record.clone());
        self.save_index(&index)?;
        Ok(record)
    }

    pub fn move_document(
        &self,
        document_id: &str,
        destination_folder_id: &str,
    ) -> AppResult<DocumentRecord> {
        self.ensure_ready()?;
        let mut index = self.load_index()?;
        self.folder_from_index(&index, destination_folder_id)?;

        let document_index = index
            .documents
            .iter()
            .position(|document| document.id == document_id)
            .ok_or_else(|| AppError::DocumentNotFound(document_id.to_string()))?;
        let mut document = index.documents[document_index].clone();

        let current_pdf_path = self.pdf_path(&document);
        let current_sidecar_path = self.sidecar_path(&document);

        let destination_folder_path = self.folder_path(&index, destination_folder_id, None)?;
        fs::create_dir_all(&destination_folder_path)?;
        let destination_pdf_path = self.unique_pdf_path(&destination_folder_path, &document.file_name);
        let destination_sidecar_path = self.sidecar_path_for_pdf(&destination_pdf_path);

        fs::rename(&current_pdf_path, &destination_pdf_path)?;
        fs::rename(&current_sidecar_path, &destination_sidecar_path)?;

        document.folder_id = destination_folder_id.to_string();
        document.file_name = destination_pdf_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or(&document.file_name)
            .to_string();
        document.relative_path = self.relative_to_library(&destination_pdf_path)?;
        document.sidecar_relative_path = self.relative_to_library(&destination_sidecar_path)?;

        index.documents[document_index] = document.clone();
        self.save_index(&index)?;
        Ok(document)
    }

    pub fn open_document(&self, document_id: &str) -> AppResult<DocumentPayload> {
        self.ensure_ready()?;
        let mut index = self.load_index()?;
        let document_index = index
            .documents
            .iter()
            .position(|document| document.id == document_id)
            .ok_or_else(|| AppError::DocumentNotFound(document_id.to_string()))?;

        let mut document = index.documents[document_index].clone();
        let file_path = self.pdf_path(&document);
        let mut state = self.read_state(&document)?;
        state.last_opened_at = Some(timestamp());
        self.write_state(&self.sidecar_path(&document), &state)?;
        document.last_opened_at = state.last_opened_at.clone();
        index.documents[document_index] = document.clone();
        index.last_opened_document_id = Some(document.id.clone());
        self.save_index(&index)?;

        Ok(DocumentPayload {
            document,
            state,
            file_path: file_path.to_string_lossy().to_string(),
        })
    }

    pub fn save_document_state(
        &self,
        document_id: &str,
        mut state: DocumentState,
    ) -> AppResult<()> {
        self.ensure_ready()?;
        let mut index = self.load_index()?;
        let document_index = index
            .documents
            .iter()
            .position(|document| document.id == document_id)
            .ok_or_else(|| AppError::DocumentNotFound(document_id.to_string()))?;
        let document = index.documents[document_index].clone();

        if state.document_id != document.id {
            return Err(AppError::InvalidInput(
                "Reader state document id does not match the target document.".to_string(),
            ));
        }

        state.fingerprint = document.fingerprint.clone();
        state.last_opened_at = Some(timestamp());
        self.write_state(&self.sidecar_path(&document), &state)?;

        index.documents[document_index].last_opened_at = state.last_opened_at.clone();
        index.last_opened_document_id = Some(document_id.to_string());
        self.save_index(&index)?;
        Ok(())
    }

    pub fn list_recent_documents(&self) -> AppResult<Vec<DocumentRecord>> {
        self.ensure_ready()?;
        let mut index = self.load_index()?;

        for document in &mut index.documents {
            let sidecar_path = self.sidecar_path(document);
            if sidecar_path.exists() {
                let state = self.read_state(document)?;
                document.last_opened_at = state.last_opened_at.clone();
            }
        }

        index.documents.sort_by(|left, right| {
            right
                .last_opened_at
                .as_deref()
                .unwrap_or("")
                .cmp(left.last_opened_at.as_deref().unwrap_or(""))
        });

        Ok(index.documents)
    }

    fn load_index(&self) -> AppResult<LibraryIndex> {
        self.ensure_ready()?;
        let raw = fs::read_to_string(&self.index_path)?;
        let mut index: LibraryIndex = serde_json::from_str(&raw)?;

        if !index.folders.iter().any(|folder| folder.id == ROOT_FOLDER_ID) {
            index.folders.insert(
                0,
                FolderRecord {
                    id: ROOT_FOLDER_ID.to_string(),
                    name: "Library".to_string(),
                    parent_id: None,
                    created_at: timestamp(),
                },
            );
        }

        Ok(index)
    }

    fn save_index(&self, index: &LibraryIndex) -> AppResult<()> {
        if let Some(parent) = self.index_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let raw = serde_json::to_string_pretty(index)?;
        fs::write(&self.index_path, raw)?;
        Ok(())
    }

    fn build_tree(&self, index: &LibraryIndex, folder_id: &str) -> AppResult<FolderTreeNode> {
        let folder = self.folder_from_index(index, folder_id)?.clone();
        let mut folders = index
            .folders
            .iter()
            .filter(|candidate| candidate.parent_id.as_deref() == Some(folder_id))
            .map(|candidate| self.build_tree(index, &candidate.id))
            .collect::<AppResult<Vec<_>>>()?;
        folders.sort_by(|left, right| left.folder.name.cmp(&right.folder.name));

        let mut documents = index
            .documents
            .iter()
            .filter(|document| document.folder_id == folder_id)
            .cloned()
            .collect::<Vec<_>>();
        documents.sort_by(|left, right| left.title.cmp(&right.title));

        Ok(FolderTreeNode {
            folder,
            folders,
            documents,
        })
    }

    fn folder_from_index<'a>(
        &self,
        index: &'a LibraryIndex,
        folder_id: &str,
    ) -> AppResult<&'a FolderRecord> {
        index
            .folders
            .iter()
            .find(|folder| folder.id == folder_id)
            .ok_or_else(|| AppError::FolderNotFound(folder_id.to_string()))
    }

    fn folder_path(
        &self,
        index: &LibraryIndex,
        folder_id: &str,
        transient: Option<&FolderRecord>,
    ) -> AppResult<PathBuf> {
        if folder_id == ROOT_FOLDER_ID {
            return Ok(self.library_dir.clone());
        }

        let folder = match transient {
            Some(folder) if folder.id == folder_id => folder.clone(),
            _ => self.folder_from_index(index, folder_id)?.clone(),
        };

        let parent_path = match folder.parent_id.as_deref() {
            Some(parent_id) if parent_id != ROOT_FOLDER_ID => self.folder_path(index, parent_id, transient)?,
            _ => self.library_dir.clone(),
        };

        Ok(parent_path.join(self.folder_directory_name(&folder)))
    }

    fn folder_directory_name(&self, folder: &FolderRecord) -> String {
        let cleaned = sanitize(&folder.name);
        let prefix = &folder.id[..8];
        if cleaned.is_empty() {
            format!("folder-{prefix}")
        } else {
            format!("{cleaned}-{prefix}")
        }
    }

    fn unique_pdf_path(&self, directory: &Path, original_name: &str) -> PathBuf {
        let base_name = sanitize(
            Path::new(original_name)
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("document"),
        );
        let extension = Path::new(original_name)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("pdf");

        let mut counter = 1;
        loop {
            let candidate_name = if counter == 1 {
                format!("{base_name}.{extension}")
            } else {
                format!("{base_name} ({counter}).{extension}")
            };
            let candidate_path = directory.join(candidate_name);
            if !candidate_path.exists() {
                return candidate_path;
            }
            counter += 1;
        }
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

    fn pdf_path(&self, document: &DocumentRecord) -> PathBuf {
        self.library_dir.join(&document.relative_path)
    }

    fn sidecar_path(&self, document: &DocumentRecord) -> PathBuf {
        self.library_dir.join(&document.sidecar_relative_path)
    }

    fn sidecar_path_for_pdf(&self, pdf_path: &Path) -> PathBuf {
        let file_name = pdf_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("document.pdf");
        pdf_path.with_file_name(format!("{file_name}.reader.json"))
    }

    fn relative_to_library(&self, full_path: &Path) -> AppResult<String> {
        Ok(full_path
            .strip_prefix(&self.library_dir)?
            .to_string_lossy()
            .replace('\\', "/"))
    }

    fn read_state(&self, document: &DocumentRecord) -> AppResult<DocumentState> {
        let sidecar_path = self.sidecar_path(document);
        if !sidecar_path.exists() {
            let fallback = DocumentState {
                version: 1,
                document_id: document.id.clone(),
                fingerprint: document.fingerprint.clone(),
                last_opened_at: document.last_opened_at.clone(),
                last_page: 1,
                zoom: 1.0,
                bookmarks: Vec::<Bookmark>::new(),
                preferences: ReaderPreferences::default(),
            };
            self.write_state(&sidecar_path, &fallback)?;
            return Ok(fallback);
        }
        let raw = fs::read_to_string(sidecar_path)?;
        let state = serde_json::from_str(&raw)?;
        Ok(state)
    }

    fn write_state(&self, sidecar_path: &Path, state: &DocumentState) -> AppResult<()> {
        if let Some(parent) = sidecar_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let raw = serde_json::to_string_pretty(state)?;
        let mut file = File::create(sidecar_path)?;
        file.write_all(raw.as_bytes())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, path::Path};

    use tempfile::tempdir;

    use super::LibraryStore;
    use crate::models::{DocumentState, ROOT_FOLDER_ID};

    fn write_sample_pdf(path: &Path, label: &str) {
        fs::write(path, format!("%PDF-1.4\n{label}\n%%EOF")).unwrap();
    }

    #[test]
    fn imports_pdf_into_library_and_creates_sidecar() {
        let temp = tempdir().unwrap();
        let source = temp.path().join("source.pdf");
        write_sample_pdf(&source, "hello");

        let store = LibraryStore::new(temp.path().join("app"));
        let record = store.import_pdf(&source, Some(ROOT_FOLDER_ID)).unwrap();

        assert!(store.list_library().unwrap().documents.iter().any(|document| document.id == record.id));
        assert!(temp
            .path()
            .join("app")
            .join("library")
            .join(&record.relative_path)
            .exists());
        assert!(temp
            .path()
            .join("app")
            .join("library")
            .join(&record.sidecar_relative_path)
            .exists());
    }

    #[test]
    fn creates_folder_and_moves_document() {
        let temp = tempdir().unwrap();
        let source = temp.path().join("paper.pdf");
        write_sample_pdf(&source, "paper");

        let store = LibraryStore::new(temp.path().join("app"));
        let folder = store.create_folder("Work", Some(ROOT_FOLDER_ID)).unwrap();
        let record = store.import_pdf(&source, Some(ROOT_FOLDER_ID)).unwrap();
        let moved = store.move_document(&record.id, &folder.id).unwrap();

        assert_eq!(moved.folder_id, folder.id);
        assert!(temp
            .path()
            .join("app")
            .join("library")
            .join(&moved.relative_path)
            .exists());
    }

    #[test]
    fn persists_sidecar_state_updates() {
        let temp = tempdir().unwrap();
        let source = temp.path().join("annotated.pdf");
        write_sample_pdf(&source, "annotated");

        let store = LibraryStore::new(temp.path().join("app"));
        let record = store.import_pdf(&source, Some(ROOT_FOLDER_ID)).unwrap();
        let payload = store.open_document(&record.id).unwrap();

        let mut state = payload.state.clone();
        state.last_page = 8;
        state.zoom = 1.35;
        store.save_document_state(&record.id, state.clone()).unwrap();

        let reopened = store.open_document(&record.id).unwrap();
        assert_eq!(reopened.state.last_page, 8);
        assert!((reopened.state.zoom - 1.35).abs() < f32::EPSILON);
    }

    #[test]
    fn recent_documents_are_sorted_by_last_opened() {
        let temp = tempdir().unwrap();
        let source_a = temp.path().join("a.pdf");
        let source_b = temp.path().join("b.pdf");
        write_sample_pdf(&source_a, "a");
        write_sample_pdf(&source_b, "b");

        let store = LibraryStore::new(temp.path().join("app"));
        let first = store.import_pdf(&source_a, Some(ROOT_FOLDER_ID)).unwrap();
        let second = store.import_pdf(&source_b, Some(ROOT_FOLDER_ID)).unwrap();

        store.open_document(&first.id).unwrap();
        store.open_document(&second.id).unwrap();

        let recents = store.list_recent_documents().unwrap();
        assert_eq!(recents.first().map(|document| document.id.as_str()), Some(second.id.as_str()));
    }

    #[test]
    fn rejects_state_for_wrong_document_id() {
        let temp = tempdir().unwrap();
        let source = temp.path().join("wrong.pdf");
        write_sample_pdf(&source, "wrong");

        let store = LibraryStore::new(temp.path().join("app"));
        let record = store.import_pdf(&source, Some(ROOT_FOLDER_ID)).unwrap();

        let state = DocumentState::new("something-else".to_string(), record.fingerprint.clone());
        let error = store.save_document_state(&record.id, state).unwrap_err();
        assert!(error.to_string().contains("document id"));
    }
}
