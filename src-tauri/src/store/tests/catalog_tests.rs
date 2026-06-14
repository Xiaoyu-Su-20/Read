use std::{fs, thread, time::Duration};

use tempfile::tempdir;

use super::{
    super::{LibraryStore, DEFAULT_COLLECTIONS, DEFAULT_COLLECTION_ID},
    support::write_sample_pdf,
};
use crate::models::{DocumentAvailability, ROOT_FOLDER_ID};

#[test]
fn imports_pdf_without_creating_sidecar_files() {
    let temp = tempdir().unwrap();
    let source = temp.path().join("source.pdf");
    write_sample_pdf(&source, "hello");

    let app_dir = temp.path().join("app");
    let store = LibraryStore::new(&app_dir, temp.path().join("Reader"));
    let record = store
        .import_pdf(&source, Some(DEFAULT_COLLECTION_ID))
        .unwrap();

    let imported_path = temp
        .path()
        .join("Reader")
        .join(DEFAULT_COLLECTION_ID)
        .join(&record.file_name);
    let sidecar_path = imported_path.with_extension("pdf.reader.json");

    assert!(imported_path.exists());
    assert!(!sidecar_path.exists());
}

#[test]
fn rescans_preserve_state_after_manual_rename() {
    let temp = tempdir().unwrap();
    let source = temp.path().join("rename-me.pdf");
    write_sample_pdf(&source, "rename");

    let app_dir = temp.path().join("app");
    let store = LibraryStore::new(&app_dir, temp.path().join("Reader"));
    let record = store
        .import_pdf(&source, Some(DEFAULT_COLLECTION_ID))
        .unwrap();
    let renamed_path = temp
        .path()
        .join("Reader")
        .join(DEFAULT_COLLECTION_ID)
        .join("renamed-manually.pdf");

    store
        .save_document_state(
            &record.id,
            crate::models::DocumentState {
                last_page: 42,
                zoom: 1.35,
                ..crate::models::DocumentState::new(record.id.clone(), record.fingerprint.clone())
            },
        )
        .unwrap();

    fs::rename(
        temp.path()
            .join("Reader")
            .join(DEFAULT_COLLECTION_ID)
            .join(&record.file_name),
        &renamed_path,
    )
    .unwrap();

    let library = store.rescan_library().unwrap();
    let renamed = library.folders[0].documents[0].clone();
    let reopened = store.open_document(&renamed.id).unwrap();

    assert_eq!(renamed.file_name, "renamed-manually.pdf");
    assert_eq!(reopened.state.last_page, 42);
    assert!((reopened.state.zoom - 1.35).abs() < f32::EPSILON);
}

#[test]
fn marks_missing_documents_without_dropping_metadata() {
    let temp = tempdir().unwrap();
    let source = temp.path().join("missing.pdf");
    write_sample_pdf(&source, "missing");

    let app_dir = temp.path().join("app");
    let store = LibraryStore::new(&app_dir, temp.path().join("Reader"));
    let record = store
        .import_pdf(&source, Some(DEFAULT_COLLECTION_ID))
        .unwrap();

    fs::remove_file(
        temp.path()
            .join("Reader")
            .join(DEFAULT_COLLECTION_ID)
            .join(&record.file_name),
    )
    .unwrap();

    let _ = store.rescan_library().unwrap();
    let recents = store.list_recent_documents().unwrap();
    let missing = recents
        .iter()
        .find(|document| document.id == record.id)
        .unwrap();

    assert_eq!(missing.availability, DocumentAvailability::Missing);
}

#[test]
fn creates_default_collections_when_library_is_empty() {
    let temp = tempdir().unwrap();
    let store = LibraryStore::new(temp.path().join("app"), temp.path().join("Reader"));

    let library = store.list_library().unwrap();
    let folder_names = library
        .folders
        .iter()
        .map(|node| node.folder.name.clone())
        .collect::<Vec<_>>();

    assert_eq!(folder_names, DEFAULT_COLLECTIONS.to_vec());
}

#[test]
fn migrates_root_level_pdfs_into_collection_one() {
    let temp = tempdir().unwrap();
    let root_pdf = temp.path().join("Reader").join("loose.pdf");
    fs::create_dir_all(root_pdf.parent().unwrap()).unwrap();
    write_sample_pdf(&root_pdf, "loose");

    let store = LibraryStore::new(temp.path().join("app"), temp.path().join("Reader"));
    let library = store.list_library().unwrap();
    let collection_one = library
        .folders
        .iter()
        .find(|node| node.folder.id == DEFAULT_COLLECTION_ID)
        .unwrap();

    assert!(!root_pdf.exists());
    assert!(temp
        .path()
        .join("Reader")
        .join(DEFAULT_COLLECTION_ID)
        .join("loose.pdf")
        .exists());
    assert_eq!(collection_one.documents.len(), 1);
    assert_eq!(collection_one.documents[0].file_name, "loose.pdf");
}

#[test]
fn ignores_nested_folders_when_reconciling_collections() {
    let temp = tempdir().unwrap();
    let nested_dir = temp
        .path()
        .join("Reader")
        .join("Collection 1")
        .join("Nested");
    fs::create_dir_all(&nested_dir).unwrap();
    let nested_pdf = nested_dir.join("nested.pdf");
    write_sample_pdf(&nested_pdf, "nested");
    let visible_pdf = temp
        .path()
        .join("Reader")
        .join("Collection 1")
        .join("visible.pdf");
    write_sample_pdf(&visible_pdf, "visible");

    let store = LibraryStore::new(temp.path().join("app"), temp.path().join("Reader"));
    let library = store.list_library().unwrap();
    let collection_one = library
        .folders
        .iter()
        .find(|node| node.folder.id == DEFAULT_COLLECTION_ID)
        .unwrap();

    assert_eq!(collection_one.documents.len(), 1);
    assert_eq!(collection_one.documents[0].file_name, "visible.pdf");
}

#[test]
fn rejects_importing_a_pdf_into_the_library_root() {
    let temp = tempdir().unwrap();
    let source = temp.path().join("root-import.pdf");
    write_sample_pdf(&source, "root");

    let store = LibraryStore::new(temp.path().join("app"), temp.path().join("Reader"));
    let error = store.import_pdf(&source, Some(ROOT_FOLDER_ID)).unwrap_err();

    assert!(error.to_string().contains("Choose a collection"));
}

#[test]
fn reconcile_library_skips_index_write_when_catalog_is_unchanged() {
    let temp = tempdir().unwrap();
    let source = temp.path().join("steady.pdf");
    write_sample_pdf(&source, "steady");

    let app_dir = temp.path().join("app");
    let store = LibraryStore::new(&app_dir, temp.path().join("Reader"));
    let _record = store
        .import_pdf(&source, Some(DEFAULT_COLLECTION_ID))
        .unwrap();

    let index_path = app_dir.join("library-index.json");
    let before = fs::metadata(&index_path).unwrap().modified().unwrap();
    thread::sleep(Duration::from_millis(1100));

    let _ = store.list_library().unwrap();

    let after = fs::metadata(&index_path).unwrap().modified().unwrap();
    assert_eq!(after, before);
}

#[test]
fn rename_folder_updates_document_paths_without_rescan() {
    let temp = tempdir().unwrap();
    let source = temp.path().join("foldered.pdf");
    write_sample_pdf(&source, "foldered");

    let store = LibraryStore::new(temp.path().join("app"), temp.path().join("Reader"));
    let folder = store.create_folder("Shelf", Some(ROOT_FOLDER_ID)).unwrap();
    let record = store.import_pdf(&source, Some(&folder.id)).unwrap();

    let renamed = store.rename_folder(&folder.id, "Archive").unwrap();
    let reopened = store.open_document(&record.id).unwrap();

    assert_eq!(renamed.id, "Archive");
    assert_eq!(reopened.document.folder_id, "Archive");
    assert_eq!(reopened.document.relative_path, "Archive/foldered.pdf");
}

#[test]
fn delete_folder_removes_empty_collection() {
    let temp = tempdir().unwrap();
    let store = LibraryStore::new(temp.path().join("app"), temp.path().join("Reader"));
    let folder = store.create_folder("Shelf", Some(ROOT_FOLDER_ID)).unwrap();

    let deleted = store.delete_folder(&folder.id).unwrap();
    let library = store.list_library().unwrap();

    assert_eq!(deleted.id, "Shelf");
    assert!(!temp.path().join("Reader").join("Shelf").exists());
    assert!(library
        .folders
        .iter()
        .all(|collection| collection.folder.id != "Shelf"));
}

#[test]
fn delete_folder_rejects_non_empty_collection() {
    let temp = tempdir().unwrap();
    let source = temp.path().join("occupied.pdf");
    write_sample_pdf(&source, "occupied");

    let store = LibraryStore::new(temp.path().join("app"), temp.path().join("Reader"));
    let folder = store.create_folder("Shelf", Some(ROOT_FOLDER_ID)).unwrap();
    store.import_pdf(&source, Some(&folder.id)).unwrap();

    let error = store.delete_folder(&folder.id).unwrap_err();
    assert!(error
        .to_string()
        .contains("Collections with PDFs inside cannot be deleted"));
}

#[test]
fn delete_folder_rejects_library_root() {
    let temp = tempdir().unwrap();
    let store = LibraryStore::new(temp.path().join("app"), temp.path().join("Reader"));

    let error = store.delete_folder(ROOT_FOLDER_ID).unwrap_err();
    assert!(error.to_string().contains("library root cannot be deleted"));
}
