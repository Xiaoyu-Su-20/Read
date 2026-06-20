use std::{
    collections::{HashMap, HashSet},
    sync::{mpsc, Arc, Mutex},
    thread,
};

use mupdf::{DestinationKind, DisplayList, Document, Outline, Rect, TextPageFlags};
use serde_json::json;

use crate::{
    error::{AppError, AppResult},
    models::{
        NativePoint, NativeQuad, NativeRect, NativeTextChar, NativeTextLine, NativeTextPagePayload,
        PdfNavigationTarget, PdfOutlineItem, PdfOutlineSource,
    },
    store::PageRenderRequest,
};

const DEFAULT_DISPLAY_LIST_CACHE_BYTES: usize = 64 * 1024 * 1024;
const DISPLAY_LIST_ESTIMATE_BYTES_PER_POINT: f32 = 4.0;

#[derive(Debug, Clone)]
pub struct DisplayListWarmupRequest {
    pub document_id: String,
    pub document_generation_id: Option<String>,
    pub fingerprint: String,
    pub document_path: String,
    pub page_numbers: Vec<u32>,
}

#[derive(Debug, Clone)]
pub struct NativeTextPageRequest {
    pub document_id: String,
    pub document_generation_id: Option<String>,
    pub fingerprint: String,
    pub document_path: String,
    pub page_number: u32,
}

#[derive(Debug, Clone)]
pub struct NativeOutlineRequest {
    pub document_id: String,
    pub document_generation_id: Option<String>,
    pub fingerprint: String,
    pub document_path: String,
}

#[derive(Clone)]
pub struct RenderSessionRegistry {
    inner: Arc<Mutex<RenderSessionRegistryState>>,
    display_list_byte_budget: usize,
}

#[derive(Default)]
struct RenderSessionRegistryState {
    sessions: HashMap<String, Arc<PdfRenderSession>>,
}

#[derive(Debug, Clone)]
pub struct SessionDisplayListPage {
    pub display_list: Arc<DisplayList>,
    pub bounds: Rect,
    pub source: DisplayListSource,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DisplayListSource {
    Hit,
    Miss,
}

impl DisplayListSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Hit => "hit",
            Self::Miss => "miss",
        }
    }
}

impl Default for RenderSessionRegistry {
    fn default() -> Self {
        Self::with_display_list_byte_budget(DEFAULT_DISPLAY_LIST_CACHE_BYTES)
    }
}

impl RenderSessionRegistry {
    pub fn with_display_list_byte_budget(display_list_byte_budget: usize) -> Self {
        Self {
            inner: Arc::new(Mutex::new(RenderSessionRegistryState::default())),
            display_list_byte_budget,
        }
    }

    pub fn get_display_list(
        &self,
        request: &PageRenderRequest,
    ) -> AppResult<SessionDisplayListPage> {
        let session = self.session_for(
            &request.fingerprint,
            &request.document_path,
            &request.document_id,
        )?;
        session.get_display_list(&request.document_id, request.page_number)
    }

    pub fn warm_display_lists(&self, request: DisplayListWarmupRequest) -> AppResult<()> {
        if request.page_numbers.is_empty() {
            return Ok(());
        }

        let session = self.session_for(
            &request.fingerprint,
            &request.document_path,
            &request.document_id,
        )?;
        session.warm_display_lists(&request.document_id, request.page_numbers)
    }

    pub fn get_native_text_page(
        &self,
        request: NativeTextPageRequest,
    ) -> AppResult<NativeTextPagePayload> {
        let session = self.session_for(
            &request.fingerprint,
            &request.document_path,
            &request.document_id,
        )?;
        session.get_native_text_page(&request.document_id, request.page_number)
    }

    pub fn get_native_outline(
        &self,
        request: NativeOutlineRequest,
    ) -> AppResult<Vec<PdfOutlineItem>> {
        let session = self.session_for(
            &request.fingerprint,
            &request.document_path,
            &request.document_id,
        )?;
        session.get_native_outline(&request.document_id)
    }

    pub fn drop_fingerprint(&self, fingerprint: &str) {
        if let Ok(mut registry) = self.inner.lock() {
            registry.sessions.remove(fingerprint);
        }
    }

    fn session_for(
        &self,
        fingerprint: &str,
        document_path: &str,
        document_id: &str,
    ) -> AppResult<Arc<PdfRenderSession>> {
        let mut registry = self
            .inner
            .lock()
            .map_err(|_| AppError::Render("Unable to lock render session registry.".to_string()))?;

        if let Some(session) = registry.sessions.get(fingerprint) {
            return Ok(session.clone());
        }

        let session = Arc::new(PdfRenderSession::start(
            fingerprint.to_string(),
            document_path.to_string(),
            self.display_list_byte_budget,
        )?);
        crate::debug::action(
            "render-session.created",
            json!({
                "documentId": document_id,
                "fingerprint": fingerprint,
            }),
        );
        registry
            .sessions
            .insert(fingerprint.to_string(), session.clone());
        Ok(session)
    }

    #[cfg(test)]
    pub fn stats_for_fingerprint(&self, fingerprint: &str) -> Option<DisplayListSessionStats> {
        let session = {
            let registry = self.inner.lock().ok()?;
            registry.sessions.get(fingerprint)?.clone()
        };
        session.stats().ok()
    }
}

struct PdfRenderSession {
    sender: mpsc::Sender<RenderSessionMessage>,
}

impl PdfRenderSession {
    fn start(
        fingerprint: String,
        document_path: String,
        display_list_byte_budget: usize,
    ) -> AppResult<Self> {
        let (sender, receiver) = mpsc::channel();
        thread::Builder::new()
            .name(format!("pdf-render-session-{fingerprint}"))
            .spawn(move || {
                let mut actor =
                    RenderSessionActor::new(fingerprint, document_path, display_list_byte_budget);
                actor.run(receiver);
            })
            .map_err(|error| {
                AppError::Render(format!("Unable to start PDF render session: {error}"))
            })?;

        Ok(Self { sender })
    }

    fn get_display_list(
        &self,
        document_id: &str,
        page_number: u32,
    ) -> AppResult<SessionDisplayListPage> {
        let (reply_sender, reply_receiver) = mpsc::channel();
        self.sender
            .send(RenderSessionMessage::GetDisplayList {
                document_id: document_id.to_string(),
                page_number,
                reply_sender,
            })
            .map_err(|_| AppError::Render("PDF render session is unavailable.".to_string()))?;

        reply_receiver
            .recv()
            .map_err(|_| AppError::Render("PDF render session stopped.".to_string()))?
            .map_err(AppError::Render)
    }

    fn warm_display_lists(&self, document_id: &str, page_numbers: Vec<u32>) -> AppResult<()> {
        let (reply_sender, reply_receiver) = mpsc::channel();
        self.sender
            .send(RenderSessionMessage::WarmDisplayLists {
                document_id: document_id.to_string(),
                page_numbers,
                reply_sender,
            })
            .map_err(|_| AppError::Render("PDF render session is unavailable.".to_string()))?;

        reply_receiver
            .recv()
            .map_err(|_| AppError::Render("PDF render session stopped.".to_string()))?
            .map_err(AppError::Render)
    }

    fn get_native_text_page(
        &self,
        document_id: &str,
        page_number: u32,
    ) -> AppResult<NativeTextPagePayload> {
        let (reply_sender, reply_receiver) = mpsc::channel();
        self.sender
            .send(RenderSessionMessage::GetNativeTextPage {
                document_id: document_id.to_string(),
                page_number,
                reply_sender,
            })
            .map_err(|_| AppError::Render("PDF render session is unavailable.".to_string()))?;

        reply_receiver
            .recv()
            .map_err(|_| AppError::Render("PDF render session stopped.".to_string()))?
            .map_err(AppError::Render)
    }

    fn get_native_outline(&self, document_id: &str) -> AppResult<Vec<PdfOutlineItem>> {
        let (reply_sender, reply_receiver) = mpsc::channel();
        self.sender
            .send(RenderSessionMessage::GetNativeOutline {
                document_id: document_id.to_string(),
                reply_sender,
            })
            .map_err(|_| AppError::Render("PDF render session is unavailable.".to_string()))?;

        reply_receiver
            .recv()
            .map_err(|_| AppError::Render("PDF render session stopped.".to_string()))?
            .map_err(AppError::Render)
    }

    #[cfg(test)]
    fn stats(&self) -> Result<DisplayListSessionStats, String> {
        let (reply_sender, reply_receiver) = mpsc::channel();
        self.sender
            .send(RenderSessionMessage::Stats { reply_sender })
            .map_err(|_| "PDF render session is unavailable.".to_string())?;

        reply_receiver
            .recv()
            .map_err(|_| "PDF render session stopped.".to_string())
    }
}

enum RenderSessionMessage {
    GetDisplayList {
        document_id: String,
        page_number: u32,
        reply_sender: mpsc::Sender<Result<SessionDisplayListPage, String>>,
    },
    WarmDisplayLists {
        document_id: String,
        page_numbers: Vec<u32>,
        reply_sender: mpsc::Sender<Result<(), String>>,
    },
    GetNativeTextPage {
        document_id: String,
        page_number: u32,
        reply_sender: mpsc::Sender<Result<NativeTextPagePayload, String>>,
    },
    GetNativeOutline {
        document_id: String,
        reply_sender: mpsc::Sender<Result<Vec<PdfOutlineItem>, String>>,
    },
    #[cfg(test)]
    Stats {
        reply_sender: mpsc::Sender<DisplayListSessionStats>,
    },
}

struct RenderSessionActor {
    fingerprint: String,
    document_path: String,
    document: Option<Document>,
    document_error: Option<String>,
    cache: DisplayListCache,
    text_cache: NativeTextPageCache,
}

impl RenderSessionActor {
    fn new(fingerprint: String, document_path: String, display_list_byte_budget: usize) -> Self {
        Self {
            fingerprint,
            document_path,
            document: None,
            document_error: None,
            cache: DisplayListCache::new(display_list_byte_budget),
            text_cache: NativeTextPageCache::default(),
        }
    }

    fn run(&mut self, receiver: mpsc::Receiver<RenderSessionMessage>) {
        while let Ok(message) = receiver.recv() {
            match message {
                RenderSessionMessage::GetDisplayList {
                    document_id,
                    page_number,
                    reply_sender,
                } => {
                    let _ = reply_sender.send(self.load_display_list(&document_id, page_number));
                }
                RenderSessionMessage::WarmDisplayLists {
                    document_id,
                    page_numbers,
                    reply_sender,
                } => {
                    let _ = reply_sender.send(self.warm_display_lists(&document_id, page_numbers));
                }
                RenderSessionMessage::GetNativeTextPage {
                    document_id,
                    page_number,
                    reply_sender,
                } => {
                    let _ =
                        reply_sender.send(self.load_native_text_page(&document_id, page_number));
                }
                RenderSessionMessage::GetNativeOutline {
                    document_id,
                    reply_sender,
                } => {
                    let _ = reply_sender.send(self.load_native_outline(&document_id));
                }
                #[cfg(test)]
                RenderSessionMessage::Stats { reply_sender } => {
                    let _ = reply_sender.send(self.cache.stats());
                }
            }
        }
    }

    fn ensure_document(&mut self, document_id: &str) -> Result<&Document, String> {
        if let Some(error) = self.document_error.as_ref() {
            return Err(error.clone());
        }

        if self.document.is_none() {
            let document = Document::open(&self.document_path).map_err(|error| {
                let message = format!("Unable to open PDF with MuPDF: {error}");
                self.document_error = Some(message.clone());
                message
            })?;
            crate::debug::action(
                "render-session.document-opened",
                json!({
                    "documentId": document_id,
                    "fingerprint": self.fingerprint,
                }),
            );
            self.document = Some(document);
        }

        self.document
            .as_ref()
            .ok_or_else(|| "PDF render session has no document.".to_string())
    }

    fn load_display_list(
        &mut self,
        document_id: &str,
        page_number: u32,
    ) -> Result<SessionDisplayListPage, String> {
        if let Some(cached) = self.cache.get(page_number) {
            crate::debug::action(
                "display-list.cache-hit",
                json!({
                    "documentId": document_id,
                    "fingerprint": self.fingerprint,
                    "page": page_number,
                }),
            );
            return Ok(cached);
        }

        self.cache.record_miss();
        crate::debug::action(
            "display-list.cache-miss",
            json!({
                "documentId": document_id,
                "fingerprint": self.fingerprint,
                "page": page_number,
            }),
        );

        let (page_count, bounds, display_list) = {
            let document = self.ensure_document(document_id)?;
            let page_count = document
                .page_count()
                .map_err(|error| format!("Unable to inspect PDF pages: {error}"))?;
            if page_number == 0 || page_number > page_count as u32 {
                return Err(format!(
                    "Page {} is out of bounds for this document.",
                    page_number
                ));
            }

            let page = document
                .load_page((page_number - 1) as i32)
                .map_err(|error| {
                    format!("Unable to load page {page_number} with MuPDF: {error}")
                })?;
            let bounds = page
                .bounds()
                .map_err(|error| format!("Unable to measure page bounds: {error}"))?;
            let display_list = page.to_display_list(true).map_err(|error| {
                format!("Unable to build display list for page {page_number}: {error}")
            })?;
            (page_count, bounds, display_list)
        };

        let cached = self.cache.insert(page_number, bounds, display_list);
        crate::debug::action(
            "display-list.loaded",
            json!({
                "documentId": document_id,
                "entryCount": self.cache.entry_count(),
                "estimatedBytes": self.cache.estimated_bytes(),
                "fingerprint": self.fingerprint,
                "page": page_number,
                "pageCount": page_count,
            }),
        );
        Ok(cached)
    }

    fn warm_display_lists(
        &mut self,
        document_id: &str,
        page_numbers: Vec<u32>,
    ) -> Result<(), String> {
        let ordered_pages = unique_pages(page_numbers);
        if ordered_pages.is_empty() {
            return Ok(());
        }

        crate::debug::action(
            "display-list.warm-start",
            json!({
                "documentId": document_id,
                "fingerprint": self.fingerprint,
                "pages": ordered_pages.clone(),
            }),
        );
        self.cache.set_pinned_pages(ordered_pages.iter().copied());

        for page_number in &ordered_pages {
            self.load_display_list(document_id, *page_number)?;
        }
        self.cache.evict_over_budget();

        crate::debug::action(
            "display-list.warm-finish",
            json!({
                "documentId": document_id,
                "entryCount": self.cache.entry_count(),
                "estimatedBytes": self.cache.estimated_bytes(),
                "fingerprint": self.fingerprint,
                "pages": ordered_pages.clone(),
            }),
        );
        Ok(())
    }

    fn load_native_text_page(
        &mut self,
        document_id: &str,
        page_number: u32,
    ) -> Result<NativeTextPagePayload, String> {
        if let Some(cached) = self.text_cache.get(page_number) {
            crate::debug::action(
                "native-text.cache-hit",
                json!({
                    "charCount": cached.chars.len(),
                    "documentId": document_id,
                    "fingerprint": self.fingerprint,
                    "lineCount": cached.lines.len(),
                    "page": page_number,
                }),
            );
            return Ok((*cached).clone());
        }

        crate::debug::action(
            "native-text.cache-miss",
            json!({
                "documentId": document_id,
                "fingerprint": self.fingerprint,
                "page": page_number,
            }),
        );
        let started_at = std::time::Instant::now();
        let display_list_page = self.load_display_list(document_id, page_number)?;
        let payload = native_text_page_from_display_list(
            page_number,
            display_list_page.bounds,
            display_list_page.display_list.as_ref(),
        )?;
        self.text_cache.insert(page_number, payload.clone());
        crate::debug::action(
            "native-text.loaded",
            json!({
                "charCount": payload.chars.len(),
                "documentId": document_id,
                "elapsedMs": started_at.elapsed().as_millis(),
                "entryCount": self.text_cache.entry_count(),
                "fingerprint": self.fingerprint,
                "lineCount": payload.lines.len(),
                "page": page_number,
            }),
        );
        Ok(payload)
    }

    fn load_native_outline(&mut self, document_id: &str) -> Result<Vec<PdfOutlineItem>, String> {
        let started_at = std::time::Instant::now();
        let outlines = {
            let document = self.ensure_document(document_id)?;
            document
                .outlines()
                .map_err(|error| format!("Unable to load PDF outline with MuPDF: {error}"))?
        };
        let items = native_outline_items(document_id, &outlines, "outline");
        crate::debug::action(
            "native-outline.loaded",
            json!({
                "documentId": document_id,
                "elapsedMs": started_at.elapsed().as_millis(),
                "fingerprint": self.fingerprint,
                "itemCount": count_outline_items(&items),
                "rootItemCount": items.len(),
            }),
        );
        Ok(items)
    }
}

fn native_outline_items(
    document_id: &str,
    outlines: &[Outline],
    prefix: &str,
) -> Vec<PdfOutlineItem> {
    outlines
        .iter()
        .enumerate()
        .map(|(index, outline)| {
            let source_id = format!("{prefix}-{index}");
            let target = outline.dest.as_ref().map(|dest| PdfNavigationTarget {
                document_id: document_id.to_string(),
                page_index: dest.loc.page_number,
                x: destination_x(&dest.kind),
                y: destination_y(&dest.kind),
                zoom: destination_zoom(&dest.kind),
                fit: Some(destination_fit(&dest.kind).to_string()),
            });
            PdfOutlineItem {
                id: format!("embedded:{source_id}"),
                title: outline.title.trim().to_string(),
                source: PdfOutlineSource::Embedded,
                source_id: Some(source_id.clone()),
                target,
                page: outline.dest.as_ref().map(|dest| dest.loc.page_number + 1),
                external_url: if outline.dest.is_none() {
                    outline.uri.clone()
                } else {
                    None
                },
                bold: false,
                italic: false,
                color: None,
                items: native_outline_items(document_id, &outline.down, &source_id),
                created_at: None,
            }
        })
        .collect()
}

fn destination_fit(kind: &DestinationKind) -> &'static str {
    match kind {
        DestinationKind::XYZ { .. } => "xyz",
        DestinationKind::Fit | DestinationKind::FitB => "fit",
        DestinationKind::FitH { .. } | DestinationKind::FitBH { .. } => "fitH",
        DestinationKind::FitV { .. } | DestinationKind::FitBV { .. } => "fitV",
        DestinationKind::FitR { .. } => "fitR",
    }
}

fn destination_x(kind: &DestinationKind) -> Option<f32> {
    match kind {
        DestinationKind::XYZ { left, .. } => *left,
        DestinationKind::FitV { left } | DestinationKind::FitBV { left } => *left,
        DestinationKind::FitR { left, .. } => Some(*left),
        _ => None,
    }
}

fn destination_y(kind: &DestinationKind) -> Option<f32> {
    match kind {
        DestinationKind::XYZ { top, .. } => *top,
        DestinationKind::FitH { top } | DestinationKind::FitBH { top } => *top,
        DestinationKind::FitR { top, .. } => Some(*top),
        _ => None,
    }
}

fn destination_zoom(kind: &DestinationKind) -> Option<f32> {
    match kind {
        DestinationKind::XYZ { zoom, .. } => *zoom,
        _ => None,
    }
}

fn count_outline_items(items: &[PdfOutlineItem]) -> usize {
    items
        .iter()
        .map(|item| 1 + count_outline_items(&item.items))
        .sum()
}

fn unique_pages(page_numbers: Vec<u32>) -> Vec<u32> {
    let mut seen = HashSet::new();
    page_numbers
        .into_iter()
        .filter(|page_number| *page_number > 0 && seen.insert(*page_number))
        .collect()
}

struct DisplayListCache {
    entries: HashMap<u32, DisplayListCacheEntry>,
    pinned_pages: HashSet<u32>,
    next_access_order: u64,
    estimated_bytes: usize,
    byte_budget: usize,
    hits: u64,
    misses: u64,
    loaded_count: u64,
}

struct DisplayListCacheEntry {
    page_number: u32,
    display_list: Arc<DisplayList>,
    bounds: Rect,
    estimated_bytes: usize,
    access_order: u64,
}

impl DisplayListCache {
    fn new(byte_budget: usize) -> Self {
        Self {
            entries: HashMap::new(),
            pinned_pages: HashSet::new(),
            next_access_order: 0,
            estimated_bytes: 0,
            byte_budget,
            hits: 0,
            misses: 0,
            loaded_count: 0,
        }
    }

    fn next_access_order(&mut self) -> u64 {
        self.next_access_order = self.next_access_order.saturating_add(1);
        self.next_access_order
    }

    fn get(&mut self, page_number: u32) -> Option<SessionDisplayListPage> {
        let next_access_order = self.next_access_order();
        let entry = self.entries.get_mut(&page_number)?;
        entry.access_order = next_access_order;
        self.hits = self.hits.saturating_add(1);
        Some(SessionDisplayListPage {
            display_list: entry.display_list.clone(),
            bounds: entry.bounds,
            source: DisplayListSource::Hit,
        })
    }

    fn record_miss(&mut self) {
        self.misses = self.misses.saturating_add(1);
    }

    fn insert(
        &mut self,
        page_number: u32,
        bounds: Rect,
        display_list: DisplayList,
    ) -> SessionDisplayListPage {
        let estimated_bytes = estimate_display_list_bytes(bounds);
        if let Some(existing) = self.entries.remove(&page_number) {
            self.estimated_bytes = self
                .estimated_bytes
                .saturating_sub(existing.estimated_bytes);
        }

        let display_list = Arc::new(display_list);
        self.estimated_bytes = self.estimated_bytes.saturating_add(estimated_bytes);
        self.loaded_count = self.loaded_count.saturating_add(1);
        let access_order = self.next_access_order();
        self.entries.insert(
            page_number,
            DisplayListCacheEntry {
                page_number,
                display_list: display_list.clone(),
                bounds,
                estimated_bytes,
                access_order,
            },
        );
        self.evict_over_budget();

        SessionDisplayListPage {
            display_list,
            bounds,
            source: DisplayListSource::Miss,
        }
    }

    fn set_pinned_pages(&mut self, page_numbers: impl IntoIterator<Item = u32>) {
        self.pinned_pages = page_numbers.into_iter().collect();
    }

    fn evict_over_budget(&mut self) {
        if self.byte_budget == 0 {
            return;
        }

        while self.estimated_bytes > self.byte_budget {
            let evict_page = self
                .entries
                .values()
                .filter(|entry| !self.pinned_pages.contains(&entry.page_number))
                .min_by_key(|entry| entry.access_order)
                .map(|entry| entry.page_number);

            let Some(evict_page) = evict_page else {
                break;
            };
            if let Some(entry) = self.entries.remove(&evict_page) {
                self.estimated_bytes = self.estimated_bytes.saturating_sub(entry.estimated_bytes);
            }
        }
    }

    fn entry_count(&self) -> usize {
        self.entries.len()
    }

    fn estimated_bytes(&self) -> usize {
        self.estimated_bytes
    }

    #[cfg(test)]
    fn stats(&self) -> DisplayListSessionStats {
        DisplayListSessionStats {
            entry_pages: self.entries.keys().copied().collect(),
            pinned_pages: self.pinned_pages.iter().copied().collect(),
            estimated_bytes: self.estimated_bytes,
            hits: self.hits,
            misses: self.misses,
            loaded_count: self.loaded_count,
        }
    }
}

fn estimate_display_list_bytes(bounds: Rect) -> usize {
    let area = bounds.width().max(1.0) * bounds.height().max(1.0);
    (area * DISPLAY_LIST_ESTIMATE_BYTES_PER_POINT)
        .round()
        .max(1.0) as usize
}

#[derive(Default)]
struct NativeTextPageCache {
    entries: HashMap<u32, Arc<NativeTextPagePayload>>,
}

impl NativeTextPageCache {
    fn get(&self, page_number: u32) -> Option<Arc<NativeTextPagePayload>> {
        self.entries.get(&page_number).cloned()
    }

    fn insert(&mut self, page_number: u32, payload: NativeTextPagePayload) {
        self.entries.insert(page_number, Arc::new(payload));
    }

    fn entry_count(&self) -> usize {
        self.entries.len()
    }
}

fn native_text_page_from_display_list(
    page_number: u32,
    bounds: Rect,
    display_list: &DisplayList,
) -> Result<NativeTextPagePayload, String> {
    let text_page = display_list
        .to_text_page(TextPageFlags::empty())
        .map_err(|error| {
            format!("Unable to extract native text for page {page_number}: {error}")
        })?;
    let mut lines = Vec::new();
    let mut chars = Vec::new();

    for block in text_page.blocks() {
        for line in block.lines() {
            let line_index = lines.len() as u32;
            let char_start = chars.len() as u32;
            let mut line_text = String::new();

            for text_char in line.chars() {
                let Some(value) = text_char.char() else {
                    continue;
                };
                let text = value.to_string();
                line_text.push(value);
                let index = chars.len() as u32;
                chars.push(NativeTextChar {
                    index,
                    line_index,
                    text,
                    quad: native_quad(text_char.quad(), bounds),
                    origin: native_point(text_char.origin(), bounds),
                    size: text_char.size(),
                    flags: text_char.flags().bits(),
                });
            }

            let char_end = chars.len() as u32;
            if char_end == char_start {
                continue;
            }

            lines.push(NativeTextLine {
                index: line_index,
                char_start,
                char_end,
                bounds: native_rect(line.bounds(), bounds),
                text: line_text,
            });
        }
    }

    Ok(NativeTextPagePayload {
        page_number,
        source_width: bounds.width(),
        source_height: bounds.height(),
        bounds: NativeRect {
            x0: bounds.x0,
            y0: bounds.y0,
            x1: bounds.x1,
            y1: bounds.y1,
        },
        lines,
        chars,
    })
}

fn native_point(point: mupdf::Point, bounds: Rect) -> NativePoint {
    NativePoint {
        x: point.x - bounds.x0,
        y: point.y - bounds.y0,
    }
}

fn native_quad(quad: mupdf::Quad, bounds: Rect) -> NativeQuad {
    NativeQuad {
        ul: native_point(quad.ul, bounds),
        ur: native_point(quad.ur, bounds),
        ll: native_point(quad.ll, bounds),
        lr: native_point(quad.lr, bounds),
    }
}

fn native_rect(rect: Rect, bounds: Rect) -> NativeRect {
    NativeRect {
        x0: rect.x0 - bounds.x0,
        y0: rect.y0 - bounds.y0,
        x1: rect.x1 - bounds.x0,
        y1: rect.y1 - bounds.y0,
    }
}

#[cfg(test)]
#[derive(Debug, Clone)]
pub struct DisplayListSessionStats {
    pub entry_pages: Vec<u32>,
    pub pinned_pages: Vec<u32>,
    pub estimated_bytes: usize,
    pub hits: u64,
    pub misses: u64,
    pub loaded_count: u64,
}
