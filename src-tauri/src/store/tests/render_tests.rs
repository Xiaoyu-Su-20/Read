use std::fs;

use tempfile::tempdir;

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
    fs::write(&first.image_path, b"sentinel").unwrap();

    let second = store
        .render_pdf_page(&record.id, 1, 1.0, render_cache)
        .unwrap();
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
    let record = store
        .import_pdf(&source, Some(DEFAULT_COLLECTION_ID))
        .unwrap();
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
        let request = super::super::PageRenderRequest {
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
        cache.cache_keys()
    };

    assert_eq!(cache_keys.len(), MAX_RENDER_CACHE_ENTRIES);
    assert!(!cache_keys.contains(&"doc:1:1.00".to_string()));
    assert!(cache_keys.contains(&format!("doc:{}:1.00", MAX_RENDER_CACHE_ENTRIES + 1)));
}
