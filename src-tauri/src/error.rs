use std::io;

use thiserror::Error;

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("I/O error: {0}")]
    Io(#[from] io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Path error: {0}")]
    StripPrefix(#[from] std::path::StripPrefixError),
    #[error("Document not found: {0}")]
    DocumentNotFound(String),
    #[error("Invalid input: {0}")]
    InvalidInput(String),
    #[error("Render error: {0}")]
    Render(String),
}
