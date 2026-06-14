use std::{
    collections::HashMap,
    path::Path,
    sync::{Arc, Mutex},
};

use crate::{
    error::{AppError, AppResult},
    store::paths::StorePaths,
};

pub mod analyzer;
pub mod detection;
pub mod manifest;
pub mod transform;
pub mod worker;

pub use manifest::{DocumentNormalizationManifest, PageNormalizationEntry};
pub use worker::{NormalizationJob, NormalizationWorker};

pub type ManifestCache = Arc<Mutex<HashMap<String, Arc<DocumentNormalizationManifest>>>>;

pub fn new_manifest_cache() -> ManifestCache {
    Arc::new(Mutex::new(HashMap::new()))
}

pub fn ready_manifest_for(
    paths: &StorePaths,
    cache: &ManifestCache,
    document_id: &str,
    fingerprint: &str,
) -> AppResult<Option<Arc<DocumentNormalizationManifest>>> {
    if let Some(cached) = cache
        .lock()
        .map_err(|_| AppError::Normalization("Unable to lock normalization cache.".to_string()))?
        .get(document_id)
        .cloned()
    {
        if cached.is_current_ready(fingerprint) {
            return Ok(Some(cached));
        }
    }

    let path = paths.normalization_manifest_path(document_id);
    if !Path::new(&path).exists() {
        return Ok(None);
    }
    let manifest = match manifest::load_manifest(&path) {
        Ok(manifest) if manifest.is_current_ready(fingerprint) => Arc::new(manifest),
        _ => return Ok(None),
    };
    cache
        .lock()
        .map_err(|_| AppError::Normalization("Unable to lock normalization cache.".to_string()))?
        .insert(document_id.to_string(), manifest.clone());
    Ok(Some(manifest))
}
