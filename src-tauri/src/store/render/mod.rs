use std::{
    path::Path,
    sync::{Arc, Mutex},
};

use mupdf::{Colorspace, Device, Document, IRect, Matrix, Pixmap};
use serde_json::json;

use crate::{
    debug::process as debug_process,
    error::{AppError, AppResult},
    models::{DocumentRecord, RenderVariant, RenderedPagePayload, TextLayerTransform},
    normalization::{DocumentNormalizationManifest, PageNormalizationEntry},
};

use super::paths::StorePaths;

mod cache;
mod jpeg_windows;

pub use cache::RenderCache;
#[cfg(test)]
pub use cache::MAX_RENDER_CACHE_ENTRIES;
use jpeg_windows::encode_pixmap_as_jpeg;

const RENDERER_VERSION: &str = "mupdf-v5";
const BASE_PDF_RENDER_SCALE: f32 = 1.0;
const JPEG_QUALITY: u32 = 82;
const MIN_RENDER_ZOOM: f32 = 0.1;
const MAX_RENDER_ZOOM: f32 = 5.0;

#[derive(Debug, Clone)]
pub struct PageRenderRequest {
    pub document_id: String,
    pub document_generation_id: Option<String>,
    pub fingerprint: String,
    pub document_path: String,
    pub page_number: u32,
    pub request_sequence: Option<u32>,
    pub zoom: f32,
    pub cache_key: String,
    pub normalization: Option<Arc<DocumentNormalizationManifest>>,
}

#[derive(Debug, Clone, Default)]
pub struct PdfRenderStore;

impl PdfRenderStore {
    pub fn prepare_request(
        &self,
        _paths: &StorePaths,
        document: &DocumentRecord,
        document_path: &Path,
        page_number: u32,
        zoom: f32,
        normalization: Option<Arc<DocumentNormalizationManifest>>,
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

        let normalization_token = normalization
            .as_ref()
            .and_then(|manifest| manifest.cache_token.as_deref());
        let cache_key = self.render_cache_key_with_version(
            &document.id,
            &document.fingerprint,
            page_number,
            zoom,
            normalization_token,
        );

        Ok(PageRenderRequest {
            document_id: document.id.clone(),
            document_generation_id: None,
            fingerprint: document.fingerprint.clone(),
            document_path: document_path.to_string_lossy().to_string(),
            page_number,
            request_sequence: None,
            zoom,
            cache_key,
            normalization,
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

    #[cfg(test)]
    pub fn render_cache_key(&self, document_id: &str, page_number: u32, zoom: f32) -> String {
        format!("{document_id}:{page_number}:{zoom:.2}")
    }

    fn render_cache_key_with_version(
        &self,
        document_id: &str,
        fingerprint: &str,
        page_number: u32,
        zoom: f32,
        normalization_token: Option<&str>,
    ) -> String {
        let variant = normalization_token.unwrap_or("raw");
        format!("{RENDERER_VERSION}:{document_id}:{fingerprint}:{variant}:{page_number}:{zoom:.2}")
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
                "documentGenerationId": request.document_generation_id,
                "page": request.page_number,
                "requestSequence": request.request_sequence,
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

            process.checkpoint("document-open-start", json!({}));
            let document = Document::open(&request.document_path).map_err(|error| {
                AppError::Render(format!("Unable to open PDF with MuPDF: {error}"))
            })?;
            process.checkpoint("document-open-finished", json!({}));

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

            process.checkpoint("page-load-start", json!({}));
            let page = document
                .load_page((request.page_number - 1) as i32)
                .map_err(|error| {
                    AppError::Render(format!(
                        "Unable to load page {} with MuPDF: {error}",
                        request.page_number
                    ))
                })?;
            process.checkpoint("page-load-finished", json!({}));
            let render_scale =
                BASE_PDF_RENDER_SCALE * request.zoom.clamp(MIN_RENDER_ZOOM, MAX_RENDER_ZOOM);
            let page_bounds = page.bounds().map_err(|error| {
                AppError::Render(format!("Unable to measure page bounds: {error}"))
            })?;
            let normalized_entry = request
                .normalization
                .as_ref()
                .and_then(|manifest| manifest.pages.get((request.page_number - 1) as usize))
                .filter(|entry| entry.page_number == request.page_number);
            let rendered = normalized_entry.and_then(|entry| {
                request.normalization.as_ref().and_then(|manifest| {
                    Self::render_normalized_page(&page, page_bounds, manifest, entry, render_scale)
                        .map_err(|error| {
                            crate::debug::action(
                                "store.render_pdf_page_blocking:normalization-fallback",
                                json!({
                                    "documentId": request.document_id,
                                    "error": error.to_string(),
                                    "page": request.page_number,
                                }),
                            );
                            error
                        })
                        .ok()
                })
            });
            let (pixmap, width, height, render_variant, normalization_token, text_layer_transform) =
                if let Some(rendered) = rendered {
                    rendered
                } else {
                    process.checkpoint("rasterize-start", json!({}));
                    let matrix = Matrix::new_scale(render_scale, render_scale);
                    let logical_rect = page_bounds.transform(&matrix).round();
                    let width = logical_rect.width().max(1) as u32;
                    let height = logical_rect.height().max(1) as u32;
                    let colorspace = Colorspace::device_rgb();
                    let pixmap =
                        page.to_pixmap(&matrix, &colorspace, false, true)
                            .map_err(|error| {
                                AppError::Render(format!(
                                    "Unable to render page {} with MuPDF: {error}",
                                    request.page_number
                                ))
                            })?;
                    process.checkpoint(
                        "rasterize-finished",
                        json!({
                            "height": height,
                            "width": width,
                        }),
                    );
                    (
                        pixmap,
                        width,
                        height,
                        RenderVariant::Raw,
                        None,
                        TextLayerTransform {
                            source_width: page_bounds.width(),
                            source_height: page_bounds.height(),
                            matrix: [render_scale, 0.0, 0.0, render_scale, 0.0, 0.0],
                        },
                    )
                };
            process.checkpoint(
                "render-finished",
                json!({
                    "height": height,
                    "width": width,
                }),
            );

            process.checkpoint("jpeg-encode-start", json!({}));
            let image_bytes = encode_pixmap_as_jpeg(&pixmap, JPEG_QUALITY).map_err(|error| {
                AppError::Render(format!(
                    "Unable to encode JPEG for page {}: {error}",
                    request.page_number
                ))
            })?;
            process.checkpoint("jpeg-encode-finished", json!({}));
            process.checkpoint(
                "image-encoded",
                json!({
                    "byteLength": image_bytes.len(),
                    "jpegQuality": JPEG_QUALITY,
                }),
            );

            Self::render_cache_store(
                &render_cache,
                &request,
                width,
                height,
                image_bytes.clone(),
                render_variant,
                normalization_token.clone(),
                text_layer_transform.clone(),
            )?;

            Ok(RenderedPagePayload {
                image_bytes,
                page_number: request.page_number,
                width,
                height,
                cache_key: request.cache_key.clone(),
                render_variant,
                normalization_token,
                text_layer_transform,
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

    fn render_normalized_page(
        page: &mupdf::Page,
        page_bounds: mupdf::Rect,
        manifest: &DocumentNormalizationManifest,
        entry: &PageNormalizationEntry,
        render_scale: f32,
    ) -> AppResult<(
        Pixmap,
        u32,
        u32,
        RenderVariant,
        Option<String>,
        TextLayerTransform,
    )> {
        let frame = manifest.canonical_frame.as_ref().ok_or_else(|| {
            AppError::Render("Normalization manifest has no canonical frame.".to_string())
        })?;
        let width = (frame.width * render_scale).round().max(1.0) as u32;
        let height = (frame.height * render_scale).round().max(1.0) as u32;
        let colorspace = Colorspace::device_rgb();
        let mut pixmap = Pixmap::new_with_w_h(&colorspace, width as i32, height as i32, false)
            .map_err(|error| {
                AppError::Render(format!("Unable to allocate normalized page: {error}"))
            })?;
        // Clear normalized renders to white so the reader's configurable paper surface
        // remains the effective background in both light and dark appearance pipelines.
        pixmap
            .clear_with(255)
            .map_err(|error| {
                AppError::Render(format!("Unable to clear normalized page: {error}"))
            })?;

        let (matrix, affine, placed_width, placed_height) =
            normalized_matrix(entry, page_bounds, render_scale);
        let clip = IRect::new(
            (entry.offset_x * render_scale).floor() as i32,
            (entry.offset_y * render_scale).floor() as i32,
            ((entry.offset_x + placed_width) * render_scale).ceil() as i32,
            ((entry.offset_y + placed_height) * render_scale).ceil() as i32,
        )
        .intersect(&IRect::new(0, 0, width as i32, height as i32));
        let device = Device::from_pixmap_with_clip(&pixmap, clip).map_err(|error| {
            AppError::Render(format!(
                "Unable to create normalized render device: {error}"
            ))
        })?;
        page.run(&device, &matrix).map_err(|error| {
            AppError::Render(format!("Unable to render normalized page: {error}"))
        })?;
        drop(device);

        Ok((
            pixmap,
            width,
            height,
            RenderVariant::Normalized,
            manifest.cache_token.clone(),
            TextLayerTransform {
                source_width: page_bounds.width(),
                source_height: page_bounds.height(),
                matrix: affine,
            },
        ))
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
        image_bytes: Vec<u8>,
        render_variant: RenderVariant,
        normalization_token: Option<String>,
        text_layer_transform: TextLayerTransform,
    ) -> AppResult<()> {
        let mut cache = render_cache
            .lock()
            .map_err(|_| AppError::Render("Unable to lock render cache.".to_string()))?;
        cache.insert(
            request,
            width,
            height,
            image_bytes,
            render_variant,
            normalization_token,
            text_layer_transform,
        );
        Ok(())
    }
}

fn normalized_matrix(
    entry: &PageNormalizationEntry,
    page_bounds: mupdf::Rect,
    render_scale: f32,
) -> (Matrix, [f32; 6], f32, f32) {
    let crop = entry.source_crop_box;
    let local_x = crop.x - page_bounds.x0;
    let local_y = crop.y - page_bounds.y0;
    let scale = entry.scale * render_scale;
    let offset_x = entry.offset_x * render_scale;
    let offset_y = entry.offset_y * render_scale;
    let rotation = entry.rotation.rem_euclid(360);
    let (a, b, c, d, e, f, placed_width, placed_height) = match rotation {
        90 => (
            0.0,
            scale,
            -scale,
            0.0,
            offset_x + (crop.height + local_y) * scale,
            offset_y - local_x * scale,
            crop.height * entry.scale,
            crop.width * entry.scale,
        ),
        180 => (
            -scale,
            0.0,
            0.0,
            -scale,
            offset_x + (crop.width + local_x) * scale,
            offset_y + (crop.height + local_y) * scale,
            crop.width * entry.scale,
            crop.height * entry.scale,
        ),
        270 => (
            0.0,
            -scale,
            scale,
            0.0,
            offset_x - local_y * scale,
            offset_y + (crop.width + local_x) * scale,
            crop.height * entry.scale,
            crop.width * entry.scale,
        ),
        _ => (
            scale,
            0.0,
            0.0,
            scale,
            offset_x - local_x * scale,
            offset_y - local_y * scale,
            crop.width * entry.scale,
            crop.height * entry.scale,
        ),
    };
    let affine = [a, b, c, d, e, f];
    (
        Matrix::new(a, b, c, d, e, f),
        affine,
        placed_width,
        placed_height,
    )
}
