use std::{
    fs,
    fs::File,
    io::Write,
    path::{Component, Path, PathBuf},
};

use serde::Serialize;

use crate::{
    error::{AppError, AppResult},
    models::{DocumentRecord, ROOT_FOLDER_ID},
};

#[derive(Debug, Clone)]
pub struct StorePaths {
    pub app_dir: PathBuf,
    pub library_dir: PathBuf,
    pub library_config_path: PathBuf,
    pub legacy_library_dir: PathBuf,
    pub settings_path: PathBuf,
    pub index_path: PathBuf,
    pub notes_dir: PathBuf,
    pub notes_index_path: PathBuf,
    pub states_dir: PathBuf,
    pub rendered_pages_dir: PathBuf,
    pub page_normalization_dir: PathBuf,
}

impl StorePaths {
    pub fn new(app_dir: impl AsRef<Path>, library_dir: impl AsRef<Path>) -> Self {
        let app_dir = app_dir.as_ref().to_path_buf();
        let library_dir = library_dir.as_ref().to_path_buf();

        Self {
            library_dir,
            library_config_path: app_dir.join("library-root.json"),
            legacy_library_dir: app_dir.join("library"),
            settings_path: app_dir.join("app-settings.json"),
            index_path: app_dir.join("library-index.json"),
            notes_dir: app_dir.join("notes"),
            notes_index_path: app_dir.join("notes").join("index.json"),
            states_dir: app_dir.join("document-states"),
            rendered_pages_dir: app_dir.join("rendered-pages"),
            page_normalization_dir: app_dir.join("page-normalization"),
            app_dir,
        }
    }

    pub fn ensure_storage_dirs(&self) -> AppResult<()> {
        fs::create_dir_all(&self.app_dir)?;
        fs::create_dir_all(&self.notes_dir)?;
        fs::create_dir_all(&self.states_dir)?;
        fs::create_dir_all(&self.rendered_pages_dir)?;
        fs::create_dir_all(&self.page_normalization_dir)?;
        fs::create_dir_all(&self.library_dir)?;
        Ok(())
    }

    pub fn library_root_path(&self) -> PathBuf {
        self.library_dir.clone()
    }

    pub fn state_path(&self, document_id: &str) -> PathBuf {
        self.states_dir.join(format!("{document_id}.json"))
    }

    pub fn note_path(&self, note_id: &str) -> PathBuf {
        self.notes_dir.join(format!("{note_id}.json"))
    }

    pub fn normalization_manifest_path(&self, document_id: &str) -> PathBuf {
        self.page_normalization_dir
            .join(format!("{document_id}.json"))
    }

    pub fn relative_to_root(&self, root: &Path, full_path: &Path) -> AppResult<String> {
        Ok(full_path
            .strip_prefix(root)?
            .to_string_lossy()
            .replace('\\', "/"))
    }

    pub fn resolve_folder_path(&self, root: &Path, folder_id: &str) -> AppResult<PathBuf> {
        if folder_id == ROOT_FOLDER_ID {
            return Ok(root.to_path_buf());
        }

        self.validate_relative_path(folder_id)?;
        Ok(root.join(folder_id))
    }

    pub fn resolve_collection_path(&self, root: &Path, folder_id: &str) -> AppResult<PathBuf> {
        self.ensure_collection_id(folder_id)?;
        self.resolve_folder_path(root, folder_id)
    }

    pub fn absolute_document_path(&self, root: &Path, document: &DocumentRecord) -> PathBuf {
        root.join(&document.relative_path)
    }

    pub fn folder_id_from_relative_path(&self, relative_path: &str) -> String {
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

    pub fn validate_relative_path(&self, value: &str) -> AppResult<()> {
        let path = Path::new(value);
        if path.is_absolute() {
            return Err(AppError::InvalidInput(
                "Expected a relative library path.".to_string(),
            ));
        }

        for component in path.components() {
            match component {
                Component::Normal(_) => {}
                _ => return Err(AppError::InvalidInput("Invalid library path.".to_string())),
            }
        }

        Ok(())
    }

    pub fn validate_folder_name(&self, value: &str) -> AppResult<()> {
        if value.is_empty() {
            return Err(AppError::InvalidInput(
                "Folder name cannot be empty.".to_string(),
            ));
        }
        if value.contains('/') || value.contains('\\') {
            return Err(AppError::InvalidInput(
                "Folder names cannot include path separators.".to_string(),
            ));
        }
        Ok(())
    }

    pub fn normalize_pdf_file_name(&self, value: &str) -> AppResult<String> {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return Err(AppError::InvalidInput(
                "File name cannot be empty.".to_string(),
            ));
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

    pub fn unique_pdf_path(&self, directory: &Path, original_name: &str) -> PathBuf {
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

    pub fn is_pdf_path(&self, path: &Path) -> bool {
        path.extension()
            .and_then(|value| value.to_str())
            .map(|value| value.eq_ignore_ascii_case("pdf"))
            == Some(true)
    }

    pub fn move_file(&self, source: &Path, destination: &Path) -> AppResult<()> {
        match fs::rename(source, destination) {
            Ok(()) => Ok(()),
            Err(_) => {
                fs::copy(source, destination)?;
                fs::remove_file(source)?;
                Ok(())
            }
        }
    }

    pub fn move_path(&self, source: &Path, destination: &Path) -> AppResult<()> {
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

    pub fn directory_is_empty(&self, directory: &Path) -> AppResult<bool> {
        Ok(fs::read_dir(directory)?.next().is_none())
    }

    pub fn ensure_collection_parent(&self, folder_id: &str) -> AppResult<()> {
        if folder_id == ROOT_FOLDER_ID {
            return Ok(());
        }

        Err(AppError::InvalidInput(
            "Collections can only be created at the library root.".to_string(),
        ))
    }

    pub fn ensure_collection_id(&self, folder_id: &str) -> AppResult<()> {
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

    pub fn write_json_atomically<T: Serialize>(&self, path: &Path, value: &T) -> AppResult<()> {
        let raw = serde_json::to_string_pretty(value)?;
        self.write_string_atomically(path, &raw)
    }

    pub fn write_string_atomically(&self, path: &Path, raw: &str) -> AppResult<()> {
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
