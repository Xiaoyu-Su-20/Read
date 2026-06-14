use std::{fs, thread, time::Duration};

use tempfile::tempdir;

use super::{
    super::{LibraryStore, DEFAULT_COLLECTION_ID},
    support::write_sample_pdf,
};
use crate::models::DocumentState;

#[test]
fn rejects_state_for_wrong_document_id() {
    let temp = tempdir().unwrap();
    let source = temp.path().join("state.pdf");
    write_sample_pdf(&source, "state");

    let store = LibraryStore::new(temp.path().join("app"), temp.path().join("Reader"));
    let record = store
        .import_pdf(&source, Some(DEFAULT_COLLECTION_ID))
        .unwrap();

    let error = store
        .save_document_state(
            &record.id,
            DocumentState::new("another-document".to_string(), record.fingerprint.clone()),
        )
        .unwrap_err();

    assert!(error
        .to_string()
        .contains("document id does not match the target document"));
}

#[test]
fn save_document_state_does_not_require_library_rescan() {
    let temp = tempdir().unwrap();
    let source = temp.path().join("state-preserve.pdf");
    write_sample_pdf(&source, "state-preserve");

    let store = LibraryStore::new(temp.path().join("app"), temp.path().join("Reader"));
    let record = store
        .import_pdf(&source, Some(DEFAULT_COLLECTION_ID))
        .unwrap();

    let imported_path = temp
        .path()
        .join("Reader")
        .join(DEFAULT_COLLECTION_ID)
        .join(&record.file_name);
    let renamed_path = imported_path.with_file_name("state-preserve-renamed.pdf");
    fs::rename(&imported_path, &renamed_path).unwrap();

    let state = DocumentState {
        last_page: 37,
        zoom: 1.4,
        ..DocumentState::new(record.id.clone(), record.fingerprint.clone())
    };

    store.save_document_state(&record.id, state).unwrap();

    let state_path = temp
        .path()
        .join("app")
        .join("document-states")
        .join(format!("{}.json", record.id));
    let persisted: DocumentState =
        serde_json::from_str(&fs::read_to_string(state_path).unwrap()).unwrap();

    assert_eq!(persisted.last_page, 37);
    assert!((persisted.zoom - 1.4).abs() < f32::EPSILON);
}

#[test]
fn save_document_state_does_not_rewrite_library_index() {
    let temp = tempdir().unwrap();
    let source = temp.path().join("state-index.pdf");
    write_sample_pdf(&source, "state-index");

    let app_dir = temp.path().join("app");
    let store = LibraryStore::new(&app_dir, temp.path().join("Reader"));
    let record = store
        .import_pdf(&source, Some(DEFAULT_COLLECTION_ID))
        .unwrap();
    let index_path = app_dir.join("library-index.json");
    let before = fs::metadata(&index_path).unwrap().modified().unwrap();

    thread::sleep(Duration::from_millis(1100));

    store
        .save_document_state(
            &record.id,
            DocumentState {
                last_page: 12,
                zoom: 1.25,
                ..DocumentState::new(record.id.clone(), record.fingerprint.clone())
            },
        )
        .unwrap();

    let after = fs::metadata(&index_path).unwrap().modified().unwrap();
    assert_eq!(after, before);
}
