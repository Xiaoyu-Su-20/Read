use std::fs;

use uuid::Uuid;

use crate::{
    error::AppResult,
    models::{
        DocumentRecord, NoteBlock, NoteBlockType, NoteDocument, NoteIndex, NoteIndexEntry,
        NoteInlineNode, NotePageLinkNode, NoteTextNode,
    },
};

use super::{paths::StorePaths, timestamp, NOTE_DOCUMENT_VERSION};

#[derive(Debug, Clone, Default)]
pub struct NoteStore;

impl NoteStore {
    pub fn get_or_create_for_book(
        &self,
        paths: &StorePaths,
        document: &DocumentRecord,
    ) -> AppResult<NoteDocument> {
        let index = self.load_notes_index(paths)?;

        let mut matching_entries = index
            .notes
            .iter()
            .filter(|entry| entry.book_id.as_deref() == Some(&document.id))
            .cloned()
            .collect::<Vec<_>>();
        matching_entries.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));

        for entry in matching_entries {
            if let Ok(note) = self.load_note_document(paths, &entry.id) {
                return Ok(note);
            }
        }

        let created_at = timestamp();
        let note = NoteDocument {
            id: Uuid::new_v4().to_string(),
            title: document.title.clone(),
            book_id: Some(document.id.clone()),
            created_at: created_at.clone(),
            updated_at: created_at,
            version: NOTE_DOCUMENT_VERSION,
            blocks: vec![self.empty_note_block()],
        };

        self.save(paths, note)
    }

    pub fn save(&self, paths: &StorePaths, mut note: NoteDocument) -> AppResult<NoteDocument> {
        self.normalize_note_document(&mut note);
        note.updated_at = timestamp();
        if note.created_at.trim().is_empty() {
            note.created_at = note.updated_at.clone();
        }

        paths.write_json_atomically(&paths.note_path(&note.id), &note)?;

        let mut index = self.load_notes_index(paths)?;
        let metadata = self.note_index_entry(&note);
        if let Some(existing) = index.notes.iter_mut().find(|entry| entry.id == note.id) {
            *existing = metadata;
        } else {
            index.notes.push(metadata);
        }
        self.save_notes_index(paths, &index)?;

        Ok(note)
    }

    pub fn load_notes_index(&self, paths: &StorePaths) -> AppResult<NoteIndex> {
        let raw = fs::read_to_string(&paths.notes_index_path)?;
        Ok(serde_json::from_str(&raw)?)
    }

    pub fn save_notes_index(&self, paths: &StorePaths, index: &NoteIndex) -> AppResult<()> {
        paths.write_json_atomically(&paths.notes_index_path, index)
    }

    pub fn load_note_document(&self, paths: &StorePaths, note_id: &str) -> AppResult<NoteDocument> {
        let raw = fs::read_to_string(paths.note_path(note_id))?;
        let mut note: NoteDocument = serde_json::from_str(&raw)?;
        self.normalize_note_document(&mut note);
        Ok(note)
    }

    fn note_index_entry(&self, note: &NoteDocument) -> NoteIndexEntry {
        NoteIndexEntry {
            id: note.id.clone(),
            title: note.title.clone(),
            book_id: note.book_id.clone(),
            created_at: note.created_at.clone(),
            updated_at: note.updated_at.clone(),
            excerpt: self.note_excerpt(note),
        }
    }

    fn note_excerpt(&self, note: &NoteDocument) -> String {
        let mut excerpt = note
            .blocks
            .iter()
            .flat_map(|block| block.children.iter())
            .map(|child| match child {
                NoteInlineNode::Text(text) => text.text.trim(),
                NoteInlineNode::PageLink(page_link) => page_link.text.trim(),
            })
            .filter(|text| !text.is_empty())
            .collect::<Vec<_>>()
            .join(" ");

        if excerpt.len() > 160 {
            excerpt.truncate(160);
            excerpt.push_str("...");
        }

        excerpt
    }

    fn normalize_note_document(&self, note: &mut NoteDocument) {
        if note.version < NOTE_DOCUMENT_VERSION {
            note.version = NOTE_DOCUMENT_VERSION;
        }

        if note.title.trim().is_empty() {
            note.title = "Untitled note".to_string();
        } else {
            note.title = note.title.trim().to_string();
        }

        if note.blocks.is_empty() {
            note.blocks.push(self.empty_note_block());
        }

        for block in &mut note.blocks {
            if block.id.trim().is_empty() {
                block.id = Uuid::new_v4().to_string();
            }

            if block.children.is_empty() {
                if block.spans.is_empty() {
                    block.children.push(NoteInlineNode::Text(NoteTextNode {
                        text: String::new(),
                        bold: false,
                        italic: false,
                    }));
                } else {
                    block.children.extend(block.spans.iter().map(|span| {
                        NoteInlineNode::Text(NoteTextNode {
                            text: span.text.clone(),
                            bold: span.bold,
                            italic: span.italic,
                        })
                    }));
                }
            }

            block.children =
                self.normalize_note_inline_nodes(&block.children, note.book_id.as_deref());
            block.spans.clear();
        }
    }

    fn empty_note_block(&self) -> NoteBlock {
        NoteBlock {
            id: Uuid::new_v4().to_string(),
            r#type: NoteBlockType::Paragraph,
            children: vec![NoteInlineNode::Text(NoteTextNode {
                text: String::new(),
                bold: false,
                italic: false,
            })],
            spans: Vec::new(),
        }
    }

    fn normalize_note_inline_nodes(
        &self,
        nodes: &[NoteInlineNode],
        fallback_document_id: Option<&str>,
    ) -> Vec<NoteInlineNode> {
        let mut normalized = Vec::new();
        let mut pending_text: Option<NoteTextNode> = None;

        for node in nodes {
            match node {
                NoteInlineNode::Text(text) => {
                    let next = NoteTextNode {
                        text: text.text.clone(),
                        bold: text.bold,
                        italic: text.italic,
                    };

                    if let Some(current) = pending_text.as_mut() {
                        if current.bold == next.bold && current.italic == next.italic {
                            current.text.push_str(&next.text);
                            continue;
                        }
                    }

                    if let Some(current) = pending_text.replace(next) {
                        normalized.push(NoteInlineNode::Text(current));
                    }
                }
                NoteInlineNode::PageLink(page_link) => {
                    if let Some(current) = pending_text.take() {
                        normalized.push(NoteInlineNode::Text(current));
                    }

                    normalized.push(NoteInlineNode::PageLink(NotePageLinkNode {
                        id: if page_link.id.trim().is_empty() {
                            Uuid::new_v4().to_string()
                        } else {
                            page_link.id.clone()
                        },
                        text: page_link.text.clone(),
                        document_id: page_link
                            .document_id
                            .clone()
                            .or_else(|| fallback_document_id.map(ToOwned::to_owned)),
                        pdf_page_index: page_link.pdf_page_index,
                        book_page_label: page_link.book_page_label.trim().to_string(),
                        created_at: if page_link.created_at.trim().is_empty() {
                            timestamp()
                        } else {
                            page_link.created_at.clone()
                        },
                    }));
                }
            }
        }

        if let Some(current) = pending_text.take() {
            normalized.push(NoteInlineNode::Text(current));
        }

        if normalized.is_empty() {
            normalized.push(NoteInlineNode::Text(NoteTextNode {
                text: String::new(),
                bold: false,
                italic: false,
            }));
        }

        normalized
    }
}
