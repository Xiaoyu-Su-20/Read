use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tempfile::tempdir;

use crate::{
    models::RenderVariant,
    normalization::manifest::{
        CanonicalFrame, DocumentNormalizationManifest, NormalizationRect, NormalizationStatus,
        PageClassification, PageNormalizationEntry, NORMALIZATION_ALGORITHM_VERSION,
        NORMALIZATION_SCHEMA_VERSION,
    },
};

use super::{
    super::{LibraryStore, RenderCache, DEFAULT_COLLECTION_ID},
    support::{
        create_render_cache, create_render_sessions, create_render_sessions_with_budget,
        write_valid_pdf, write_valid_pdf_pages,
    },
};

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
    let record = store
        .import_pdf(&source, Some(DEFAULT_COLLECTION_ID))
        .unwrap();
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
    let record = store
        .import_pdf(&source, Some(DEFAULT_COLLECTION_ID))
        .unwrap();
    let render_cache = create_render_cache();

    let first = store
        .render_pdf_page(&record.id, 1, 1.0, render_cache.clone())
        .unwrap();

    let second = store
        .render_pdf_page(&record.id, 1, 1.0, render_cache)
        .unwrap();

    assert_eq!(first.cache_key, second.cache_key);
    assert_eq!(second.page_number, 1);
    assert_eq!(second.render_variant, RenderVariant::Raw);
    assert_eq!(first.image_bytes, second.image_bytes);
    assert!(!second.image_bytes.is_empty());
}

#[test]
fn render_pdf_page_reuses_display_list_between_zoom_levels() {
    let temp = tempdir().unwrap();
    let source = temp.path().join("display-list.pdf");
    write_valid_pdf(&source, "Display list reuse");

    let store = LibraryStore::new(temp.path().join("app"), temp.path().join("Reader"));
    let record = store
        .import_pdf(&source, Some(DEFAULT_COLLECTION_ID))
        .unwrap();
    let render_cache = create_render_cache();
    let render_sessions = create_render_sessions();

    let first = store
        .render_pdf_page_with_sessions(
            &record.id,
            1,
            1.0,
            render_cache.clone(),
            render_sessions.clone(),
        )
        .unwrap();
    let second = store
        .render_pdf_page_with_sessions(&record.id, 1, 1.25, render_cache, render_sessions.clone())
        .unwrap();

    assert_eq!(first.page_number, 1);
    assert_eq!(second.page_number, 1);
    let stats = render_sessions
        .stats_for_fingerprint(&record.fingerprint)
        .unwrap();
    assert_eq!(stats.misses, 1);
    assert_eq!(stats.hits, 1);
    assert_eq!(stats.loaded_count, 1);
    assert!(stats.estimated_bytes > 0);
    assert!(stats.entry_pages.contains(&1));
}

#[test]
fn native_text_page_uses_render_session_display_list() {
    let temp = tempdir().unwrap();
    let source = temp.path().join("native-text.pdf");
    write_valid_pdf(&source, "Native text path");

    let store = LibraryStore::new(temp.path().join("app"), temp.path().join("Reader"));
    let record = store
        .import_pdf(&source, Some(DEFAULT_COLLECTION_ID))
        .unwrap();
    let render_sessions = create_render_sessions();
    let request = store
        .prepare_native_text_page_request(&record.id, 1)
        .unwrap();

    let first = render_sessions
        .get_native_text_page(request.clone())
        .unwrap();
    let second = render_sessions.get_native_text_page(request).unwrap();

    assert_eq!(first.page_number, 1);
    assert!(first.source_width > 0.0);
    assert!(first.source_height > 0.0);
    assert!(!first.lines.is_empty());
    assert!(first.lines.iter().any(|line| line.text.contains("Native")));
    assert_eq!(first, second);

    let stats = render_sessions
        .stats_for_fingerprint(&record.fingerprint)
        .unwrap();
    assert_eq!(stats.misses, 1);
    assert_eq!(stats.hits, 0);
    assert_eq!(stats.loaded_count, 1);
}

#[test]
fn render_pdf_page_uses_ready_normalization_manifest() {
    use std::fs;

    let temp = tempdir().unwrap();
    let source = temp.path().join("normalized.pdf");
    write_valid_pdf(&source, "Normalize me");
    let app_dir = temp.path().join("app");
    let store = LibraryStore::new(&app_dir, temp.path().join("Reader"));
    let record = store
        .import_pdf(&source, Some(DEFAULT_COLLECTION_ID))
        .unwrap();
    let manifest = DocumentNormalizationManifest {
        document_id: record.id.clone(),
        fingerprint: record.fingerprint.clone(),
        schema_version: NORMALIZATION_SCHEMA_VERSION,
        algorithm_version: NORMALIZATION_ALGORITHM_VERSION.to_string(),
        status: NormalizationStatus::Ready,
        page_count: 1,
        created_at: "now".to_string(),
        updated_at: "now".to_string(),
        completed_at: Some("now".to_string()),
        cache_token: Some("normalization-test".to_string()),
        canonical_frame: Some(CanonicalFrame {
            width: 220.0,
            height: 240.0,
            anchor_policy: "topCenter".to_string(),
            safe_padding: 10.0,
            background_gray: 245,
        }),
        pages: vec![PageNormalizationEntry {
            page_number: 1,
            source_crop_box: NormalizationRect {
                x: 0.0,
                y: 0.0,
                width: 200.0,
                height: 200.0,
            },
            rotation: 0,
            scale: 1.0,
            offset_x: 10.0,
            offset_y: 10.0,
            classification: PageClassification::Body,
            confidence: 0.95,
        }],
        failure: None,
    };
    fs::write(
        app_dir
            .join("page-normalization")
            .join(format!("{}.json", record.id)),
        serde_json::to_vec_pretty(&manifest).unwrap(),
    )
    .unwrap();

    let rendered = store
        .render_pdf_page(&record.id, 1, 1.0, create_render_cache())
        .unwrap();

    assert_eq!(rendered.render_variant, RenderVariant::Normalized);
    assert_eq!(
        rendered.normalization_token.as_deref(),
        Some("normalization-test")
    );
    assert_eq!((rendered.width, rendered.height), (220, 240));
    assert!(rendered.cache_key.contains("normalization-test"));
}

#[test]
fn display_list_warmup_pins_pages_and_evicts_unpinned_entries() {
    let temp = tempdir().unwrap();
    let source = temp.path().join("warm-window.pdf");
    write_valid_pdf_pages(&source, &["One", "Two", "Three", "Four"]);

    let store = LibraryStore::new(temp.path().join("app"), temp.path().join("Reader"));
    let record = store
        .import_pdf(&source, Some(DEFAULT_COLLECTION_ID))
        .unwrap();
    let render_sessions = create_render_sessions_with_budget(170_000);

    let warm_request = store
        .prepare_display_list_warmup_request(&record.id, vec![2, 3])
        .unwrap();
    render_sessions.warm_display_lists(warm_request).unwrap();

    let mut warm_stats = render_sessions
        .stats_for_fingerprint(&record.fingerprint)
        .unwrap();
    warm_stats.entry_pages.sort_unstable();
    warm_stats.pinned_pages.sort_unstable();
    assert_eq!(warm_stats.entry_pages, vec![2, 3]);
    assert_eq!(warm_stats.pinned_pages, vec![2, 3]);

    store
        .render_pdf_page_with_sessions(
            &record.id,
            4,
            1.0,
            create_render_cache(),
            render_sessions.clone(),
        )
        .unwrap();

    let mut stats = render_sessions
        .stats_for_fingerprint(&record.fingerprint)
        .unwrap();
    stats.entry_pages.sort_unstable();
    assert_eq!(stats.entry_pages, vec![2, 3]);
    assert_eq!(stats.loaded_count, 3);
}

#[test]
fn open_document_reports_lightweight_page_count() {
    let temp = tempdir().unwrap();
    let source = temp.path().join("paged.pdf");
    write_valid_pdf_pages(&source, &["One", "Two", "Three"]);

    let store = LibraryStore::new(temp.path().join("app"), temp.path().join("Reader"));
    let record = store
        .import_pdf(&source, Some(DEFAULT_COLLECTION_ID))
        .unwrap();
    let payload = store.open_document(&record.id).unwrap();

    assert_eq!(payload.page_count, 3);
    assert_eq!(payload.state.last_page, 1);
}

#[test]
fn render_cache_evicts_oldest_entries_beyond_the_byte_budget() {
    let mut cache = RenderCache::with_byte_budget(8);

    for page_number in 1..=3 {
        let request = super::super::PageRenderRequest {
            document_id: "doc".to_string(),
            document_generation_id: None,
            fingerprint: "fingerprint".to_string(),
            document_path: "doc.pdf".to_string(),
            page_number,
            request_sequence: None,
            request_id: None,
            cancellation: None,
            expected_normalization_token: None,
            expected_render_variant: None,
            expected_rotation: None,
            zoom: 1.0,
            cache_key: format!("doc:{page_number}:1.00"),
            normalization: None,
        };

        cache.insert(
            &request,
            600,
            800,
            600.0,
            800.0,
            vec![page_number as u8; 4],
            crate::models::RenderVariant::Raw,
            None,
            crate::models::TextLayerTransform {
                source_width: 600.0,
                source_height: 800.0,
                matrix: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
            },
        );
    }

    let cache_keys = cache.cache_keys();

    assert_eq!(cache_keys.len(), 2);
    assert_eq!(cache.resident_bytes(), 8);
    assert!(!cache_keys.contains(&"doc:1:1.00".to_string()));
    assert!(cache_keys.contains(&"doc:3:1.00".to_string()));
}

#[test]
fn cancelled_render_stops_before_cache_lookup() {
    let cancellation = Arc::new(AtomicBool::new(false));
    cancellation.store(true, Ordering::Release);
    let request = super::super::PageRenderRequest {
        document_id: "doc".to_string(),
        document_generation_id: Some("session".to_string()),
        fingerprint: "fingerprint".to_string(),
        document_path: "missing.pdf".to_string(),
        page_number: 1,
        request_sequence: Some(1),
        request_id: Some("request-1".to_string()),
        cancellation: Some(cancellation),
        expected_normalization_token: None,
        expected_render_variant: None,
        expected_rotation: None,
        zoom: 1.0,
        cache_key: "doc:1:1.00".to_string(),
        normalization: None,
    };

    let error = LibraryStore::render_pdf_page_blocking(
        request,
        create_render_cache(),
        create_render_sessions(),
    )
    .unwrap_err();

    assert!(error.to_string().contains("cancelled"));
}

#[test]
fn fresh_same_key_render_succeeds_after_cancelled_independent_request() {
    let temp = tempdir().unwrap();
    let source = temp.path().join("cancelled-then-fresh.pdf");
    write_valid_pdf(&source, "Fresh request must render");

    let store = LibraryStore::new(temp.path().join("app"), temp.path().join("Reader"));
    let record = store
        .import_pdf(&source, Some(DEFAULT_COLLECTION_ID))
        .unwrap();
    let manifest_cache = Arc::new(Mutex::new(Default::default()));
    let render_cache = create_render_cache();
    let render_sessions = create_render_sessions();

    let mut cancelled_request = store
        .prepare_render_request(&record.id, 1, 1.0, &manifest_cache)
        .unwrap();
    let cache_key = cancelled_request.cache_key.clone();
    let cancellation = Arc::new(AtomicBool::new(true));
    cancelled_request.request_id = Some("request-a".to_string());
    cancelled_request.cancellation = Some(cancellation);

    let cancelled = LibraryStore::render_pdf_page_blocking(
        cancelled_request,
        render_cache.clone(),
        render_sessions.clone(),
    )
    .unwrap_err();
    assert!(cancelled.to_string().contains("cancelled"));

    let mut fresh_request = store
        .prepare_render_request(&record.id, 1, 1.0, &manifest_cache)
        .unwrap();
    fresh_request.request_id = Some("request-b".to_string());
    assert_eq!(fresh_request.cache_key, cache_key);

    let rendered = LibraryStore::render_pdf_page_blocking(
        fresh_request,
        render_cache.clone(),
        render_sessions,
    )
    .unwrap();

    assert_eq!(rendered.cache_key, cache_key);
    assert!(!rendered.image_bytes.is_empty());
    assert!(render_cache
        .lock()
        .unwrap()
        .cache_keys()
        .contains(&cache_key));
}
