use std::fs;

use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::{
        DocumentDeleteState, DocumentRecord, DocumentSourceReference,
        DocumentSourceReferenceKind, NoteBlock, NoteBlockType, NoteDocument, NoteIndex,
        NoteIndexEntry, NoteInlineNode, NotePageLinkNode, NoteTextNode, NoteTopicCardNode,
        StandaloneNoteSearchHit,
    },
};

use super::{paths::StorePaths, timestamp, NOTE_DOCUMENT_VERSION};

#[derive(Debug, Clone, Default)]
pub struct NoteStore;

const NON_STANDALONE_NOTE_DELETE_REASON: &str = "Only standalone notes can be deleted here.";
const STANDALONE_NOTE_DELETE_BLOCKED_REASON: &str = "Clear the note before deleting it.";

impl NoteStore {
    fn normalize_topic_color(&self, color: &str) -> String {
        match color.trim() {
            "accent"
            | "interactive"
            | "accentSoft"
            | "interactiveSoft"
            | "neutral"
            | "emphasis" => color.trim().to_string(),
            "blue" => "interactive".to_string(),
            "green" => "interactiveSoft".to_string(),
            "amber" => "accent".to_string(),
            "rose" => "emphasis".to_string(),
            "violet" => "accentSoft".to_string(),
            "slate" => "neutral".to_string(),
            _ => "accent".to_string(),
        }
    }

    pub fn document_delete_state(
        &self,
        paths: &StorePaths,
        document_id: &str,
    ) -> AppResult<DocumentDeleteState> {
        let has_note_content = self
            .load_notes_index(paths)?
            .notes
            .iter()
            .any(|entry| {
                entry.book_id.as_deref() == Some(document_id) && !entry.excerpt.trim().is_empty()
            });

        Ok(DocumentDeleteState {
            can_delete: !has_note_content,
            reason: has_note_content.then(|| {
                "PDFs with note content cannot be deleted.".to_string()
            }),
        })
    }

    pub fn delete_notes_for_book(&self, paths: &StorePaths, document_id: &str) -> AppResult<()> {
        let mut index = self.load_notes_index(paths)?;
        let note_ids = index
            .notes
            .iter()
            .filter(|entry| entry.book_id.as_deref() == Some(document_id))
            .map(|entry| entry.id.clone())
            .collect::<Vec<_>>();

        index
            .notes
            .retain(|entry| entry.book_id.as_deref() != Some(document_id));
        self.save_notes_index(paths, &index)?;

        for note_id in note_ids {
            let path = paths.note_path(&note_id);
            if path.exists() {
                fs::remove_file(path)?;
            }
        }

        Ok(())
    }

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

    pub fn list_standalone_notes(&self, paths: &StorePaths) -> AppResult<Vec<NoteIndexEntry>> {
        let mut notes = self
            .load_notes_index(paths)?
            .notes
            .into_iter()
            .filter(|entry| entry.book_id.is_none())
            .collect::<Vec<_>>();

        notes.sort_by(|left, right| {
            self.note_sort_at(right)
                .cmp(self.note_sort_at(left))
                .then_with(|| right.updated_at.cmp(&left.updated_at))
                .then_with(|| left.title.cmp(&right.title))
        });

        Ok(notes)
    }

    pub fn create_standalone_note(&self, paths: &StorePaths) -> AppResult<NoteDocument> {
        let created_at = timestamp();
        let saved = self.save(
            paths,
            NoteDocument {
                id: Uuid::new_v4().to_string(),
                title: "Untitled note".to_string(),
                book_id: None,
                created_at: created_at.clone(),
                updated_at: created_at,
                version: NOTE_DOCUMENT_VERSION,
                blocks: vec![self.empty_note_block()],
            },
        )?;
        self.touch_note_last_opened_at(paths, &saved.id, Some(saved.updated_at.clone()))?;
        Ok(saved)
    }

    pub fn open_standalone_note(
        &self,
        paths: &StorePaths,
        note_id: &str,
    ) -> AppResult<NoteDocument> {
        let note = self.load_note_document(paths, note_id)?;
        self.ensure_standalone_note(note_id, &note)?;
        self.touch_note_last_opened_at(paths, note_id, Some(timestamp()))?;
        Ok(note)
    }

    pub fn rename_standalone_note(
        &self,
        paths: &StorePaths,
        note_id: &str,
        title: &str,
    ) -> AppResult<NoteDocument> {
        let mut note = self.load_note_document(paths, note_id)?;
        self.ensure_standalone_note(note_id, &note)?;
        note.title = title.to_string();
        self.save(paths, note)
    }

    pub fn standalone_note_delete_state(
        &self,
        paths: &StorePaths,
        note_id: &str,
    ) -> AppResult<DocumentDeleteState> {
        let note = self.load_note_document(paths, note_id)?;
        if note.book_id.is_some() {
            return Ok(DocumentDeleteState {
                can_delete: false,
                reason: Some(NON_STANDALONE_NOTE_DELETE_REASON.to_string()),
            });
        }

        let has_note_content = !self.note_excerpt(&note).trim().is_empty();
        Ok(DocumentDeleteState {
            can_delete: !has_note_content,
            reason: has_note_content.then(|| STANDALONE_NOTE_DELETE_BLOCKED_REASON.to_string()),
        })
    }

    pub fn delete_standalone_note(
        &self,
        paths: &StorePaths,
        note_id: &str,
    ) -> AppResult<NoteDocument> {
        let state = self.standalone_note_delete_state(paths, note_id)?;
        if !state.can_delete {
            return Err(AppError::InvalidInput(
                state
                    .reason
                    .unwrap_or_else(|| STANDALONE_NOTE_DELETE_BLOCKED_REASON.to_string()),
            ));
        }

        let note = self.load_note_document(paths, note_id)?;
        self.ensure_standalone_note(note_id, &note)?;

        let mut index = self.load_notes_index(paths)?;
        index.notes.retain(|entry| entry.id != note_id);
        self.save_notes_index(paths, &index)?;

        let path = paths.note_path(note_id);
        if path.exists() {
            fs::remove_file(path)?;
        }

        Ok(note)
    }

    pub fn search_standalone_notes(
        &self,
        paths: &StorePaths,
        query: &str,
    ) -> AppResult<Vec<StandaloneNoteSearchHit>> {
        let normalized_query = self.normalize_search_text(query).to_lowercase();
        if normalized_query.is_empty() {
            return Ok(Vec::new());
        }

        let mut results = Vec::new();
        for entry in self.list_standalone_notes(paths)? {
            let note = match self.load_note_document(paths, &entry.id) {
                Ok(note) if note.book_id.is_none() => note,
                Ok(_) => continue,
                Err(_) => continue,
            };

            let title_text = self.normalize_search_text(&note.title);
            if let Some(match_index) = title_text.to_lowercase().find(&normalized_query) {
                results.push(StandaloneNoteSearchHit {
                    note_id: note.id.clone(),
                    block_id: note
                        .blocks
                        .first()
                        .map(|block| block.id.clone())
                        .unwrap_or_default(),
                    title: note.title.clone(),
                    text: title_text,
                    match_index,
                });
            }

            for block in &note.blocks {
                let block_text = self.normalize_search_text(&self.note_block_text(block));
                if block_text.is_empty() {
                    continue;
                }

                if let Some(match_index) = block_text.to_lowercase().find(&normalized_query) {
                    results.push(StandaloneNoteSearchHit {
                        note_id: note.id.clone(),
                        block_id: block.id.clone(),
                        title: note.title.clone(),
                        text: block_text,
                        match_index,
                    });
                }
            }
        }

        Ok(results)
    }

    pub fn save(&self, paths: &StorePaths, mut note: NoteDocument) -> AppResult<NoteDocument> {
        self.normalize_note_document(&mut note);
        note.updated_at = timestamp();
        if note.created_at.trim().is_empty() {
            note.created_at = note.updated_at.clone();
        }

        let mut index = self.load_notes_index(paths)?;
        let previous_last_opened_at = index
            .notes
            .iter()
            .find(|entry| entry.id == note.id)
            .and_then(|entry| entry.last_opened_at.clone());

        paths.write_json_atomically(&paths.note_path(&note.id), &note)?;

        let metadata = self.note_index_entry(&note, previous_last_opened_at);
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

    fn note_index_entry(
        &self,
        note: &NoteDocument,
        last_opened_at: Option<String>,
    ) -> NoteIndexEntry {
        NoteIndexEntry {
            id: note.id.clone(),
            title: note.title.clone(),
            book_id: note.book_id.clone(),
            created_at: note.created_at.clone(),
            updated_at: note.updated_at.clone(),
            last_opened_at,
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
                NoteInlineNode::TopicCard(topic_card) => topic_card.text.trim(),
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
            block.source_reference = self.normalize_source_reference(
                block.r#type,
                block.source_reference.clone(),
                note.book_id.as_deref(),
            );
            block.spans.clear();
        }

        let mut normalized_blocks = Vec::with_capacity(note.blocks.len());
        for block in note.blocks.drain(..) {
            if matches!(block.r#type, NoteBlockType::SectionBreak) {
                continue;
            }
            normalized_blocks.push(block);
        }

        note.blocks = if normalized_blocks.is_empty() {
            vec![self.empty_note_block()]
        } else {
            normalized_blocks
        };
    }

    fn note_sort_at<'a>(&self, entry: &'a NoteIndexEntry) -> &'a str {
        match entry.last_opened_at.as_deref() {
            Some(last_opened_at) if last_opened_at > entry.updated_at.as_str() => last_opened_at,
            _ => entry.updated_at.as_str(),
        }
    }

    fn ensure_standalone_note(&self, note_id: &str, note: &NoteDocument) -> AppResult<()> {
        if note.book_id.is_some() {
            return Err(AppError::InvalidInput(format!(
                "Note {note_id} is attached to a PDF and cannot be managed as a standalone note."
            )));
        }

        Ok(())
    }

    fn note_block_text(&self, block: &NoteBlock) -> String {
        block
            .children
            .iter()
            .map(|child| match child {
                NoteInlineNode::Text(text) => text.text.as_str(),
                NoteInlineNode::PageLink(page_link) => page_link.text.as_str(),
                NoteInlineNode::TopicCard(topic_card) => topic_card.text.as_str(),
            })
            .collect::<Vec<_>>()
            .join("")
    }

    fn normalize_search_text(&self, text: &str) -> String {
        text.split_whitespace().collect::<Vec<_>>().join(" ")
    }

    fn touch_note_last_opened_at(
        &self,
        paths: &StorePaths,
        note_id: &str,
        last_opened_at: Option<String>,
    ) -> AppResult<()> {
        let mut index = self.load_notes_index(paths)?;
        let entry = index
            .notes
            .iter_mut()
            .find(|entry| entry.id == note_id)
            .ok_or_else(|| AppError::DocumentNotFound(note_id.to_string()))?;
        entry.last_opened_at = last_opened_at;
        self.save_notes_index(paths, &index)
    }

    fn normalize_source_reference(
        &self,
        block_type: NoteBlockType,
        source_reference: Option<DocumentSourceReference>,
        fallback_document_id: Option<&str>,
    ) -> Option<DocumentSourceReference> {
        if block_type == NoteBlockType::Paragraph {
            return None;
        }

        let mut reference = source_reference?;
        if reference.id.trim().is_empty() {
            reference.id = Uuid::new_v4().to_string();
        }

        if reference
            .document_id
            .as_deref()
            .unwrap_or("")
            .trim()
            .is_empty()
        {
            reference.document_id = reference
                .target
                .as_ref()
                .map(|target| target.document_id.clone())
                .or_else(|| fallback_document_id.map(ToOwned::to_owned));
        }

        if reference.created_at.trim().is_empty() {
            reference.created_at = timestamp();
        }

        reference.title = if reference.title.trim().is_empty() {
            "Untitled section".to_string()
        } else {
            reference.title.trim().to_string()
        };

        reference.outline_item_id = reference
            .outline_item_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned);

        reference.target = reference.target.and_then(|mut target| {
            if target.document_id.trim().is_empty() {
                if let Some(document_id) = reference.document_id.clone() {
                    target.document_id = document_id;
                }
            }

            if target.document_id.trim().is_empty() {
                return None;
            }

            Some(target)
        });

        match reference.kind {
            DocumentSourceReferenceKind::Direct if reference.target.is_none() => None,
            DocumentSourceReferenceKind::Outline
                if reference.outline_item_id.is_none() && reference.target.is_none() =>
            {
                None
            }
            DocumentSourceReferenceKind::Direct => {
                reference.outline_item_id = None;
                reference.outline_source = None;
                Some(reference)
            }
            DocumentSourceReferenceKind::Outline => Some(reference),
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
            source_reference: None,
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
                NoteInlineNode::TopicCard(topic_card) => {
                    if let Some(current) = pending_text.take() {
                        normalized.push(NoteInlineNode::Text(current));
                    }

                    let text = topic_card.text.split_whitespace().collect::<Vec<_>>().join(" ");
                    if text.is_empty() {
                        continue;
                    }

                    normalized.push(NoteInlineNode::TopicCard(NoteTopicCardNode {
                        id: if topic_card.id.trim().is_empty() {
                            Uuid::new_v4().to_string()
                        } else {
                            topic_card.id.clone()
                        },
                        text,
                        color: self.normalize_topic_color(&topic_card.color),
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
