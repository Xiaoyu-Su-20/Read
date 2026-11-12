use std::collections::HashMap;

use serde::{Deserialize, Serialize};

pub const ROOT_FOLDER_ID: &str = "root";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FolderRecord {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DocumentAvailability {
    Available,
    Missing,
}

impl Default for DocumentAvailability {
    fn default() -> Self {
        Self::Available
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentRecord {
    pub id: String,
    pub title: String,
    pub file_name: String,
    pub folder_id: String,
    pub relative_path: String,
    pub fingerprint: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_size_bytes: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_modified_ms: Option<u64>,
    pub imported_at: String,
    pub last_opened_at: Option<String>,
    #[serde(default)]
    pub availability: DocumentAvailability,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentDeleteState {
    pub can_delete: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Bookmark {
    pub id: String,
    pub page: u32,
    pub label: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PdfNavigationTarget {
    pub document_id: String,
    pub page_index: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub y: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub zoom: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fit: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PdfOutlineSource {
    Embedded,
    User,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PdfOutlineItem {
    pub id: String,
    pub title: String,
    pub source: PdfOutlineSource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<PdfNavigationTarget>,
    #[serde(default)]
    pub page: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external_url: Option<String>,
    #[serde(default)]
    pub bold: bool,
    #[serde(default)]
    pub italic: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<[f32; 3]>,
    #[serde(default)]
    pub items: Vec<PdfOutlineItem>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DocumentSourceReferenceKind {
    Direct,
    Outline,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSourceReference {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub document_id: Option<String>,
    pub kind: DocumentSourceReferenceKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outline_item_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outline_source: Option<PdfOutlineSource>,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<PdfNavigationTarget>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentState {
    pub version: u32,
    pub document_id: String,
    pub fingerprint: String,
    pub last_opened_at: Option<String>,
    pub last_page: u32,
    #[serde(default = "default_scroll_zoom", alias = "zoom")]
    pub scroll_zoom: f32,
    pub bookmarks: Vec<Bookmark>,
}

fn default_scroll_zoom() -> f32 {
    1.0
}

impl DocumentState {
    pub fn new(document_id: String, fingerprint: String) -> Self {
        Self {
            version: 2,
            document_id,
            fingerprint,
            last_opened_at: None,
            last_page: 1,
            scroll_zoom: default_scroll_zoom(),
            bookmarks: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentPayload {
    pub document: DocumentRecord,
    pub state: DocumentState,
    pub file_path: String,
    pub page_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EffectivePageGeometry {
    pub page_number: u32,
    pub base_width: f32,
    pub base_height: f32,
    pub rotation: i32,
    pub normalization_token: Option<String>,
    pub source: EffectivePageGeometrySource,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum EffectivePageGeometrySource {
    Normalized,
    Raw,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RenderedPagePayload {
    pub image_bytes: Vec<u8>,
    pub page_number: u32,
    pub width: u32,
    pub height: u32,
    pub page_base_width: f32,
    pub page_base_height: f32,
    pub cache_key: String,
    pub render_variant: RenderVariant,
    pub normalization_token: Option<String>,
    pub text_layer_transform: TextLayerTransform,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RenderVariant {
    Raw,
    Normalized,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TextLayerTransform {
    pub source_width: f32,
    pub source_height: f32,
    pub matrix: [f32; 6],
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NativeTextPagePayload {
    pub page_number: u32,
    pub source_width: f32,
    pub source_height: f32,
    pub bounds: NativeRect,
    pub lines: Vec<NativeTextLine>,
    pub chars: Vec<NativeTextChar>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NativePoint {
    pub x: f32,
    pub y: f32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NativeQuad {
    pub ul: NativePoint,
    pub ur: NativePoint,
    pub ll: NativePoint,
    pub lr: NativePoint,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NativeRect {
    pub x0: f32,
    pub y0: f32,
    pub x1: f32,
    pub y1: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NativeTextLine {
    pub index: u32,
    pub char_start: u32,
    pub char_end: u32,
    pub bounds: NativeRect,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NativeTextChar {
    pub index: u32,
    pub line_index: u32,
    pub text: String,
    pub quad: NativeQuad,
    pub origin: NativePoint,
    pub size: f32,
    pub flags: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FolderTreeNode {
    pub folder: FolderRecord,
    pub folders: Vec<FolderTreeNode>,
    pub documents: Vec<DocumentRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryIndex {
    #[serde(default = "default_index_version")]
    pub version: u32,
    #[serde(default)]
    pub documents: Vec<DocumentRecord>,
    #[serde(default)]
    pub collection_order: Vec<String>,
    #[serde(default)]
    pub document_order_by_collection: HashMap<String, Vec<String>>,
    #[serde(default)]
    pub last_opened_document_id: Option<String>,
}

impl Default for LibraryIndex {
    fn default() -> Self {
        Self {
            version: default_index_version(),
            documents: Vec::new(),
            collection_order: Vec::new(),
            document_order_by_collection: HashMap::new(),
            last_opened_document_id: None,
        }
    }
}

fn default_index_version() -> u32 {
    3
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoteSpan {
    pub text: String,
    #[serde(default)]
    pub bold: bool,
    #[serde(default)]
    pub italic: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoteTextNode {
    pub text: String,
    #[serde(default)]
    pub bold: bool,
    #[serde(default)]
    pub italic: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NotePageLinkNode {
    pub id: String,
    pub text: String,
    pub document_id: Option<String>,
    pub pdf_page_index: Option<u32>,
    pub book_page_label: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoteTopicCardNode {
    pub id: String,
    pub text: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum NoteInlineNode {
    Text(NoteTextNode),
    #[serde(rename = "page-link")]
    PageLink(NotePageLinkNode),
    #[serde(rename = "topic-card")]
    TopicCard(NoteTopicCardNode),
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NoteBlockType {
    Paragraph,
    Heading1,
    Heading2,
    Heading3,
    #[serde(alias = "sectionBreakShort", alias = "sectionBreakFull")]
    SectionBreak,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NoteBlock {
    pub id: String,
    pub r#type: NoteBlockType,
    #[serde(default)]
    pub children: Vec<NoteInlineNode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_reference: Option<DocumentSourceReference>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub spans: Vec<NoteSpan>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NoteDocument {
    pub id: String,
    pub title: String,
    pub book_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub version: u32,
    #[serde(default)]
    pub blocks: Vec<NoteBlock>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoteIndexEntry {
    pub id: String,
    pub title: String,
    pub book_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub last_opened_at: Option<String>,
    pub excerpt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StandaloneNoteSearchHit {
    pub note_id: String,
    pub block_id: String,
    pub title: String,
    pub text: String,
    pub match_index: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoteIndex {
    #[serde(default = "default_note_index_version")]
    pub version: u32,
    #[serde(default)]
    pub notes: Vec<NoteIndexEntry>,
}

impl Default for NoteIndex {
    fn default() -> Self {
        Self {
            version: default_note_index_version(),
            notes: Vec::new(),
        }
    }
}

fn default_note_index_version() -> u32 {
    1
}
