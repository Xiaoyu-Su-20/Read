use std::{
    collections::{HashMap, VecDeque},
    path::PathBuf,
    sync::{Arc, Condvar, Mutex},
    thread,
};

use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter};

use crate::{
    debug::process as debug_process,
    error::{AppError, AppResult},
    store::{paths::StorePaths, timestamp},
};

use super::{
    analyzer::analyze_document,
    manifest::{
        load_manifest, DocumentNormalizationManifest, NormalizationStatus,
        NORMALIZATION_ALGORITHM_VERSION,
    },
    ManifestCache,
};

#[derive(Debug, Clone)]
pub struct NormalizationJob {
    pub document_id: String,
    pub fingerprint: String,
    pub document_path: PathBuf,
    pub page_count: u32,
}

#[derive(Debug, Clone)]
struct JobFollower {
    document_id: String,
    fingerprint: String,
    page_count: u32,
}

#[derive(Debug)]
struct JobGroup {
    source_path: PathBuf,
    fingerprint: String,
    followers: Vec<JobFollower>,
}

#[derive(Debug, Default)]
struct QueueState {
    queued_keys: VecDeque<String>,
    groups: HashMap<String, JobGroup>,
}

#[derive(Debug, Clone)]
pub struct NormalizationWorker {
    queue: Arc<(Mutex<QueueState>, Condvar)>,
    paths: StorePaths,
    cache: ManifestCache,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NormalizationReadyEvent {
    document_id: String,
    fingerprint: String,
    token: String,
}

impl NormalizationWorker {
    pub fn start(app: AppHandle, paths: StorePaths, cache: ManifestCache) -> Self {
        let queue = Arc::new((Mutex::new(QueueState::default()), Condvar::new()));
        let worker_queue = queue.clone();
        let worker_paths = paths.clone();
        let worker_cache = cache.clone();

        thread::Builder::new()
            .name("page-normalization".to_string())
            .spawn(move || loop {
                let (key, source_path, fingerprint) = {
                    let (lock, ready) = &*worker_queue;
                    let mut state = match lock.lock() {
                        Ok(state) => state,
                        Err(_) => return,
                    };
                    while state.queued_keys.is_empty() {
                        state = match ready.wait(state) {
                            Ok(state) => state,
                            Err(_) => return,
                        };
                    }
                    let Some(key) = state.queued_keys.pop_front() else {
                        continue;
                    };
                    let Some(group) = state.groups.get(&key) else {
                        continue;
                    };
                    (key, group.source_path.clone(), group.fingerprint.clone())
                };

                let process = debug_process(
                    "normalization.worker",
                    json!({
                        "fingerprint": fingerprint,
                        "sourcePath": source_path.to_string_lossy(),
                    }),
                );
                let analysis = analyze_document("shared", &fingerprint, &source_path);

                let followers = {
                    let (lock, _) = &*worker_queue;
                    match lock.lock() {
                        Ok(mut state) => state
                            .groups
                            .remove(&key)
                            .map(|group| group.followers)
                            .unwrap_or_default(),
                        Err(_) => Vec::new(),
                    }
                };

                match analysis {
                    Ok(template) => {
                        process.checkpoint(
                            "analysis-complete",
                            json!({
                                "followerCount": followers.len(),
                                "pageCount": template.page_count,
                            }),
                        );
                        for follower in followers {
                            let mut manifest = template.clone();
                            manifest.document_id = follower.document_id.clone();
                            manifest.fingerprint = follower.fingerprint.clone();
                            if let Err(error) =
                                publish_ready_manifest(&worker_paths, &worker_cache, &app, manifest)
                            {
                                let _ = publish_failed_manifest(
                                    &worker_paths,
                                    &follower,
                                    &error.to_string(),
                                );
                            }
                        }
                        process.finish(json!({}));
                    }
                    Err(error) => {
                        for follower in &followers {
                            let _ = publish_failed_manifest(
                                &worker_paths,
                                follower,
                                &error.to_string(),
                            );
                        }
                        process.fail(
                            &error.to_string(),
                            json!({
                                "followerCount": followers.len(),
                            }),
                        );
                    }
                }
            })
            .expect("unable to start page normalization worker");

        Self {
            queue,
            paths,
            cache,
        }
    }

    pub fn schedule(&self, job: NormalizationJob) -> AppResult<bool> {
        let manifest_path = self.paths.normalization_manifest_path(&job.document_id);
        if manifest_path.exists() {
            if let Ok(manifest) = load_manifest(&manifest_path) {
                if manifest.is_current_ready(&job.fingerprint) {
                    self.cache
                        .lock()
                        .map_err(|_| {
                            AppError::Normalization(
                                "Unable to lock normalization cache.".to_string(),
                            )
                        })?
                        .insert(job.document_id.clone(), Arc::new(manifest));
                    return Ok(false);
                }
            }
        }

        let now = timestamp();
        let processing = DocumentNormalizationManifest::processing(
            job.document_id.clone(),
            job.fingerprint.clone(),
            job.page_count,
            now,
        );
        self.paths
            .write_json_atomically(&manifest_path, &processing)?;
        self.cache
            .lock()
            .map_err(|_| {
                AppError::Normalization("Unable to lock normalization cache.".to_string())
            })?
            .remove(&job.document_id);

        let key = format!("{}:{NORMALIZATION_ALGORITHM_VERSION}", job.fingerprint);
        let follower = JobFollower {
            document_id: job.document_id,
            fingerprint: job.fingerprint.clone(),
            page_count: job.page_count,
        };
        let (lock, ready) = &*self.queue;
        let mut state = lock.lock().map_err(|_| {
            AppError::Normalization("Unable to lock normalization queue.".to_string())
        })?;
        if let Some(group) = state.groups.get_mut(&key) {
            if !group
                .followers
                .iter()
                .any(|existing| existing.document_id == follower.document_id)
            {
                group.followers.push(follower);
            }
            return Ok(true);
        }
        state.groups.insert(
            key.clone(),
            JobGroup {
                source_path: job.document_path,
                fingerprint: job.fingerprint,
                followers: vec![follower],
            },
        );
        state.queued_keys.push_back(key);
        ready.notify_one();
        Ok(true)
    }
}

fn publish_ready_manifest(
    paths: &StorePaths,
    cache: &ManifestCache,
    app: &AppHandle,
    manifest: DocumentNormalizationManifest,
) -> AppResult<()> {
    manifest.validate_ready()?;
    let document_id = manifest.document_id.clone();
    let fingerprint = manifest.fingerprint.clone();
    let token = manifest.cache_token.clone().unwrap_or_default();
    paths.write_json_atomically(&paths.normalization_manifest_path(&document_id), &manifest)?;
    cache
        .lock()
        .map_err(|_| AppError::Normalization("Unable to lock normalization cache.".to_string()))?
        .insert(document_id.clone(), Arc::new(manifest));
    app.emit(
        "page-normalization-ready",
        NormalizationReadyEvent {
            document_id,
            fingerprint,
            token,
        },
    )
    .map_err(|error| {
        AppError::Normalization(format!("Unable to emit normalization event: {error}"))
    })?;
    Ok(())
}

fn publish_failed_manifest(
    paths: &StorePaths,
    follower: &JobFollower,
    error: &str,
) -> AppResult<()> {
    let now = timestamp();
    let mut manifest = DocumentNormalizationManifest::processing(
        follower.document_id.clone(),
        follower.fingerprint.clone(),
        follower.page_count,
        now.clone(),
    );
    manifest.status = NormalizationStatus::Failed;
    manifest.updated_at = now;
    manifest.failure = Some(error.to_string());
    paths.write_json_atomically(
        &paths.normalization_manifest_path(&follower.document_id),
        &manifest,
    )
}
