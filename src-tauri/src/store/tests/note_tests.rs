use std::{thread, time::Duration};

use tempfile::tempdir;

use super::{
    super::{timestamp, LibraryStore, DEFAULT_COLLECTION_ID, NOTE_DOCUMENT_VERSION},
    support::write_sample_pdf,
};
use crate::models::{
    NoteBlock, NoteDocument, NoteInlineNode, NoteSpan, NoteTextNode, NoteTopicCardNode,
};

fn note_block(text: &str) -> NoteBlock {
    NoteBlock {
        id: "body".to_string(),
        r#type: crate::models::NoteBlockType::Paragraph,
        children: vec![NoteInlineNode::Text(NoteTextNode {
            text: text.to_string(),
            bold: false,
            italic: false,
        })],
        source_reference: None,
        spans: Vec::new(),
    }
}

fn standalone_note(title: &str, text: &str) -> NoteDocument {
    NoteDocument {
        id: uuid::Uuid::new_v4().to_string(),
        title: title.to_string(),
        book_id: None,
        created_at: timestamp(),
        updated_at: timestamp(),
        version: NOTE_DOCUMENT_VERSION,
        blocks: vec![note_block(text)],
    }
}

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
                source_reference: None,
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
                source_reference: None,
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
                source_reference: None,
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
                source_reference: None,
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

#[test]
fn save_note_drops_legacy_section_break_blocks() {
    let temp = tempdir().unwrap();
    let app_dir = temp.path().join("app");
    let store = LibraryStore::new(&app_dir, temp.path().join("Reader"));

    let saved = store
        .save_note(NoteDocument {
            id: uuid::Uuid::new_v4().to_string(),
            title: "Breaks".to_string(),
            book_id: None,
            created_at: timestamp(),
            updated_at: timestamp(),
            version: NOTE_DOCUMENT_VERSION,
            blocks: vec![
                NoteBlock {
                    id: "break-one".to_string(),
                    r#type: crate::models::NoteBlockType::SectionBreak,
                    children: vec![NoteInlineNode::Text(NoteTextNode {
                        text: "should be cleared".to_string(),
                        bold: false,
                        italic: false,
                    })],
                    source_reference: None,
                    spans: Vec::new(),
                },
                note_block("Between"),
                NoteBlock {
                    id: "break-two".to_string(),
                    r#type: crate::models::NoteBlockType::SectionBreak,
                    children: Vec::new(),
                    source_reference: None,
                    spans: Vec::new(),
                },
            ],
        })
        .unwrap();

    assert_eq!(saved.blocks.len(), 1);
    assert_eq!(saved.blocks[0].r#type, crate::models::NoteBlockType::Paragraph);
    assert_eq!(saved.blocks[0].id, "body");
}

#[test]
fn save_note_preserves_inline_topic_cards() {
    let temp = tempdir().unwrap();
    let app_dir = temp.path().join("app");
    let store = LibraryStore::new(&app_dir, temp.path().join("Reader"));

    let saved = store
        .save_note(NoteDocument {
            id: uuid::Uuid::new_v4().to_string(),
            title: "Topics".to_string(),
            book_id: None,
            created_at: timestamp(),
            updated_at: timestamp(),
            version: NOTE_DOCUMENT_VERSION,
            blocks: vec![NoteBlock {
                id: "body".to_string(),
                r#type: crate::models::NoteBlockType::Paragraph,
                children: vec![
                    NoteInlineNode::Text(NoteTextNode {
                        text: "Before ".to_string(),
                        bold: false,
                        italic: false,
                    }),
                    NoteInlineNode::TopicCard(NoteTopicCardNode {
                        id: "topic-1".to_string(),
                        text: "Norm Violation".to_string(),
                        color: "accent".to_string(),
                    }),
                    NoteInlineNode::Text(NoteTextNode {
                        text: " after".to_string(),
                        bold: false,
                        italic: false,
                    }),
                ],
                source_reference: None,
                spans: Vec::new(),
            }],
        })
        .unwrap();

    let persisted = store
        .notes
        .load_note_document(&store.paths, &saved.id)
        .unwrap();

    assert_eq!(persisted.blocks[0].children.len(), 3);
    match &persisted.blocks[0].children[1] {
        NoteInlineNode::TopicCard(topic) => {
            assert_eq!(topic.text, "Norm Violation");
            assert_eq!(topic.color, "accent");
        }
        _ => panic!("expected topic card node"),
    }
}

#[test]
fn list_standalone_notes_excludes_document_notes_and_sorts_by_last_opened() {
    let temp = tempdir().unwrap();
    let source = temp.path().join("attached.pdf");
    write_sample_pdf(&source, "attached");

    let app_dir = temp.path().join("app");
    let store = LibraryStore::new(&app_dir, temp.path().join("Reader"));
    let record = store
        .import_pdf(&source, Some(DEFAULT_COLLECTION_ID))
        .unwrap();
    let linked_note = store.get_or_create_note_for_book(&record.id).unwrap();

    let older = store.save_note(standalone_note("Older", "")).unwrap();
    thread::sleep(Duration::from_millis(1100));
    let newer = store.save_note(standalone_note("Newer", "")).unwrap();
    thread::sleep(Duration::from_millis(1100));
    let _ = store.open_standalone_note(&older.id).unwrap();

    let notes = store.list_standalone_notes().unwrap();
    let ids = notes.iter().map(|note| note.id.clone()).collect::<Vec<_>>();

    assert_eq!(ids, vec![older.id.clone(), newer.id.clone()]);
    assert!(notes.iter().all(|note| note.book_id.is_none()));
    assert!(notes.iter().all(|note| note.id != linked_note.id));
}

#[test]
fn standalone_note_delete_state_is_body_driven() {
    let temp = tempdir().unwrap();
    let source = temp.path().join("linked.pdf");
    write_sample_pdf(&source, "linked");

    let app_dir = temp.path().join("app");
    let store = LibraryStore::new(&app_dir, temp.path().join("Reader"));

    let created = store.create_standalone_note().unwrap();
    let initial_state = store.get_standalone_note_delete_state(&created.id).unwrap();
    assert!(initial_state.can_delete);
    assert_eq!(initial_state.reason, None);

    let renamed = store
        .rename_standalone_note(&created.id, "Custom standalone title")
        .unwrap();
    let renamed_state = store.get_standalone_note_delete_state(&renamed.id).unwrap();
    assert!(renamed_state.can_delete);
    assert_eq!(renamed_state.reason, None);

    let saved = store
        .save_note(NoteDocument {
            blocks: vec![note_block("Actual body content")],
            ..renamed
        })
        .unwrap();
    let blocked_state = store.get_standalone_note_delete_state(&saved.id).unwrap();
    assert!(!blocked_state.can_delete);
    assert_eq!(
        blocked_state.reason.as_deref(),
        Some("Clear the note before deleting it.")
    );

    let record = store.import_pdf(&source, Some(DEFAULT_COLLECTION_ID)).unwrap();
    let linked_note = store.get_or_create_note_for_book(&record.id).unwrap();
    let linked_state = store
        .get_standalone_note_delete_state(&linked_note.id)
        .unwrap();
    assert!(!linked_state.can_delete);
    assert_eq!(
        linked_state.reason.as_deref(),
        Some("Only standalone notes can be deleted here.")
    );
}

#[test]
fn delete_standalone_note_removes_note_file_and_index_entry() {
    let temp = tempdir().unwrap();
    let app_dir = temp.path().join("app");
    let store = LibraryStore::new(&app_dir, temp.path().join("Reader"));

    let note = store.create_standalone_note().unwrap();
    let note_path = app_dir.join("notes").join(format!("{}.json", note.id));
    assert!(note_path.exists());

    let deleted = store.delete_standalone_note(&note.id).unwrap();
    assert_eq!(deleted.id, note.id);
    assert!(!note_path.exists());

    let index = store.notes.load_notes_index(&store.paths).unwrap();
    assert!(index.notes.iter().all(|entry| entry.id != note.id));
}

#[test]
fn search_standalone_notes_excludes_pdf_linked_notes() {
    let temp = tempdir().unwrap();
    let source = temp.path().join("linked-search.pdf");
    write_sample_pdf(&source, "linked-search");

    let app_dir = temp.path().join("app");
    let store = LibraryStore::new(&app_dir, temp.path().join("Reader"));

    let standalone = store
        .save_note(standalone_note("Standalone focus", "Focus only lives here"))
        .unwrap();

    let record = store.import_pdf(&source, Some(DEFAULT_COLLECTION_ID)).unwrap();
    let linked_note = store.get_or_create_note_for_book(&record.id).unwrap();
    let _ = store
        .save_note(NoteDocument {
            blocks: vec![note_block("Focus also appears here")],
            ..linked_note
        })
        .unwrap();

    let results = store.search_standalone_notes("focus").unwrap();
    assert!(!results.is_empty());
    assert!(results.iter().all(|result| result.note_id == standalone.id));
}
