use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use mupdf::{Colorspace, Document, Matrix};
use serde_json::json;
use sha2::{Digest, Sha256};

use crate::{
    debug::process as debug_process,
    error::{AppError, AppResult},
    models::{DocumentRecord, RenderedPagePayload},
};

use super::paths::StorePaths;

mod cache;
mod jpeg_windows;

pub use cache::RenderCache;
#[cfg(test)]
pub use cache::MAX_RENDER_CACHE_ENTRIES;
use jpeg_windows::write_pixmap_as_jpeg;

const RENDERER_VERSION: &str = "mupdf-v2";
const BASE_PDF_RENDER_SCALE: f32 = 1.0;
const JPEG_QUALITY: u32 = 82;
const MIN_RENDER_ZOOM: f32 = 0.1;
const MAX_RENDER_ZOOM: f32 = 5.0;

#[derive(Debug, Clone)]
pub struct PageRenderRequest {
    pub document_id: String,
    pub fingerprint: String,
    pub document_path: String,
    pub page_number: u32,
    pub zoom: f32,
    pub cache_key: String,
    pub image_path: PathBuf,
}

#[derive(Debug, Clone, Default)]
pub struct PdfRenderStore;

impl PdfRenderStore {
    pub fn prepare_request(
        &self,
        paths: &StorePaths,
        document: &DocumentRecord,
        document_path: &Path,
        page_number: u32,
        zoom: f32,
    ) -> AppResult<PageRenderRequest> {
        if page_number == 0 {
            return Err(AppError::InvalidInput(
                "Page numbers must be 1-based.".to_string(),
            ));
        }

        if !(MIN_RENDER_ZOOM..=MAX_RENDER_ZOOM).contains(&zoom) {
            return Err(AppError::InvalidInput(format!(
                "Zoom must be between {MIN_RENDER_ZOOM:.1} and {MAX_RENDER_ZOOM:.1}."
            )));
        }

        let cache_key = self.render_cache_key(&document.id, page_number, zoom);
        let image_path = self.render_output_path(
            paths,
            &document.id,
            &document.fingerprint,
            page_number,
            zoom,
        );

        Ok(PageRenderRequest {
            document_id: document.id.clone(),
            fingerprint: document.fingerprint.clone(),
            document_path: document_path.to_string_lossy().to_string(),
            page_number,
            zoom,
            cache_key,
            image_path,
        })
    }

    pub fn document_page_count(&self, path: &Path) -> AppResult<u32> {
        let document_path = path.to_string_lossy().into_owned();
        let document = Document::open(&document_path)
            .map_err(|error| AppError::Render(format!("Unable to open PDF with MuPDF: {error}")))?;
        let page_count = document
            .page_count()
            .map_err(|error| AppError::Render(format!("Unable to inspect PDF pages: {error}")))?;
        Ok(page_count.max(1) as u32)
    }

    pub fn render_cache_key(&self, document_id: &str, page_number: u32, zoom: f32) -> String {
        format!("{document_id}:{page_number}:{zoom:.2}")
    }

    fn render_output_path(
        &self,
        paths: &StorePaths,
        document_id: &str,
        fingerprint: &str,
        page_number: u32,
        zoom: f32,
    ) -> PathBuf {
        let digest = Sha256::digest(
            format!("{RENDERER_VERSION}:{document_id}:{fingerprint}:{page_number}:{zoom:.2}")
                .as_bytes(),
        );
        paths.rendered_pages_dir.join(format!(
            "{RENDERER_VERSION}-{}-p{page_number}-z{:.2}.jpg",
            &format!("{digest:x}")[..16],
            zoom
        ))
    }

    pub fn render_pdf_page_blocking(
        request: PageRenderRequest,
        render_cache: Arc<Mutex<RenderCache>>,
    ) -> AppResult<RenderedPagePayload> {
        let process = debug_process(
            "store.render_pdf_page_blocking",
            json!({
                "cacheKey": request.cache_key,
                "documentId": request.document_id,
                "imagePath": request.image_path.to_string_lossy().to_string(),
                "page": request.page_number,
                "zoom": request.zoom,
            }),
        );

        let result = (|| -> AppResult<RenderedPagePayload> {
            if let Some(cached) = Self::render_cache_lookup(&render_cache, &request)? {
                process.checkpoint(
                    "cache-hit",
                    json!({
                        "height": cached.height,
                        "width": cached.width,
                    }),
                );
                return Ok(cached);
            }
            process.checkpoint("cache-miss", json!({}));

            let document = Document::open(&request.document_path).map_err(|error| {
                AppError::Render(format!("Unable to open PDF with MuPDF: {error}"))
            })?;

            let page_count = document.page_count().map_err(|error| {
                AppError::Render(format!("Unable to inspect PDF pages: {error}"))
            })?;
            if request.page_number > page_count as u32 {
                return Err(AppError::InvalidInput(format!(
                    "Page {} is out of bounds for this document.",
                    request.page_number
                )));
            }
            process.checkpoint(
                "render-started",
                json!({
                    "pageCount": page_count,
                    "scale": BASE_PDF_RENDER_SCALE * request.zoom,
                }),
            );

            let page = document
                .load_page((request.page_number - 1) as i32)
                .map_err(|error| {
                    AppError::Render(format!(
                        "Unable to load page {} with MuPDF: {error}",
                        request.page_number
                    ))
                })?;
            let render_scale =
                BASE_PDF_RENDER_SCALE * request.zoom.clamp(MIN_RENDER_ZOOM, MAX_RENDER_ZOOM);
            let matrix = Matrix::new_scale(render_scale, render_scale);
            let logical_rect = page
                .bounds()
                .map_err(|error| {
                    AppError::Render(format!("Unable to measure page bounds: {error}"))
                })?
                .transform(&matrix)
                .round();
            let width = logical_rect.width().max(1) as u32;
            let height = logical_rect.height().max(1) as u32;
            let colorspace = Colorspace::device_rgb();
            let pixmap = page
                .to_pixmap(&matrix, &colorspace, false, true)
                .map_err(|error| {
                    AppError::Render(format!(
                        "Unable to render page {} with MuPDF: {error}",
                        request.page_number
                    ))
                })?;
            process.checkpoint(
                "render-finished",
                json!({
                    "height": height,
                    "width": width,
                }),
            );

            write_pixmap_as_jpeg(&request.image_path, &pixmap, JPEG_QUALITY).map_err(|error| {
                AppError::Render(format!(
                    "Unable to write JPEG for page {}: {error}",
                    request.page_number
                ))
            })?;
            process.checkpoint(
                "image-written",
                json!({
                    "jpegQuality": JPEG_QUALITY,
                }),
            );

            let evicted_paths = Self::render_cache_store(&render_cache, &request, width, height)?;
            for path in evicted_paths {
                if path != request.image_path {
                    let _ = fs::remove_file(path);
                }
            }

            Ok(RenderedPagePayload {
                image_path: request.image_path.to_string_lossy().to_string(),
                page_number: request.page_number,
                width,
                height,
                cache_key: request.cache_key.clone(),
            })
        })();

        match &result {
            Ok(payload) => process.finish(json!({
                "cacheKey": payload.cache_key,
                "height": payload.height,
                "pageNumber": payload.page_number,
                "width": payload.width,
            })),
            Err(error) => process.fail(&error.to_string(), json!({})),
        }

        result
    }

    fn render_cache_lookup(
        render_cache: &Arc<Mutex<RenderCache>>,
        request: &PageRenderRequest,
    ) -> AppResult<Option<RenderedPagePayload>> {
        let mut cache = render_cache
            .lock()
            .map_err(|_| AppError::Render("Unable to lock render cache.".to_string()))?;
        Ok(cache.get(request))
    }

    fn render_cache_store(
        render_cache: &Arc<Mutex<RenderCache>>,
        request: &PageRenderRequest,
        width: u32,
        height: u32,
    ) -> AppResult<Vec<PathBuf>> {
        let mut cache = render_cache
            .lock()
            .map_err(|_| AppError::Render("Unable to lock render cache.".to_string()))?;
        Ok(cache.insert(request, width, height))
    }
}
