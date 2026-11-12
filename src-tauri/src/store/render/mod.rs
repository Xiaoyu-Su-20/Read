use std::{
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

use mupdf::{Colorspace, Cookie, CookieAbortHandle, Device, Document, IRect, Matrix, Pixmap, Rect};
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
mod session;

pub use cache::RenderCache;
use jpeg_windows::encode_pixmap_as_jpeg;
pub use session::{
    DisplayListWarmupRequest, NativeOutlineRequest, NativeTextPageRequest, RenderSessionRegistry,
    SessionDisplayListPage,
};

/// Error text for a render that was cancelled by the caller (an expected outcome, not a failure).
pub const RENDER_CANCELLED_MESSAGE: &str = "Render request cancelled.";
/// Error text for a render skipped because its reader generation is no longer active.
pub const STALE_RENDER_MESSAGE: &str = "Stale render request skipped.";

/// True when `message` (an `AppError` display string or a bare command error) describes a
/// render that was cancelled or superseded rather than one that failed.
pub fn is_expected_render_outcome(message: &str) -> bool {
    message.contains(RENDER_CANCELLED_MESSAGE) || message.contains(STALE_RENDER_MESSAGE)
}

/// Cancellation state shared between a render request and `cancel_pdf_page_render`.
///
/// Besides the flag checked between render phases, it can abort the MuPDF run that is currently
/// executing: the render registers its cookie's abort handle for the duration of the run.
#[derive(Debug, Default)]
pub struct RenderCancellation {
    cancelled: AtomicBool,
    abort: Mutex<Option<CookieAbortHandle>>,
}

impl RenderCancellation {
    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    /// Marks the request cancelled and aborts any MuPDF run currently attached.
    pub fn cancel(&self) {
        // The flag must be visible before the abort so a run that stops early is always
        // recognised as cancelled by the post-run check and its partial pixmap is discarded.
        self.cancelled.store(true, Ordering::Release);
        if let Ok(abort) = self.abort.lock() {
            if let Some(handle) = abort.as_ref() {
                // SAFETY: the handle is detached (under this same lock) before its cookie is
                // dropped, see `CookieAbortGuard`.
                unsafe { handle.abort() };
            }
        }
    }

    /// Attaches `cookie` until the returned guard is dropped. The guard must be dropped before
    /// the cookie.
    fn attach<'a>(&'a self, cookie: &Cookie) -> CookieAbortGuard<'a> {
        let handle = cookie.abort_handle();
        if let Ok(mut abort) = self.abort.lock() {
            if self.is_cancelled() {
                // Cancelled before the run started: make it return immediately.
                // SAFETY: the cookie is alive (borrowed by the caller).
                unsafe { handle.abort() };
            }
            *abort = Some(handle);
        }
        CookieAbortGuard { cancellation: self }
    }
}

struct CookieAbortGuard<'a> {
    cancellation: &'a RenderCancellation,
}

impl Drop for CookieAbortGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut abort) = self.cancellation.abort.lock() {
            *abort = None;
        }
    }
}

const RENDERER_VERSION: &str = "mupdf-v6";
const BASE_PDF_RENDER_SCALE: f32 = 1.0;
const JPEG_QUALITY: u32 = 92;
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
    pub request_id: Option<String>,
    pub cancellation: Option<Arc<RenderCancellation>>,
    pub expected_normalization_token: Option<String>,
    pub expected_render_variant: Option<RenderVariant>,
    pub expected_rotation: Option<i32>,
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
            request_id: None,
            cancellation: None,
            expected_normalization_token: None,
            expected_render_variant: None,
            expected_rotation: None,
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
        render_sessions: RenderSessionRegistry,
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
            ensure_render_not_cancelled(&request, "before-cache-lookup")?;
            if let Some(cached) = Self::render_cache_lookup(&render_cache, &request)? {
                process.checkpoint(
                    "cache-hit",
                    json!({
                        "cancelled": false,
                        "displayListSource": null,
                        "height": cached.height,
                        "width": cached.width,
                    }),
                );
                return Ok(cached);
            }
            process.checkpoint("cache-miss", json!({}));

            process.checkpoint("display-list-request-start", json!({}));
            let display_list_page = render_sessions.get_display_list(&request)?;
            ensure_render_not_cancelled(&request, "after-display-list")?;
            let display_list_source = display_list_page.source.as_str();
            process.checkpoint(
                "display-list-request-finished",
                json!({
                    "displayListSource": display_list_source,
                    "page": request.page_number,
                }),
            );

            let cookie = Cookie::new().map_err(|error| {
                AppError::Render(format!("Unable to create MuPDF render cookie: {error}"))
            })?;
            // Declared after the cookie so it detaches before the cookie is freed.
            let _abort_guard = request
                .cancellation
                .as_ref()
                .map(|cancellation| cancellation.attach(&cookie));

            process.checkpoint(
                "render-started",
                json!({
                    "displayListSource": display_list_source,
                    "scale": BASE_PDF_RENDER_SCALE * request.zoom,
                }),
            );

            let render_scale =
                BASE_PDF_RENDER_SCALE * request.zoom.clamp(MIN_RENDER_ZOOM, MAX_RENDER_ZOOM);
            let page_bounds = display_list_page.bounds;
            let normalized_entry = request
                .normalization
                .as_ref()
                .and_then(|manifest| manifest.pages.get((request.page_number - 1) as usize))
                .filter(|entry| entry.page_number == request.page_number);
            let rendered = if let Some((manifest, entry)) = normalized_entry.and_then(|entry| {
                request
                    .normalization
                    .as_ref()
                    .map(|manifest| (manifest, entry))
            }) {
                match Self::render_normalized_page(
                    &display_list_page,
                    page_bounds,
                    manifest,
                    entry,
                    render_scale,
                    &cookie,
                    &request,
                ) {
                    Ok(rendered) => Some(rendered),
                    Err(error) if request.expected_render_variant == Some(RenderVariant::Normalized) => {
                        return Err(error);
                    }
                    Err(error) => {
                        crate::debug::action(
                            "store.render_pdf_page_blocking:normalization-fallback",
                            json!({
                                "documentId": request.document_id.as_str(),
                                "error": error.to_string(),
                                "page": request.page_number,
                            }),
                        );
                        None
                    }
                }
            } else {
                None
            };
            let (
                pixmap,
                width,
                height,
                page_base_width,
                page_base_height,
                render_variant,
                normalization_token,
                text_layer_transform,
            ) =
                if let Some(rendered) = rendered {
                    rendered
                } else {
                    process.checkpoint(
                        "rasterize-start",
                        json!({
                            "displayListSource": display_list_source,
                        }),
                    );
                    let rendered = Self::render_raw_page(
                        &display_list_page,
                        page_bounds,
                        render_scale,
                        &cookie,
                        &request,
                    )?;
                    process.checkpoint(
                        "rasterize-finished",
                        json!({
                            "cancelled": false,
                            "displayListSource": display_list_source,
                            "height": rendered.2,
                            "width": rendered.1,
                        }),
                    );
                    rendered
                };
            ensure_render_not_cancelled(&request, "after-rasterize")?;
            process.checkpoint(
                "render-finished",
                json!({
                    "cancelled": false,
                    "displayListSource": display_list_source,
                    "height": height,
                    "width": width,
                }),
            );

            process.checkpoint("jpeg-encode-start", json!({}));
            ensure_render_not_cancelled(&request, "before-encode")?;
            let image_bytes = encode_pixmap_as_jpeg(&pixmap, JPEG_QUALITY).map_err(|error| {
                AppError::Render(format!(
                    "Unable to encode JPEG for page {}: {error}",
                    request.page_number
                ))
            })?;
            process.checkpoint("jpeg-encode-finished", json!({}));
            ensure_render_not_cancelled(&request, "before-cache-admission")?;
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
                page_base_width,
                page_base_height,
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
                page_base_width,
                page_base_height,
                cache_key: request.cache_key.clone(),
                render_variant,
                normalization_token,
                text_layer_transform,
            })
        })();

        match &result {
            Ok(payload) => process.finish(json!({
                "cancelled": false,
                "cacheKey": payload.cache_key,
                "height": payload.height,
                "pageNumber": payload.page_number,
                "width": payload.width,
            })),
            Err(error) => {
                let message = error.to_string();
                if is_expected_render_outcome(&message) {
                    process.abandon(&message, json!({}));
                } else {
                    process.fail(&message, json!({}));
                }
            }
        }

        result
    }

    fn render_raw_page(
        display_list_page: &SessionDisplayListPage,
        page_bounds: Rect,
        render_scale: f32,
        cookie: &Cookie,
        request: &PageRenderRequest,
    ) -> AppResult<(
        Pixmap,
        u32,
        u32,
        f32,
        f32,
        RenderVariant,
        Option<String>,
        TextLayerTransform,
    )> {
        let matrix = Matrix::new_scale(render_scale, render_scale);
        let logical_rect = non_empty_irect(page_bounds.transform(&matrix).round());
        let width = logical_rect.width().max(1) as u32;
        let height = logical_rect.height().max(1) as u32;
        let colorspace = Colorspace::device_rgb();
        let mut pixmap = Pixmap::new_with_rect(&colorspace, logical_rect, false)
            .map_err(|error| AppError::Render(format!("Unable to allocate page: {error}")))?;
        pixmap
            .clear_with(255)
            .map_err(|error| AppError::Render(format!("Unable to clear page: {error}")))?;
        let device = Device::from_pixmap(&pixmap).map_err(|error| {
            AppError::Render(format!("Unable to create render device: {error}"))
        })?;
        display_list_page
            .display_list
            .run_with_cookie(&device, &matrix, Rect::INF, cookie)
            .map_err(|error| render_run_error(error, cookie, request))?;
        drop(device);

        Ok((
            pixmap,
            width,
            height,
            page_bounds.width(),
            page_bounds.height(),
            RenderVariant::Raw,
            None,
            TextLayerTransform {
                source_width: page_bounds.width(),
                source_height: page_bounds.height(),
                matrix: [render_scale, 0.0, 0.0, render_scale, 0.0, 0.0],
            },
        ))
    }

    fn render_normalized_page(
        display_list_page: &SessionDisplayListPage,
        page_bounds: mupdf::Rect,
        manifest: &DocumentNormalizationManifest,
        entry: &PageNormalizationEntry,
        render_scale: f32,
        cookie: &Cookie,
        request: &PageRenderRequest,
    ) -> AppResult<(
        Pixmap,
        u32,
        u32,
        f32,
        f32,
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
        pixmap.clear_with(255).map_err(|error| {
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
        display_list_page
            .display_list
            .run_with_cookie(&device, &matrix, Rect::INF, cookie)
            .map_err(|error| render_run_error(error, cookie, request))?;
        drop(device);

        Ok((
            pixmap,
            width,
            height,
            frame.width,
            frame.height,
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
        page_base_width: f32,
        page_base_height: f32,
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
            page_base_width,
            page_base_height,
            image_bytes,
            render_variant,
            normalization_token,
            text_layer_transform,
        );
        Ok(())
    }
}

fn non_empty_irect(rect: IRect) -> IRect {
    let width = rect.width().max(1);
    let height = rect.height().max(1);
    IRect::new(rect.x0, rect.y0, rect.x0 + width, rect.y0 + height)
}

fn ensure_render_not_cancelled(request: &PageRenderRequest, phase: &str) -> AppResult<()> {
    let cancelled = request
        .cancellation
        .as_ref()
        .is_some_and(|cancellation| cancellation.is_cancelled());
    if !cancelled {
        return Ok(());
    }
    crate::debug::action(
        "store.render_pdf_page_blocking:cancelled",
        json!({
            "documentId": request.document_id.as_str(),
            "page": request.page_number,
            "phase": phase,
            "requestId": request.request_id.as_deref(),
            "requestSequence": request.request_sequence,
        }),
    );
    Err(AppError::Render(RENDER_CANCELLED_MESSAGE.to_string()))
}

fn render_run_error(
    error: impl std::fmt::Display,
    _cookie: &Cookie,
    request: &PageRenderRequest,
) -> AppError {
    AppError::Render(format!(
        "Unable to render page {} with MuPDF: {error}",
        request.page_number
    ))
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
