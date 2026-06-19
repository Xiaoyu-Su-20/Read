use std::{
    collections::{HashMap, HashSet},
    fs,
    fs::File,
    io::Read,
    path::{Path, PathBuf},
    time::{Instant, UNIX_EPOCH},
};

use serde_json::json;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    debug::process as debug_process,
    error::{AppError, AppResult},
    models::{
        DocumentAvailability, DocumentRecord, FolderRecord, FolderTreeNode, LibraryIndex,
        ROOT_FOLDER_ID,
    },
};

use super::{
    paths::StorePaths, state::DocumentStateStore, timestamp, DEFAULT_COLLECTIONS,
    DEFAULT_COLLECTION_ID,
};

#[derive(Debug, Clone, Default)]
pub struct CatalogStore;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ExistingDocumentMatchKind {
    RelativePath,
    LegacyState,
    Fingerprint,
}

#[derive(Debug, Clone)]
struct ExistingDocumentMatch {
    document: DocumentRecord,
    kind: ExistingDocumentMatchKind,
}

impl CatalogStore {
    pub fn reconcile_library(
        &self,
        paths: &StorePaths,
        states: &DocumentStateStore,
    ) -> AppResult<()> {
        let root = paths.library_root_path();
        let process = debug_process(
            "store.reconcile_library",
            json!({
                "root": root.to_string_lossy().to_string(),
            }),
        );

        let result = (|| -> AppResult<()> {
            let reconcile_started_at = Instant::now();
            let mut index = self.load_index(paths)?;
            process.checkpoint(
                "load-index",
                json!({
                    "documentCount": index.documents.len(),
                    "missingCount": index
                        .documents
                        .iter()
                        .filter(|document| document.availability == DocumentAvailability::Missing)
                        .count(),
                    "duplicateFingerprintCount": Self::duplicate_count_for(
                        index.documents.iter().map(|document| document.fingerprint.as_str())
                    ),
                    "duplicateRelativePathCount": Self::duplicate_count_for(
                        index.documents.iter().map(|document| document.relative_path.as_str())
                    ),
                }),
            );
            let previous_index = index.clone();
            self.ensure_default_library_structure(paths)?;
            process.checkpoint(
                "default-library-ready",
                json!({
                    "elapsedMs": reconcile_started_at.elapsed().as_millis(),
                }),
            );
            let migrated_root_pdfs =
                self.migrate_root_pdfs_into_default_collection(paths, &root)?;
            process.checkpoint(
                "root-pdf-migration",
                json!({
                    "elapsedMs": reconcile_started_at.elapsed().as_millis(),
                    "migratedRootPdfCount": migrated_root_pdfs,
                }),
            );
            let collection_paths = self.collection_paths(&root)?;
            let mut pdf_paths = Vec::new();

            for collection_path in &collection_paths {
                pdf_paths.extend(self.collect_immediate_pdf_paths(paths, collection_path)?);
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
            let mut matched_by_path = 0usize;
            let mut matched_by_legacy_state = 0usize;
            let mut matched_by_fingerprint = 0usize;
            let mut created_documents = 0usize;
            let mut reused_cached_fingerprint_count = 0usize;
            let mut hashed_document_count = 0usize;
            let mut state_reused_same_id = 0usize;
            let mut state_reused_previous_id = 0usize;
            let hash_started_at = Instant::now();
            let mut scanned_documents = Vec::with_capacity(pdf_paths.len());

            for pdf_path in pdf_paths {
                let relative_path = paths.relative_to_root(&root, &pdf_path)?;
                let (file_size_bytes, file_modified_ms) =
                    self.file_metadata_signature(&pdf_path)?;
                let fingerprint = if let Some(existing) =
                    existing_documents.iter().find(|document| {
                        !matched_ids.contains(&document.id)
                            && document.relative_path == relative_path
                            && document.file_size_bytes == Some(file_size_bytes)
                            && document.file_modified_ms == Some(file_modified_ms)
                            && !document.fingerprint.is_empty()
                    }) {
                    reused_cached_fingerprint_count += 1;
                    existing.fingerprint.clone()
                } else {
                    hashed_document_count += 1;
                    self.hash_file(&pdf_path)?
                };
                scanned_documents.push((
                    pdf_path,
                    relative_path,
                    fingerprint,
                    file_size_bytes,
                    file_modified_ms,
                ));
            }
            process.checkpoint(
                "hash-complete",
                json!({
                    "elapsedMs": reconcile_started_at.elapsed().as_millis(),
                    "hashElapsedMs": hash_started_at.elapsed().as_millis(),
                    "hashedDocumentCount": hashed_document_count,
                    "pdfCount": scanned_documents.len(),
                    "reusedCachedFingerprintCount": reused_cached_fingerprint_count,
                }),
            );

            let match_started_at = Instant::now();
            let mut available_document_ids_by_fingerprint = HashMap::new();
            for (pdf_path, relative_path, fingerprint, file_size_bytes, file_modified_ms) in
                scanned_documents
            {
                let existing = self.match_existing_document(
                    &existing_documents,
                    &matched_ids,
                    &relative_path,
                    &fingerprint,
                    None,
                );

                match existing.as_ref().map(|matched| matched.kind) {
                    Some(ExistingDocumentMatchKind::RelativePath) => matched_by_path += 1,
                    Some(ExistingDocumentMatchKind::LegacyState) => matched_by_legacy_state += 1,
                    Some(ExistingDocumentMatchKind::Fingerprint) => matched_by_fingerprint += 1,
                    None => created_documents += 1,
                }

                let existing_id = existing.as_ref().map(|matched| matched.document.id.clone());
                let document_id = existing_id.unwrap_or_else(|| Uuid::new_v4().to_string());

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

                let previous_document_id =
                    existing.as_ref().map(|matched| matched.document.id.clone());
                let mut document =
                    existing
                        .map(|matched| matched.document)
                        .unwrap_or(DocumentRecord {
                            id: document_id.clone(),
                            title: title.clone(),
                            file_name: file_name.clone(),
                            folder_id: paths.folder_id_from_relative_path(&relative_path),
                            relative_path: relative_path.clone(),
                            fingerprint: fingerprint.clone(),
                            file_size_bytes: Some(file_size_bytes),
                            file_modified_ms: Some(file_modified_ms),
                            imported_at: timestamp(),
                            last_opened_at: None,
                            availability: DocumentAvailability::Available,
                        });

                document.id = document_id.clone();
                document.title = title;
                document.file_name = file_name;
                document.folder_id = paths.folder_id_from_relative_path(&relative_path);
                document.relative_path = relative_path;
                document.fingerprint = fingerprint;
                document.file_size_bytes = Some(file_size_bytes);
                document.file_modified_ms = Some(file_modified_ms);
                document.availability = DocumentAvailability::Available;

                let private_state = states
                    .read_state_file(&paths.state_path(&document.id))
                    .ok()
                    .or_else(|| {
                        previous_document_id
                            .as_ref()
                            .and_then(|id| states.read_state_file(&paths.state_path(id)).ok())
                    });
                if private_state.is_some() {
                    if previous_document_id.as_deref() == Some(document.id.as_str()) {
                        state_reused_same_id += 1;
                    } else {
                        state_reused_previous_id += 1;
                    }
                }
                let merged_state = states.merge_for_document(&document, private_state);
                document.last_opened_at = merged_state.last_opened_at.clone();
                states.write_state(paths, &merged_state)?;

                if let Some(previous_document_id) = previous_document_id {
                    if previous_document_id != document.id {
                        let previous_state_path = paths.state_path(&previous_document_id);
                        if previous_state_path.exists() {
                            fs::remove_file(previous_state_path)?;
                        }
                    }
                }

                matched_ids.insert(document.id.clone());
                available_document_ids_by_fingerprint
                    .insert(document.fingerprint.clone(), document.id.clone());
                next_documents.push(document);
            }
            process.checkpoint(
                "match-and-state-complete",
                json!({
                    "createdDocumentCount": created_documents,
                    "elapsedMs": reconcile_started_at.elapsed().as_millis(),
                    "matchElapsedMs": match_started_at.elapsed().as_millis(),
                    "matchedByFingerprintCount": matched_by_fingerprint,
                    "matchedByLegacyStateCount": matched_by_legacy_state,
                    "matchedByRelativePathCount": matched_by_path,
                    "stateReusedPreviousIdCount": state_reused_previous_id,
                    "stateReusedSameIdCount": state_reused_same_id,
                }),
            );

            let missing_started_at = Instant::now();
            let mut carried_missing_documents = 0usize;
            let mut removed_stale_missing_documents = 0usize;
            for mut document in existing_documents {
                if matched_ids.contains(&document.id) {
                    continue;
                }

                if let Some(target_document_id) =
                    available_document_ids_by_fingerprint.get(&document.fingerprint)
                {
                    self.merge_stale_state_into_available(
                        paths,
                        states,
                        &mut next_documents,
                        target_document_id,
                        &document.id,
                    )?;
                    let stale_state_path = paths.state_path(&document.id);
                    if stale_state_path.exists() {
                        fs::remove_file(stale_state_path)?;
                    }
                    removed_stale_missing_documents += 1;
                    continue;
                }

                let private_state = states.read_state_file(&paths.state_path(&document.id)).ok();
                let merged_state = states.merge_for_document(&document, private_state);
                document.last_opened_at = merged_state.last_opened_at.clone();
                document.availability = DocumentAvailability::Missing;
                states.write_state(paths, &merged_state)?;
                carried_missing_documents += 1;
                next_documents.push(document);
            }
            process.checkpoint(
                "missing-documents-complete",
                json!({
                    "carriedMissingDocumentCount": carried_missing_documents,
                    "elapsedMs": reconcile_started_at.elapsed().as_millis(),
                    "missingElapsedMs": missing_started_at.elapsed().as_millis(),
                    "removedStaleMissingDocumentCount": removed_stale_missing_documents,
                }),
            );

            index.documents = next_documents;
            process.checkpoint(
                "final-catalog-stats",
                json!({
                    "availableDocumentCount": index
                        .documents
                        .iter()
                        .filter(|document| document.availability == DocumentAvailability::Available)
                        .count(),
                    "documentCount": index.documents.len(),
                    "duplicateFingerprintCount": Self::duplicate_count_for(
                        index.documents.iter().map(|document| document.fingerprint.as_str())
                    ),
                    "duplicateRelativePathCount": Self::duplicate_count_for(
                        index.documents.iter().map(|document| document.relative_path.as_str())
                    ),
                    "missingDocumentCount": index
                        .documents
                        .iter()
                        .filter(|document| document.availability == DocumentAvailability::Missing)
                        .count(),
                }),
            );
            if index != previous_index {
                self.save_index(paths, &index)?;
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

    pub fn create_folder(
        &self,
        paths: &StorePaths,
        name: &str,
        parent_id: Option<&str>,
    ) -> AppResult<FolderRecord> {
        let trimmed = name.trim();
        paths.validate_folder_name(trimmed)?;

        let parent_id = parent_id.unwrap_or(ROOT_FOLDER_ID);
        paths.ensure_collection_parent(parent_id)?;

        let root = paths.library_root_path();
        let parent_path = paths.resolve_folder_path(&root, parent_id)?;
        fs::create_dir_all(&parent_path)?;

        let folder_path = parent_path.join(trimmed);
        if folder_path.exists() {
            return Err(AppError::InvalidInput(format!(
                "A folder named \"{trimmed}\" already exists."
            )));
        }

        fs::create_dir_all(&folder_path)?;
        let relative_path = paths.relative_to_root(&root, &folder_path)?;
        Ok(self.folder_record_for_relative(&relative_path))
    }

    pub fn move_document(
        &self,
        paths: &StorePaths,
        document_id: &str,
        destination_folder_id: &str,
    ) -> AppResult<DocumentRecord> {
        let mut index = self.load_index(paths)?;
        let root = paths.library_root_path();
        let document_index = Self::find_document_index(&index, document_id)?;
        let document = index.documents[document_index].clone();
        self.ensure_document_available(&document)?;

        let destination_folder_path =
            paths.resolve_collection_path(&root, destination_folder_id)?;
        fs::create_dir_all(&destination_folder_path)?;

        let current_path = paths.absolute_document_path(&root, &document);
        let destination_path = paths.unique_pdf_path(&destination_folder_path, &document.file_name);
        paths.move_file(&current_path, &destination_path)?;
        let relative_path = paths.relative_to_root(&root, &destination_path)?;

        index.documents[document_index].folder_id =
            paths.folder_id_from_relative_path(&relative_path);
        index.documents[document_index].relative_path = relative_path;
        index.documents[document_index].availability = DocumentAvailability::Available;
        self.save_index(paths, &index)?;
        Ok(index.documents[document_index].clone())
    }

    pub fn rename_document(
        &self,
        paths: &StorePaths,
        document_id: &str,
        new_name: &str,
    ) -> AppResult<DocumentRecord> {
        let mut index = self.load_index(paths)?;
        let root = paths.library_root_path();
        let document_index = Self::find_document_index(&index, document_id)?;
        let document = index.documents[document_index].clone();
        self.ensure_document_available(&document)?;

        let current_path = paths.absolute_document_path(&root, &document);
        let parent = current_path.parent().ok_or_else(|| {
            AppError::InvalidInput("Unable to resolve the document folder.".to_string())
        })?;
        let normalized_name = paths.normalize_pdf_file_name(new_name)?;

        if normalized_name.eq_ignore_ascii_case(&document.file_name) {
            return Ok(document);
        }

        let destination_path = paths.unique_pdf_path(parent, &normalized_name);
        paths.move_file(&current_path, &destination_path)?;

        let relative_path = paths.relative_to_root(&root, &destination_path)?;
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
        self.save_index(paths, &index)?;
        Ok(index.documents[document_index].clone())
    }

    pub fn rename_folder(
        &self,
        paths: &StorePaths,
        folder_id: &str,
        new_name: &str,
    ) -> AppResult<FolderRecord> {
        if folder_id == ROOT_FOLDER_ID {
            return Err(AppError::InvalidInput(
                "The library root cannot be renamed.".to_string(),
            ));
        }
        paths.ensure_collection_id(folder_id)?;

        let trimmed = new_name.trim();
        paths.validate_folder_name(trimmed)?;

        let root = paths.library_root_path();
        let current_path = paths.resolve_folder_path(&root, folder_id)?;
        let parent = current_path.parent().ok_or_else(|| {
            AppError::InvalidInput("Unable to resolve the folder parent.".to_string())
        })?;
        let destination_path = parent.join(trimmed);

        if destination_path.exists() {
            return Err(AppError::InvalidInput(format!(
                "A folder named \"{trimmed}\" already exists."
            )));
        }

        fs::rename(current_path, &destination_path)?;
        let relative_path = paths.relative_to_root(&root, &destination_path)?;
        let mut index = self.load_index(paths)?;
        self.rename_folder_documents(&mut index, folder_id, &relative_path);
        self.save_index(paths, &index)?;
        Ok(self.folder_record_for_relative(&relative_path))
    }

    pub fn delete_folder(&self, paths: &StorePaths, folder_id: &str) -> AppResult<FolderRecord> {
        if folder_id == ROOT_FOLDER_ID {
            return Err(AppError::InvalidInput(
                "The library root cannot be deleted.".to_string(),
            ));
        }
        paths.ensure_collection_id(folder_id)?;

        let index = self.load_index(paths)?;
        let folder_prefix = format!("{folder_id}/");
        if index.documents.iter().any(|document| {
            document.folder_id == folder_id || document.folder_id.starts_with(&folder_prefix)
        }) {
            return Err(AppError::InvalidInput(
                "Collections with PDFs inside cannot be deleted.".to_string(),
            ));
        }

        let root = paths.library_root_path();
        let folder_path = paths.resolve_folder_path(&root, folder_id)?;
        let deleted = self.folder_record_for_relative(folder_id);

        fs::remove_dir(&folder_path).map_err(|error| {
            if error.kind() == std::io::ErrorKind::DirectoryNotEmpty {
                AppError::InvalidInput("Only empty collections can be deleted.".to_string())
            } else {
                AppError::Io(error)
            }
        })?;

        Ok(deleted)
    }

    pub fn move_document_out_of_library(
        &self,
        paths: &StorePaths,
        document_id: &str,
        destination_directory: &Path,
    ) -> AppResult<DocumentRecord> {
        let mut index = self.load_index(paths)?;
        fs::create_dir_all(destination_directory)?;
        let destination_directory = fs::canonicalize(destination_directory)?;
        let root = paths.library_root_path();
        let canonical_root = fs::canonicalize(&root)?;

        if destination_directory.starts_with(&canonical_root) {
            return Err(AppError::InvalidInput(
                "Choose a destination outside the library folder.".to_string(),
            ));
        }

        let document_index = Self::find_document_index(&index, document_id)?;
        let document = index.documents[document_index].clone();
        self.ensure_document_available(&document)?;

        let source_path = paths.absolute_document_path(&root, &document);
        let destination_path = paths.unique_pdf_path(&destination_directory, &document.file_name);
        paths.move_file(&source_path, &destination_path)?;

        index.documents[document_index].availability = DocumentAvailability::Missing;
        self.save_index(paths, &index)?;
        Ok(index.documents[document_index].clone())
    }

    pub fn list_recent_documents(
        &self,
        paths: &StorePaths,
        states: &DocumentStateStore,
    ) -> AppResult<Vec<DocumentRecord>> {
        let mut index = self.load_index(paths)?;

        for document in &mut index.documents {
            if let Ok(state) = states.load_for(paths, document) {
                document.last_opened_at = state.last_opened_at.clone();
            }
        }

        index.documents.sort_by(|left, right| {
            (right.last_opened_at.as_deref().unwrap_or(""))
                .cmp(left.last_opened_at.as_deref().unwrap_or(""))
        });

        Ok(index.documents)
    }

    pub fn load_index(&self, paths: &StorePaths) -> AppResult<LibraryIndex> {
        let raw = fs::read_to_string(&paths.index_path)?;
        Ok(serde_json::from_str(&raw)?)
    }

    pub fn save_index(&self, paths: &StorePaths, index: &LibraryIndex) -> AppResult<()> {
        let process = debug_process(
            "store.save_index",
            json!({
                "documentCount": index.documents.len(),
                "indexPath": paths.index_path.to_string_lossy().to_string(),
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
            paths.write_string_atomically(&paths.index_path, &raw)?;
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

    pub fn build_tree(
        &self,
        paths: &StorePaths,
        index: &LibraryIndex,
    ) -> AppResult<FolderTreeNode> {
        let root = paths.library_root_path();
        let mut folders = Vec::new();
        for collection_path in self.collection_paths(&root)? {
            let relative_path = paths.relative_to_root(&root, &collection_path)?;
            folders.push(self.build_collection_node(&relative_path, index));
        }

        folders.sort_by(|left, right| left.folder.name.cmp(&right.folder.name));

        Ok(FolderTreeNode {
            folder: self.folder_record_for_relative(""),
            folders,
            documents: Vec::new(),
        })
    }

    pub fn find_document_by_id(
        &self,
        paths: &StorePaths,
        document_id: &str,
    ) -> AppResult<DocumentRecord> {
        let index = self.load_index(paths)?;
        index
            .documents
            .into_iter()
            .find(|document| document.id == document_id)
            .ok_or_else(|| AppError::DocumentNotFound(document_id.to_string()))
    }

    pub fn find_document_index(index: &LibraryIndex, document_id: &str) -> AppResult<usize> {
        index
            .documents
            .iter()
            .position(|document| document.id == document_id)
            .ok_or_else(|| AppError::DocumentNotFound(document_id.to_string()))
    }

    pub fn ensure_document_available(&self, document: &DocumentRecord) -> AppResult<()> {
        if document.availability == DocumentAvailability::Missing {
            return Err(AppError::InvalidInput(format!(
                "This PDF is currently unavailable: {}",
                document.relative_path
            )));
        }

        Ok(())
    }

    fn match_existing_document(
        &self,
        documents: &[DocumentRecord],
        matched_ids: &HashSet<String>,
        relative_path: &str,
        fingerprint: &str,
        legacy_state: Option<&crate::models::DocumentState>,
    ) -> Option<ExistingDocumentMatch> {
        documents
            .iter()
            .find(|document| {
                !matched_ids.contains(&document.id) && document.relative_path == relative_path
            })
            .cloned()
            .map(|document| ExistingDocumentMatch {
                document,
                kind: ExistingDocumentMatchKind::RelativePath,
            })
            .or_else(|| {
                legacy_state.and_then(|state| {
                    documents
                        .iter()
                        .find(|document| {
                            !matched_ids.contains(&document.id) && document.id == state.document_id
                        })
                        .cloned()
                        .map(|document| ExistingDocumentMatch {
                            document,
                            kind: ExistingDocumentMatchKind::LegacyState,
                        })
                })
            })
            .or_else(|| {
                documents
                    .iter()
                    .find(|document| {
                        !matched_ids.contains(&document.id) && document.fingerprint == fingerprint
                    })
                    .cloned()
                    .map(|document| ExistingDocumentMatch {
                        document,
                        kind: ExistingDocumentMatchKind::Fingerprint,
                    })
            })
    }

    fn duplicate_count_for<'a>(values: impl Iterator<Item = &'a str>) -> usize {
        let mut counts = HashMap::new();
        for value in values {
            *counts.entry(value).or_insert(0usize) += 1;
        }

        counts
            .into_values()
            .filter(|count| *count > 1)
            .map(|count| count - 1)
            .sum()
    }

    pub fn file_metadata_signature(&self, path: &Path) -> AppResult<(u64, u64)> {
        let metadata = fs::metadata(path)?;
        let modified_ms = metadata
            .modified()?
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        Ok((metadata.len(), modified_ms))
    }

    fn merge_stale_state_into_available(
        &self,
        paths: &StorePaths,
        states: &DocumentStateStore,
        next_documents: &mut [DocumentRecord],
        target_document_id: &str,
        stale_document_id: &str,
    ) -> AppResult<()> {
        let Some(target_document) = next_documents
            .iter_mut()
            .find(|document| document.id == target_document_id)
        else {
            return Ok(());
        };

        let stale_state_path = paths.state_path(stale_document_id);
        if !stale_state_path.exists() {
            return Ok(());
        }

        let stale_state = states.read_state_file(&stale_state_path).ok();
        if stale_state.is_none() {
            return Ok(());
        }

        let current_state_path = paths.state_path(&target_document.id);
        let current_state = if current_state_path.exists() {
            states.read_state_file(&current_state_path).ok()
        } else {
            None
        };

        let should_promote_stale_state = match (&stale_state, &current_state) {
            (Some(stale), Some(current)) => stale.last_opened_at > current.last_opened_at,
            (Some(_), None) => true,
            _ => false,
        };

        if should_promote_stale_state {
            let merged_state = states.merge_for_document(target_document, stale_state);
            target_document.last_opened_at = merged_state.last_opened_at.clone();
            states.write_state(paths, &merged_state)?;
        }

        Ok(())
    }

    fn migrate_legacy_library_root_if_needed(&self, paths: &StorePaths) -> AppResult<()> {
        if paths.library_dir == paths.legacy_library_dir || !paths.legacy_library_dir.exists() {
            return Ok(());
        }

        if !paths.directory_is_empty(&paths.library_dir)?
            || paths.directory_is_empty(&paths.legacy_library_dir)?
        {
            return Ok(());
        }

        let entries = fs::read_dir(&paths.legacy_library_dir)?.collect::<Result<Vec<_>, _>>()?;
        for entry in entries {
            let source = entry.path();
            let destination = paths.library_dir.join(entry.file_name());
            paths.move_path(&source, &destination)?;
        }

        Ok(())
    }

    pub fn ensure_default_library_structure(&self, paths: &StorePaths) -> AppResult<()> {
        self.migrate_legacy_library_root_if_needed(paths)?;

        if self.collection_paths(&paths.library_dir)?.is_empty() {
            for folder_name in DEFAULT_COLLECTIONS {
                fs::create_dir_all(paths.library_dir.join(folder_name))?;
            }
        }

        Ok(())
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

    fn migrate_root_pdfs_into_default_collection(
        &self,
        paths: &StorePaths,
        root: &Path,
    ) -> AppResult<usize> {
        let destination_directory = root.join(DEFAULT_COLLECTION_ID);
        fs::create_dir_all(&destination_directory)?;
        let pdf_paths = self.collect_immediate_pdf_paths(paths, root)?;
        let mut migrated = 0;

        for pdf_path in pdf_paths {
            let file_name = pdf_path
                .file_name()
                .and_then(|value| value.to_str())
                .ok_or_else(|| AppError::InvalidInput("Invalid PDF file name.".to_string()))?;
            let destination_path = paths.unique_pdf_path(&destination_directory, file_name);
            paths.move_file(&pdf_path, &destination_path)?;
            migrated += 1;
        }

        Ok(migrated)
    }

    fn collect_immediate_pdf_paths(
        &self,
        paths: &StorePaths,
        directory: &Path,
    ) -> AppResult<Vec<PathBuf>> {
        self.collect_immediate_matching_paths(directory, |path| paths.is_pdf_path(path))
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

    pub fn hash_file(&self, path: &Path) -> AppResult<String> {
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
}
