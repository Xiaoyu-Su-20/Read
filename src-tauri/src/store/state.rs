use std::{fs, path::Path};

use crate::{
    error::AppResult,
    models::{DocumentRecord, DocumentState},
};

use super::paths::StorePaths;

#[derive(Debug, Clone, Default)]
pub struct DocumentStateStore;

impl DocumentStateStore {
    pub fn load_for(
        &self,
        paths: &StorePaths,
        document: &DocumentRecord,
    ) -> AppResult<DocumentState> {
        let state_path = paths.state_path(&document.id);
        if state_path.exists() {
            let mut state = self.read_state_file(&state_path)?;
            state.document_id = document.id.clone();
            state.fingerprint = document.fingerprint.clone();
            return Ok(state);
        }

        let state = DocumentState::new(document.id.clone(), document.fingerprint.clone());
        self.write_state(paths, &state)?;
        Ok(state)
    }

    pub fn save_for(
        &self,
        paths: &StorePaths,
        document: &DocumentRecord,
        mut state: DocumentState,
    ) -> AppResult<()> {
        state.document_id = document.id.clone();
        state.fingerprint = document.fingerprint.clone();
        self.write_state(paths, &state)
    }

    pub fn merge_for_document(
        &self,
        document: &DocumentRecord,
        private_state: Option<DocumentState>,
    ) -> DocumentState {
        let selected = private_state.unwrap_or_else(|| {
            DocumentState::new(document.id.clone(), document.fingerprint.clone())
        });

        let mut state = selected;
        state.document_id = document.id.clone();
        state.fingerprint = document.fingerprint.clone();
        state.last_page = state.last_page.max(1);
        if state.zoom <= 0.0 {
            state.zoom = 1.0;
        }
        state
    }

    pub fn read_state_file(&self, path: &Path) -> AppResult<DocumentState> {
        let raw = fs::read_to_string(path)?;
        Ok(serde_json::from_str(&raw)?)
    }

    pub fn write_state(&self, paths: &StorePaths, state: &DocumentState) -> AppResult<()> {
        paths.write_json_atomically(&paths.state_path(&state.document_id), state)
    }
}
