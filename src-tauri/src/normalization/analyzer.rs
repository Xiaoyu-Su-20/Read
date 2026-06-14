use std::path::Path;

use mupdf::{pdf::PdfDocument, Colorspace, Matrix};
use uuid::Uuid;

use crate::{
    debug::process as debug_process,
    error::{AppError, AppResult},
    store::timestamp,
};
use serde_json::json;

use super::{
    detection::detect_regions,
    manifest::{
        DocumentNormalizationManifest, NormalizationRect, NormalizationStatus, PageClassification,
        NORMALIZATION_ALGORITHM_VERSION, NORMALIZATION_SCHEMA_VERSION,
    },
    transform::build_transforms,
};

const ANALYSIS_MAX_DIMENSION: f32 = 240.0;
const LOW_CONFIDENCE_THRESHOLD: f32 = 0.6;

#[derive(Debug, Clone)]
pub struct PageMeasurement {
    pub page_number: u32,
    pub source_crop: NormalizationRect,
    pub confidence: f32,
    pub classification: PageClassification,
    pub rotation_correction: i32,
    pub paper_gray: u8,
}

fn map_bitmap_rect(
    rect: NormalizationRect,
    scale: f32,
    page_bounds: mupdf::Rect,
) -> NormalizationRect {
    NormalizationRect {
        x: page_bounds.x0 + rect.x / scale,
        y: page_bounds.y0 + rect.y / scale,
        width: rect.width / scale,
        height: rect.height / scale,
    }
}

pub fn analyze_document(
    document_id: &str,
    fingerprint: &str,
    document_path: &Path,
) -> AppResult<DocumentNormalizationManifest> {
    let process = debug_process(
        "normalization.analyze_document",
        json!({
            "documentId": document_id,
            "fingerprint": fingerprint,
        }),
    );
    let path = document_path.to_string_lossy().into_owned();
    let document = PdfDocument::open(&path).map_err(|error| {
        AppError::Normalization(format!("Unable to open PDF for normalization: {error}"))
    })?;
    let page_count = document
        .page_count()
        .map_err(|error| {
            AppError::Normalization(format!("Unable to inspect normalization pages: {error}"))
        })?
        .max(1) as u32;
    process.checkpoint("geometry-inspected", json!({ "pageCount": page_count }));
    let mut measurements = Vec::with_capacity(page_count as usize);

    for page_index in 0..page_count {
        let pdf_page = document.load_pdf_page(page_index as i32).map_err(|error| {
            AppError::Normalization(format!("Unable to load page {}: {error}", page_index + 1))
        })?;
        let _media_box = pdf_page.media_box().map_err(|error| {
            AppError::Normalization(format!("Unable to read MediaBox: {error}"))
        })?;
        let _crop_box = pdf_page
            .crop_box()
            .map_err(|error| AppError::Normalization(format!("Unable to read CropBox: {error}")))?;
        let _declared_rotation = pdf_page.rotation().map_err(|error| {
            AppError::Normalization(format!("Unable to read page rotation: {error}"))
        })?;
        let page_bounds = pdf_page
            .bounds()
            .map_err(|error| AppError::Normalization(format!("Unable to measure page: {error}")))?;
        let analysis_scale = (ANALYSIS_MAX_DIMENSION
            / page_bounds.width().max(page_bounds.height()))
        .clamp(0.05, 1.0);
        let matrix = Matrix::new_scale(analysis_scale, analysis_scale);
        let colorspace = Colorspace::device_gray();
        let pixmap = pdf_page
            .to_pixmap(&matrix, &colorspace, false, false)
            .map_err(|error| {
                AppError::Normalization(format!(
                    "Unable to rasterize page {}: {error}",
                    page_index + 1
                ))
            })?;
        let detection = detect_regions(
            pixmap.samples(),
            pixmap.width() as usize,
            pixmap.height() as usize,
        );
        let full_page = NormalizationRect {
            x: page_bounds.x0,
            y: page_bounds.y0,
            width: page_bounds.width(),
            height: page_bounds.height(),
        };
        let source_crop = if detection.confidence < LOW_CONFIDENCE_THRESHOLD {
            full_page
        } else {
            map_bitmap_rect(detection.paper_box, analysis_scale, page_bounds)
        };
        let content_area = detection.content_box.width * detection.content_box.height;
        let paper_area = (detection.paper_box.width * detection.paper_box.height).max(1.0);
        let density = (content_area / paper_area).clamp(0.0, 1.0);
        let classification = if page_index == 0 {
            PageClassification::Cover
        } else if detection.blank {
            PageClassification::Blank
        } else if page_index < 3 && detection.content_coverage < 0.025 {
            PageClassification::TitlePage
        } else if detection.content_coverage > 0.32 || density > 0.85 {
            PageClassification::ImageHeavy
        } else if detection.content_coverage < 0.018 {
            PageClassification::ChapterOpener
        } else {
            PageClassification::Body
        };

        measurements.push(PageMeasurement {
            page_number: page_index + 1,
            source_crop,
            confidence: detection.confidence,
            classification,
            // MuPDF page bounds and rendering already include the declared PDF rotation.
            rotation_correction: 0,
            paper_gray: detection.paper_gray,
        });
    }

    process.checkpoint(
        "detection-complete",
        json!({ "pageCount": measurements.len() }),
    );

    let (canonical_frame, pages) = build_transforms(&mut measurements);
    process.checkpoint("transforms-generated", json!({ "pageCount": pages.len() }));
    let completed_at = timestamp();
    let manifest = DocumentNormalizationManifest {
        document_id: document_id.to_string(),
        fingerprint: fingerprint.to_string(),
        schema_version: NORMALIZATION_SCHEMA_VERSION,
        algorithm_version: NORMALIZATION_ALGORITHM_VERSION.to_string(),
        status: NormalizationStatus::Ready,
        page_count,
        created_at: completed_at.clone(),
        updated_at: completed_at.clone(),
        completed_at: Some(completed_at),
        cache_token: Some(Uuid::new_v4().to_string()),
        canonical_frame: Some(canonical_frame),
        pages,
        failure: None,
    };
    manifest.validate_ready()?;
    process.finish(json!({ "pageCount": manifest.page_count }));
    Ok(manifest)
}
