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
    super::{LibraryStore, DEFAULT_COLLECTION_ID, MAX_RENDER_CACHE_ENTRIES},
    support::{create_render_cache, write_valid_pdf, write_valid_pdf_pages},
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
fn render_cache_evicts_oldest_entries_beyond_the_limit() {
    let render_cache = create_render_cache();

    for page_number in 1..=(MAX_RENDER_CACHE_ENTRIES as u32 + 1) {
        let request = super::super::PageRenderRequest {
            document_id: "doc".to_string(),
            document_generation_id: None,
            fingerprint: "fingerprint".to_string(),
            document_path: "doc.pdf".to_string(),
            page_number,
            request_sequence: None,
            zoom: 1.0,
            cache_key: format!("doc:{page_number}:1.00"),
            normalization: None,
        };

        let mut cache = render_cache.lock().unwrap();
        cache.insert(
            &request,
            600,
            800,
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

    let cache_keys = {
        let cache = render_cache.lock().unwrap();
        cache.cache_keys()
    };

    assert_eq!(cache_keys.len(), MAX_RENDER_CACHE_ENTRIES);
    assert!(!cache_keys.contains(&"doc:1:1.00".to_string()));
    assert!(cache_keys.contains(&format!("doc:{}:1.00", MAX_RENDER_CACHE_ENTRIES + 1)));
}
