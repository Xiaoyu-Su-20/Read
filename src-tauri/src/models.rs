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
    pub imported_at: String,
    pub last_opened_at: Option<String>,
    #[serde(default)]
    pub availability: DocumentAvailability,
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
pub struct ReaderPreferences {
    pub fit_mode: String,
}

impl Default for ReaderPreferences {
    fn default() -> Self {
        Self {
            fit_mode: "auto-maximize".to_string(),
        }
    }
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
    pub zoom: f32,
    pub bookmarks: Vec<Bookmark>,
    pub preferences: ReaderPreferences,
    #[serde(default)]
    pub user_outline_items: Vec<PdfOutlineItem>,
}

impl DocumentState {
    pub fn new(document_id: String, fingerprint: String) -> Self {
        Self {
            version: 1,
            document_id,
            fingerprint,
            last_opened_at: None,
            last_page: 1,
            zoom: 1.0,
            bookmarks: Vec::new(),
            preferences: ReaderPreferences::default(),
            user_outline_items: Vec::new(),
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
pub struct RenderedPagePayload {
    pub image_path: String,
    pub page_number: u32,
    pub width: u32,
    pub height: u32,
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
    pub last_opened_document_id: Option<String>,
}

impl Default for LibraryIndex {
    fn default() -> Self {
        Self {
            version: default_index_version(),
            documents: Vec::new(),
            last_opened_document_id: None,
        }
    }
}

fn default_index_version() -> u32 {
    2
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
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum NoteInlineNode {
    Text(NoteTextNode),
    #[serde(rename = "page-link")]
    PageLink(NotePageLinkNode),
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NoteBlockType {
    Paragraph,
    Heading1,
    Heading2,
    Heading3,
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
    pub excerpt: String,
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
