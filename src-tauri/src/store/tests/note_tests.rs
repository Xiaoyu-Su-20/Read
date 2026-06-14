use tempfile::tempdir;

use super::{
    super::{timestamp, LibraryStore, DEFAULT_COLLECTION_ID, NOTE_DOCUMENT_VERSION},
    support::write_sample_pdf,
};
use crate::models::{NoteBlock, NoteDocument, NoteInlineNode, NoteSpan, NoteTextNode};

#[test]
fn get_or_create_note_for_book_creates_note_file_and_index_entry() {
    let temp = tempdir().unwrap();
    let source = temp.path().join("book.pdf");
    write_sample_pdf(&source, "notes");

    let app_dir = temp.path().join("app");
    let store = LibraryStore::new(&app_dir, temp.path().join("Reader"));
    let record = store
        .import_pdf(&source, Some(DEFAULT_COLLECTION_ID))
        .unwrap();
    let note = store.get_or_create_note_for_book(&record.id).unwrap();

    let index = store.notes.load_notes_index(&store.paths).unwrap();
    let entry = index
        .notes
        .iter()
        .find(|entry| entry.id == note.id)
        .unwrap();

    assert_eq!(entry.book_id.as_deref(), Some(record.id.as_str()));
    assert!(app_dir
        .join("notes")
        .join(format!("{}.json", note.id))
        .exists());
}

#[test]
fn get_or_create_note_for_book_returns_most_recent_existing_note() {
    let temp = tempdir().unwrap();
    let source = temp.path().join("book.pdf");
    write_sample_pdf(&source, "notes");

    let app_dir = temp.path().join("app");
    let store = LibraryStore::new(&app_dir, temp.path().join("Reader"));
    let record = store
        .import_pdf(&source, Some(DEFAULT_COLLECTION_ID))
        .unwrap();
    let original = store.get_or_create_note_for_book(&record.id).unwrap();

    let newer = store
        .save_note(NoteDocument {
            id: uuid::Uuid::new_v4().to_string(),
            title: "Fresh note".to_string(),
            book_id: Some(record.id.clone()),
            created_at: timestamp(),
            updated_at: timestamp(),
            version: NOTE_DOCUMENT_VERSION,
            blocks: vec![NoteBlock {
                id: "body".to_string(),
                r#type: crate::models::NoteBlockType::Paragraph,
                children: vec![NoteInlineNode::Text(NoteTextNode {
                    text: "fresh".to_string(),
                    bold: false,
                    italic: false,
                })],
                spans: Vec::new(),
            }],
        })
        .unwrap();

    let reopened = store.get_or_create_note_for_book(&record.id).unwrap();
    assert_ne!(original.id, newer.id);
    assert_eq!(reopened.id, newer.id);
}

#[test]
fn save_note_updates_note_file_and_index_metadata() {
    let temp = tempdir().unwrap();
    let source = temp.path().join("book.pdf");
    write_sample_pdf(&source, "notes");

    let app_dir = temp.path().join("app");
    let store = LibraryStore::new(&app_dir, temp.path().join("Reader"));
    let record = store
        .import_pdf(&source, Some(DEFAULT_COLLECTION_ID))
        .unwrap();
    let note = store.get_or_create_note_for_book(&record.id).unwrap();

    let saved = store
        .save_note(NoteDocument {
            blocks: vec![NoteBlock {
                id: "body".to_string(),
                r#type: crate::models::NoteBlockType::Paragraph,
                children: vec![
                    NoteInlineNode::Text(NoteTextNode {
                        text: "A focused reading note".to_string(),
                        bold: false,
                        italic: false,
                    }),
                    NoteInlineNode::Text(NoteTextNode {
                        text: " with detail".to_string(),
                        bold: false,
                        italic: false,
                    }),
                ],
                spans: Vec::new(),
            }],
            ..note
        })
        .unwrap();

    let persisted = store
        .notes
        .load_note_document(&store.paths, &saved.id)
        .unwrap();
    let index = store.notes.load_notes_index(&store.paths).unwrap();
    let entry = index
        .notes
        .iter()
        .find(|entry| entry.id == saved.id)
        .unwrap();

    assert_eq!(persisted.blocks[0].children.len(), 1);
    match &persisted.blocks[0].children[0] {
        NoteInlineNode::Text(text) => assert_eq!(text.text, "A focused reading note with detail"),
        _ => panic!("expected merged text node"),
    }
    assert_eq!(entry.excerpt, "A focused reading note with detail");
}

#[test]
fn save_note_supports_standalone_notes() {
    let temp = tempdir().unwrap();
    let app_dir = temp.path().join("app");
    let store = LibraryStore::new(&app_dir, temp.path().join("Reader"));

    let saved = store
        .save_note(NoteDocument {
            id: uuid::Uuid::new_v4().to_string(),
            title: "Standalone".to_string(),
            book_id: None,
            created_at: timestamp(),
            updated_at: timestamp(),
            version: NOTE_DOCUMENT_VERSION,
            blocks: vec![NoteBlock {
                id: "body".to_string(),
                r#type: crate::models::NoteBlockType::Paragraph,
                children: vec![NoteInlineNode::Text(NoteTextNode {
                    text: "Freeform".to_string(),
                    bold: false,
                    italic: true,
                })],
                spans: vec![NoteSpan {
                    text: "Freeform".to_string(),
                    bold: false,
                    italic: true,
                }],
            }],
        })
        .unwrap();

    let index = store.notes.load_notes_index(&store.paths).unwrap();
    let entry = index
        .notes
        .iter()
        .find(|entry| entry.id == saved.id)
        .unwrap();

    assert!(app_dir
        .join("notes")
        .join(format!("{}.json", saved.id))
        .exists());
    assert!(entry.book_id.is_none());
}

#[test]
fn save_note_migrates_legacy_spans_into_children() {
    let temp = tempdir().unwrap();
    let source = temp.path().join("legacy-spans.pdf");
    write_sample_pdf(&source, "legacy-spans");

    let app_dir = temp.path().join("app");
    let store = LibraryStore::new(&app_dir, temp.path().join("Reader"));
    let record = store
        .import_pdf(&source, Some(DEFAULT_COLLECTION_ID))
        .unwrap();
    let note = store.get_or_create_note_for_book(&record.id).unwrap();

    let saved = store
        .save_note(NoteDocument {
            blocks: vec![NoteBlock {
                id: "legacy".to_string(),
                r#type: crate::models::NoteBlockType::Paragraph,
                children: Vec::new(),
                spans: vec![NoteSpan {
                    text: "(p. 45)".to_string(),
                    bold: false,
                    italic: false,
                }],
            }],
            ..note
        })
        .unwrap();

    match &saved.blocks[0].children[0] {
        NoteInlineNode::Text(text) => assert_eq!(text.text, "(p. 45)"),
        _ => panic!("expected migrated text node"),
    }
    assert!(saved.blocks[0].spans.is_empty());
}
