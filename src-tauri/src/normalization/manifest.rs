use std::{fs, path::Path};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

pub const NORMALIZATION_SCHEMA_VERSION: u32 = 1;
pub const NORMALIZATION_ALGORITHM_VERSION: &str = "page-normalization-v1";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NormalizationRect {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

impl NormalizationRect {
    fn is_valid(self) -> bool {
        [self.x, self.y, self.width, self.height]
            .iter()
            .all(|value| value.is_finite())
            && self.width > 0.0
            && self.height > 0.0
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NormalizationStatus {
    Processing,
    Ready,
    Failed,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PageClassification {
    Body,
    Cover,
    TitlePage,
    ChapterOpener,
    Blank,
    ImageHeavy,
    GeometricOutlier,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CanonicalFrame {
    pub width: f32,
    pub height: f32,
    pub anchor_policy: String,
    pub safe_padding: f32,
    pub background_gray: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PageNormalizationEntry {
    pub page_number: u32,
    pub source_crop_box: NormalizationRect,
    pub rotation: i32,
    pub scale: f32,
    pub offset_x: f32,
    pub offset_y: f32,
    pub classification: PageClassification,
    pub confidence: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentNormalizationManifest {
    pub document_id: String,
    pub fingerprint: String,
    pub schema_version: u32,
    pub algorithm_version: String,
    pub status: NormalizationStatus,
    pub page_count: u32,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub canonical_frame: Option<CanonicalFrame>,
    #[serde(default)]
    pub pages: Vec<PageNormalizationEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failure: Option<String>,
}

impl DocumentNormalizationManifest {
    pub fn processing(
        document_id: String,
        fingerprint: String,
        page_count: u32,
        timestamp: String,
    ) -> Self {
        Self {
            document_id,
            fingerprint,
            schema_version: NORMALIZATION_SCHEMA_VERSION,
            algorithm_version: NORMALIZATION_ALGORITHM_VERSION.to_string(),
            status: NormalizationStatus::Processing,
            page_count,
            created_at: timestamp.clone(),
            updated_at: timestamp,
            completed_at: None,
            cache_token: None,
            canonical_frame: None,
            pages: Vec::new(),
            failure: None,
        }
    }

    pub fn is_current_ready(&self, fingerprint: &str) -> bool {
        self.status == NormalizationStatus::Ready
            && self.fingerprint == fingerprint
            && self.schema_version == NORMALIZATION_SCHEMA_VERSION
            && self.algorithm_version == NORMALIZATION_ALGORITHM_VERSION
            && self.validate_ready().is_ok()
    }

    pub fn validate_ready(&self) -> AppResult<()> {
        if self.status != NormalizationStatus::Ready {
            return Err(AppError::Normalization(
                "Normalization manifest is not ready.".to_string(),
            ));
        }
        if self.schema_version != NORMALIZATION_SCHEMA_VERSION
            || self.algorithm_version != NORMALIZATION_ALGORITHM_VERSION
        {
            return Err(AppError::Normalization(
                "Normalization manifest version is stale.".to_string(),
            ));
        }
        if self.cache_token.as_deref().unwrap_or_default().is_empty() {
            return Err(AppError::Normalization(
                "Normalization manifest has no cache token.".to_string(),
            ));
        }
        let frame = self.canonical_frame.as_ref().ok_or_else(|| {
            AppError::Normalization("Normalization manifest has no canonical frame.".to_string())
        })?;
        if !frame.width.is_finite()
            || !frame.height.is_finite()
            || !frame.safe_padding.is_finite()
            || frame.width <= 0.0
            || frame.height <= 0.0
            || frame.safe_padding < 0.0
        {
            return Err(AppError::Normalization(
                "Normalization canonical frame is invalid.".to_string(),
            ));
        }
        if self.page_count == 0 || self.pages.len() != self.page_count as usize {
            return Err(AppError::Normalization(
                "Normalization manifest does not cover every page.".to_string(),
            ));
        }

        for (index, page) in self.pages.iter().enumerate() {
            let rotated = page.rotation.rem_euclid(180) == 90;
            let placed_width = if rotated {
                page.source_crop_box.height * page.scale
            } else {
                page.source_crop_box.width * page.scale
            };
            let placed_height = if rotated {
                page.source_crop_box.width * page.scale
            } else {
                page.source_crop_box.height * page.scale
            };
            if page.page_number != index as u32 + 1
                || !page.source_crop_box.is_valid()
                || !page.scale.is_finite()
                || page.scale <= 0.0
                || !page.offset_x.is_finite()
                || !page.offset_y.is_finite()
                || !page.confidence.is_finite()
                || !(0.0..=1.0).contains(&page.confidence)
                || !matches!(page.rotation.rem_euclid(360), 0 | 90 | 180 | 270)
                || page.offset_x < -0.5
                || page.offset_y < -0.5
                || page.offset_x + placed_width > frame.width + 1.0
                || page.offset_y + placed_height > frame.height + 1.0
            {
                return Err(AppError::Normalization(format!(
                    "Normalization entry {} is invalid.",
                    page.page_number
                )));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ready_manifest() -> DocumentNormalizationManifest {
        DocumentNormalizationManifest {
            document_id: "doc".to_string(),
            fingerprint: "fingerprint".to_string(),
            schema_version: NORMALIZATION_SCHEMA_VERSION,
            algorithm_version: NORMALIZATION_ALGORITHM_VERSION.to_string(),
            status: NormalizationStatus::Ready,
            page_count: 1,
            created_at: "now".to_string(),
            updated_at: "now".to_string(),
            completed_at: Some("now".to_string()),
            cache_token: Some("token".to_string()),
            canonical_frame: Some(CanonicalFrame {
                width: 100.0,
                height: 120.0,
                anchor_policy: "topCenter".to_string(),
                safe_padding: 4.0,
                background_gray: 245,
            }),
            pages: vec![PageNormalizationEntry {
                page_number: 1,
                source_crop_box: NormalizationRect {
                    x: 0.0,
                    y: 0.0,
                    width: 80.0,
                    height: 100.0,
                },
                rotation: 0,
                scale: 1.0,
                offset_x: 10.0,
                offset_y: 4.0,
                classification: PageClassification::Body,
                confidence: 0.9,
            }],
            failure: None,
        }
    }

    #[test]
    fn validates_complete_current_manifest() {
        let manifest = ready_manifest();
        assert!(manifest.validate_ready().is_ok());
        assert!(manifest.is_current_ready("fingerprint"));
        assert!(!manifest.is_current_ready("changed"));
    }

    #[test]
    fn rejects_non_finite_and_out_of_frame_transforms() {
        let mut manifest = ready_manifest();
        manifest.pages[0].scale = f32::NAN;
        assert!(manifest.validate_ready().is_err());

        let mut manifest = ready_manifest();
        manifest.pages[0].offset_x = 30.0;
        assert!(manifest.validate_ready().is_err());
    }

    #[test]
    fn rejects_incomplete_page_coverage_and_stale_versions() {
        let mut manifest = ready_manifest();
        manifest.page_count = 2;
        assert!(manifest.validate_ready().is_err());

        let mut manifest = ready_manifest();
        manifest.schema_version += 1;
        assert!(manifest.validate_ready().is_err());
    }
}

pub fn load_manifest(path: &Path) -> AppResult<DocumentNormalizationManifest> {
    let raw = fs::read_to_string(path)?;
    Ok(serde_json::from_str(&raw)?)
}
