use serde::{Deserialize, Serialize};

pub const ROOT_FOLDER_ID: &str = "root";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FolderRecord {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentRecord {
    pub id: String,
    pub title: String,
    pub file_name: String,
    pub folder_id: String,
    pub relative_path: String,
    pub sidecar_relative_path: String,
    pub fingerprint: String,
    pub imported_at: String,
    pub last_opened_at: Option<String>,
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
            fit_mode: "width".to_string(),
        }
    }
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
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentPayload {
    pub document: DocumentRecord,
    pub state: DocumentState,
    pub file_path: String,
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
    pub version: u32,
    pub folders: Vec<FolderRecord>,
    pub documents: Vec<DocumentRecord>,
    pub last_opened_document_id: Option<String>,
}

impl Default for LibraryIndex {
    fn default() -> Self {
        Self {
            version: 1,
            folders: vec![FolderRecord {
                id: ROOT_FOLDER_ID.to_string(),
                name: "Library".to_string(),
                parent_id: None,
                created_at: crate::store::timestamp(),
            }],
            documents: Vec::new(),
            last_opened_document_id: None,
        }
    }
}
