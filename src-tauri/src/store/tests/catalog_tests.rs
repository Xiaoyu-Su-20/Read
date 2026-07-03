use std::{fs, thread, time::Duration};

use serde_json::Value;
use tempfile::tempdir;

use super::{
    super::{LibraryStore, DEFAULT_COLLECTIONS, DEFAULT_COLLECTION_ID},
    support::write_sample_pdf,
};
use crate::models::{
    DocumentAvailability, NoteBlock, NoteInlineNode, NoteTextNode, ROOT_FOLDER_ID,
};

#[test]
fn imports_pdf_without_creating_sidecar_files() {
    let temp = tempdir().unwrap();
    let source = temp.path().join("source.pdf");
    write_sample_pdf(&source, "hello");

    let app_dir = temp.path().join("app");
    let store = LibraryStore::new(&app_dir, temp.path().join("Reader"));
    let record = store.import_pdf(&source, Some(DEFAULT_COLLECTION_ID)).unwrap();

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
fn importing_the_same_pdf_twice_reuses_the_existing_document() {
    let temp = tempdir().unwrap();
    let source = temp.path().join("source.pdf");
    write_sample_pdf(&source, "hello");

    let app_dir = temp.path().join("app");
    let store = LibraryStore::new(&app_dir, temp.path().join("Reader"));
    let first = store
        .import_pdf(&source, Some(DEFAULT_COLLECTION_ID))
        .unwrap();
    let second = store
        .import_pdf(&source, Some(DEFAULT_COLLECTION_ID))
        .unwrap();

    assert_eq!(first.id, second.id);

    let library = store.list_library().unwrap();
    let documents = &library
        .folders
        .iter()
        .find(|collection| collection.folder.id == DEFAULT_COLLECTION_ID)
        .unwrap()
        .documents;
    assert_eq!(documents.len(), 1);
}

#[test]
fn importing_the_same_pdf_into_another_collection_moves_the_existing_document() {
    let temp = tempdir().unwrap();
    let source = temp.path().join("source.pdf");
    write_sample_pdf(&source, "hello");

    let app_dir = temp.path().join("app");
    let store = LibraryStore::new(&app_dir, temp.path().join("Reader"));
    let first = store
        .import_pdf(&source, Some(DEFAULT_COLLECTION_ID))
        .unwrap();
    let moved = store.import_pdf(&source, Some("Collection 2")).unwrap();

    assert_eq!(first.id, moved.id);
    assert_eq!(moved.folder_id, "Collection 2");

    let library = store.list_library().unwrap();
    let collection_one = library
        .folders
        .iter()
        .find(|collection| collection.folder.id == DEFAULT_COLLECTION_ID)
        .unwrap();
    let collection_two = library
        .folders
        .iter()
        .find(|collection| collection.folder.id == "Collection 2")
        .unwrap();
    assert!(collection_one.documents.is_empty());
    assert_eq!(collection_two.documents.len(), 1);
    assert_eq!(collection_two.documents[0].id, first.id);
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
                scroll_zoom: 1.35,
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
    assert!((reopened.state.scroll_zoom - 1.35).abs() < f32::EPSILON);
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
fn reconcile_library_persists_file_metadata_for_cached_fingerprints() {
    let temp = tempdir().unwrap();
    let source = temp.path().join("steady-metadata.pdf");
    write_sample_pdf(&source, "steady");

    let app_dir = temp.path().join("app");
    let store = LibraryStore::new(&app_dir, temp.path().join("Reader"));
    let record = store
        .import_pdf(&source, Some(DEFAULT_COLLECTION_ID))
        .unwrap();

    let _ = store.list_library().unwrap();

    let index_path = app_dir.join("library-index.json");
    let raw = fs::read_to_string(index_path).unwrap();
    let parsed: Value = serde_json::from_str(&raw).unwrap();
    let documents = parsed["documents"].as_array().unwrap();
    let document = documents
        .iter()
        .find(|document| document["id"].as_str() == Some(record.id.as_str()))
        .unwrap();

    assert!(document["fileSizeBytes"].as_u64().unwrap() > 0);
    assert!(document["fileModifiedMs"].as_u64().unwrap() > 0);
}

#[test]
fn reconcile_library_removes_stale_missing_duplicates_with_same_fingerprint() {
    let temp = tempdir().unwrap();
    let source = temp.path().join("duplicate.pdf");
    write_sample_pdf(&source, "duplicate");

    let app_dir = temp.path().join("app");
    let store = LibraryStore::new(&app_dir, temp.path().join("Reader"));
    let record = store
        .import_pdf(&source, Some(DEFAULT_COLLECTION_ID))
        .unwrap();

    let stale_document_id = "stale-document".to_string();
    let stale_state = crate::models::DocumentState {
        last_opened_at: Some("2026-06-17T10:00:00Z".to_string()),
        last_page: 23,
        scroll_zoom: 1.4,
        ..crate::models::DocumentState::new(stale_document_id.clone(), record.fingerprint.clone())
    };
    let stale_state_path = app_dir
        .join("document-states")
        .join(format!("{stale_document_id}.json"));
    fs::create_dir_all(stale_state_path.parent().unwrap()).unwrap();
    fs::write(
        &stale_state_path,
        serde_json::to_string_pretty(&stale_state).unwrap(),
    )
    .unwrap();

    let index_path = app_dir.join("library-index.json");
    let mut index: crate::models::LibraryIndex =
        serde_json::from_str(&fs::read_to_string(&index_path).unwrap()).unwrap();
    index.documents.push(crate::models::DocumentRecord {
        id: stale_document_id.clone(),
        title: "duplicate".to_string(),
        file_name: "duplicate.pdf".to_string(),
        folder_id: DEFAULT_COLLECTION_ID.to_string(),
        relative_path: "Collection 2/duplicate.pdf".to_string(),
        fingerprint: record.fingerprint.clone(),
        file_size_bytes: None,
        file_modified_ms: None,
        imported_at: "2026-06-16T00:00:00Z".to_string(),
        last_opened_at: stale_state.last_opened_at.clone(),
        availability: DocumentAvailability::Missing,
    });
    fs::write(&index_path, serde_json::to_string_pretty(&index).unwrap()).unwrap();

    let _ = store.list_library().unwrap();

    let reconciled: crate::models::LibraryIndex =
        serde_json::from_str(&fs::read_to_string(&index_path).unwrap()).unwrap();
    assert_eq!(reconciled.documents.len(), 1);
    assert_eq!(reconciled.documents[0].id, record.id);
    assert_eq!(
        reconciled.documents[0].last_opened_at,
        Some("2026-06-17T10:00:00Z".to_string())
    );
    assert!(!stale_state_path.exists());

    let reopened = store.open_document(&record.id).unwrap();
    assert_eq!(reopened.state.last_page, 23);
    assert!((reopened.state.scroll_zoom - 1.4).abs() < f32::EPSILON);
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
fn renaming_collection_one_does_not_recreate_an_empty_collection_one() {
    let temp = tempdir().unwrap();
    let source = temp.path().join("default-folder.pdf");
    write_sample_pdf(&source, "default-folder");

    let store = LibraryStore::new(temp.path().join("app"), temp.path().join("Reader"));
    let record = store
        .import_pdf(&source, Some(DEFAULT_COLLECTION_ID))
        .unwrap();

    let renamed = store.rename_folder(DEFAULT_COLLECTION_ID, "Renamed Shelf").unwrap();
    assert_eq!(renamed.id, "Renamed Shelf");

    let library = store.list_library().unwrap();
    assert!(library
        .folders
        .iter()
        .all(|folder| folder.folder.id != DEFAULT_COLLECTION_ID));

    let renamed_collection = library
        .folders
        .iter()
        .find(|folder| folder.folder.id == "Renamed Shelf")
        .unwrap();
    assert_eq!(renamed_collection.documents.len(), 1);
    assert_eq!(renamed_collection.documents[0].id, record.id);
    assert!(temp.path().join("Reader").join("Renamed Shelf").exists());
    assert!(!temp.path().join("Reader").join(DEFAULT_COLLECTION_ID).exists());
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

#[test]
fn reorder_collections_persists_custom_order() {
    let temp = tempdir().unwrap();
    let store = LibraryStore::new(temp.path().join("app"), temp.path().join("Reader"));
    let created = store.create_folder("Archive", Some(ROOT_FOLDER_ID)).unwrap();

    let reordered = store
        .reorder_collections(&[
            created.id.clone(),
            "Collection 1".to_string(),
            "Collection 2".to_string(),
            "Collection 3".to_string(),
        ])
        .unwrap();

    let reordered_ids = reordered
        .folders
        .iter()
        .map(|collection| collection.folder.id.clone())
        .collect::<Vec<_>>();
    assert_eq!(
        reordered_ids,
        vec![
            "Archive".to_string(),
            "Collection 1".to_string(),
            "Collection 2".to_string(),
            "Collection 3".to_string(),
        ]
    );

    let reopened = store.list_library().unwrap();
    let reopened_ids = reopened
        .folders
        .iter()
        .map(|collection| collection.folder.id.clone())
        .collect::<Vec<_>>();
    assert_eq!(reordered_ids, reopened_ids);
}

#[test]
fn reorder_collection_documents_persists_custom_book_order() {
    let temp = tempdir().unwrap();
    let store = LibraryStore::new(temp.path().join("app"), temp.path().join("Reader"));
    let first = temp.path().join("one.pdf");
    let second = temp.path().join("two.pdf");
    write_sample_pdf(&first, "one");
    write_sample_pdf(&second, "two");

    let first_record = store.import_pdf(&first, Some(DEFAULT_COLLECTION_ID)).unwrap();
    let second_record = store.import_pdf(&second, Some(DEFAULT_COLLECTION_ID)).unwrap();

    let reordered = store
        .reorder_collection_documents(
            DEFAULT_COLLECTION_ID,
            &[second_record.id.clone(), first_record.id.clone()],
        )
        .unwrap();
    let reordered_titles = reordered
        .folders
        .iter()
        .find(|collection| collection.folder.id == DEFAULT_COLLECTION_ID)
        .unwrap()
        .documents
        .iter()
        .map(|document| document.id.clone())
        .collect::<Vec<_>>();
    assert_eq!(
        reordered_titles,
        vec![second_record.id.clone(), first_record.id.clone()]
    );

    let reopened = store.list_library().unwrap();
    let reopened_ids = reopened
        .folders
        .iter()
        .find(|collection| collection.folder.id == DEFAULT_COLLECTION_ID)
        .unwrap()
        .documents
        .iter()
        .map(|document| document.id.clone())
        .collect::<Vec<_>>();
    assert_eq!(reordered_titles, reopened_ids);
}

#[test]
fn move_document_updates_collection_order_membership() {
    let temp = tempdir().unwrap();
    let source = temp.path().join("move-me.pdf");
    write_sample_pdf(&source, "move-me");

    let store = LibraryStore::new(temp.path().join("app"), temp.path().join("Reader"));
    let record = store.import_pdf(&source, Some(DEFAULT_COLLECTION_ID)).unwrap();

    let moved = store.move_document(&record.id, "Collection 2").unwrap();
    assert_eq!(moved.folder_id, "Collection 2");

    let library = store.list_library().unwrap();
    let source_collection = library
        .folders
        .iter()
        .find(|collection| collection.folder.id == DEFAULT_COLLECTION_ID)
        .unwrap();
    let destination_collection = library
        .folders
        .iter()
        .find(|collection| collection.folder.id == "Collection 2")
        .unwrap();

    assert!(source_collection
        .documents
        .iter()
        .all(|document| document.id != record.id));
    assert_eq!(destination_collection.documents[0].id, record.id);
}

#[test]
fn get_document_delete_state_allows_default_note() {
    let temp = tempdir().unwrap();
    let source = temp.path().join("default-note.pdf");
    write_sample_pdf(&source, "default-note");

    let app_dir = temp.path().join("app");
    let store = LibraryStore::new(&app_dir, temp.path().join("Reader"));
    let record = store.import_pdf(&source, Some(DEFAULT_COLLECTION_ID)).unwrap();

    let _ = store.get_or_create_note_for_book(&record.id).unwrap();
    let state = store.get_document_delete_state(&record.id).unwrap();

    assert!(state.can_delete);
    assert_eq!(state.reason, None);
}

#[test]
fn get_document_delete_state_blocks_non_empty_note_body() {
    let temp = tempdir().unwrap();
    let source = temp.path().join("noted.pdf");
    write_sample_pdf(&source, "noted");

    let app_dir = temp.path().join("app");
    let store = LibraryStore::new(&app_dir, temp.path().join("Reader"));
    let record = store.import_pdf(&source, Some(DEFAULT_COLLECTION_ID)).unwrap();
    let note = store.get_or_create_note_for_book(&record.id).unwrap();

    store
        .save_note(crate::models::NoteDocument {
            blocks: vec![NoteBlock {
                id: "body".to_string(),
                r#type: crate::models::NoteBlockType::Paragraph,
                children: vec![NoteInlineNode::Text(NoteTextNode {
                    text: "Saved note content".to_string(),
                    bold: false,
                    italic: false,
                })],
                source_reference: None,
                spans: Vec::new(),
            }],
            ..note
        })
        .unwrap();

    let state = store.get_document_delete_state(&record.id).unwrap();
    assert!(!state.can_delete);
    assert_eq!(
        state.reason.as_deref(),
        Some("PDFs with note content cannot be deleted.")
    );
}

#[test]
fn delete_document_removes_pdf_index_order_notes_and_state() {
    let temp = tempdir().unwrap();
    let source = temp.path().join("delete-me.pdf");
    write_sample_pdf(&source, "delete-me");

    let app_dir = temp.path().join("app");
    let store = LibraryStore::new(&app_dir, temp.path().join("Reader"));
    let record = store.import_pdf(&source, Some(DEFAULT_COLLECTION_ID)).unwrap();
    let note = store.get_or_create_note_for_book(&record.id).unwrap();

    let imported_path = temp
        .path()
        .join("Reader")
        .join(DEFAULT_COLLECTION_ID)
        .join(&record.file_name);
    let state_path = app_dir.join("document-states").join(format!("{}.json", record.id));
    let note_path = app_dir.join("notes").join(format!("{}.json", note.id));

    assert!(imported_path.exists());
    assert!(state_path.exists());
    assert!(note_path.exists());

    let deleted = store.delete_document(&record.id).unwrap();
    assert_eq!(deleted.id, record.id);

    assert!(!imported_path.exists());
    assert!(!state_path.exists());
    assert!(!note_path.exists());

    let library = store.list_library().unwrap();
    let collection = library
        .folders
        .iter()
        .find(|folder| folder.folder.id == DEFAULT_COLLECTION_ID)
        .unwrap();
    assert!(collection.documents.iter().all(|document| document.id != record.id));

    let index: Value =
        serde_json::from_str(&fs::read_to_string(app_dir.join("library-index.json")).unwrap())
            .unwrap();
    assert_eq!(
        index["documents"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|document| document["id"] == record.id)
            .count(),
        0
    );
    assert_eq!(
        index["documentOrderByCollection"][DEFAULT_COLLECTION_ID]
            .as_array()
            .unwrap()
            .iter()
            .filter(|document_id| document_id.as_str() == Some(record.id.as_str()))
            .count(),
        0
    );

    let notes_index: Value =
        serde_json::from_str(&fs::read_to_string(app_dir.join("notes").join("index.json")).unwrap())
            .unwrap();
    assert_eq!(
        notes_index["notes"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|entry| entry["bookId"].as_str() == Some(record.id.as_str()))
            .count(),
        0
    );
}
