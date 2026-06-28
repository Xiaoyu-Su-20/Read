use std::collections::HashMap;

use serde_json::json;

use crate::models::{RenderVariant, RenderedPagePayload, TextLayerTransform};

use super::PageRenderRequest;

pub const DEFAULT_RENDER_CACHE_BYTE_BUDGET: usize = 64 * 1024 * 1024;

#[derive(Debug, Clone)]
struct RenderCacheEntry {
    cache_key: String,
    fingerprint: String,
    image_bytes: Vec<u8>,
    page_number: u32,
    width: u32,
    height: u32,
    page_base_width: f32,
    page_base_height: f32,
    access_order: u64,
    render_variant: RenderVariant,
    normalization_token: Option<String>,
    text_layer_transform: TextLayerTransform,
}

#[derive(Debug)]
pub struct RenderCache {
    entries: HashMap<String, RenderCacheEntry>,
    next_access_order: u64,
    resident_bytes: usize,
    max_bytes: usize,
}

impl Default for RenderCache {
    fn default() -> Self {
        Self::with_byte_budget(DEFAULT_RENDER_CACHE_BYTE_BUDGET)
    }
}

impl RenderCache {
    pub fn with_byte_budget(max_bytes: usize) -> Self {
        Self {
            entries: HashMap::new(),
            next_access_order: 0,
            resident_bytes: 0,
            max_bytes,
        }
    }

    fn next_access_order(&mut self) -> u64 {
        self.next_access_order = self.next_access_order.saturating_add(1);
        self.next_access_order
    }

    pub fn get(&mut self, request: &PageRenderRequest) -> Option<RenderedPagePayload> {
        let next_access_order = self.next_access_order();
        let should_remove = match self.entries.get(&request.cache_key) {
            Some(entry) => entry.fingerprint != request.fingerprint,
            None => return None,
        };

        if should_remove {
            self.entries.remove(&request.cache_key);
            return None;
        }

        let entry = self.entries.get_mut(&request.cache_key)?;
        entry.access_order = next_access_order;
        Some(RenderedPagePayload {
            image_bytes: entry.image_bytes.clone(),
            page_number: entry.page_number,
            width: entry.width,
            height: entry.height,
            page_base_width: entry.page_base_width,
            page_base_height: entry.page_base_height,
            cache_key: entry.cache_key.clone(),
            render_variant: entry.render_variant,
            normalization_token: entry.normalization_token.clone(),
            text_layer_transform: entry.text_layer_transform.clone(),
        })
    }

    pub fn insert(
        &mut self,
        request: &PageRenderRequest,
        width: u32,
        height: u32,
        page_base_width: f32,
        page_base_height: f32,
        image_bytes: Vec<u8>,
        render_variant: RenderVariant,
        normalization_token: Option<String>,
        text_layer_transform: TextLayerTransform,
    ) {
        if let Some(existing) = self.entries.remove(&request.cache_key) {
            self.resident_bytes = self.resident_bytes.saturating_sub(existing.image_bytes.len());
        }
        if image_bytes.len() > self.max_bytes {
            crate::debug::action(
                "render-cache.admission-skipped",
                json!({
                    "byteLength": image_bytes.len(),
                    "cacheKey": request.cache_key,
                    "maxBytes": self.max_bytes,
                    "reason": "entry-exceeds-budget",
                }),
            );
            return;
        }
        let access_order = self.next_access_order();
        self.resident_bytes = self.resident_bytes.saturating_add(image_bytes.len());

        self.entries.insert(
            request.cache_key.clone(),
            RenderCacheEntry {
                cache_key: request.cache_key.clone(),
                fingerprint: request.fingerprint.clone(),
                image_bytes,
                page_number: request.page_number,
                width,
                height,
                page_base_width,
                page_base_height,
                access_order,
                render_variant,
                normalization_token,
                text_layer_transform,
            },
        );

        while self.resident_bytes > self.max_bytes {
            let oldest_key = self
                .entries
                .iter()
                .min_by_key(|(_, entry)| entry.access_order)
                .map(|(key, _)| key.clone());

            let Some(oldest_key) = oldest_key else {
                break;
            };

            if let Some(removed) = self.entries.remove(&oldest_key) {
                self.resident_bytes = self.resident_bytes.saturating_sub(removed.image_bytes.len());
                crate::debug::action(
                    "render-cache.evicted",
                    json!({
                        "byteLength": removed.image_bytes.len(),
                        "cacheKey": removed.cache_key,
                        "maxBytes": self.max_bytes,
                        "residentBytes": self.resident_bytes,
                    }),
                );
            }
        }
        crate::debug::action(
            "render-cache.admitted",
            json!({
                "cacheKey": request.cache_key,
                "entryCount": self.entries.len(),
                "maxBytes": self.max_bytes,
                "residentBytes": self.resident_bytes,
            }),
        );
    }

    pub fn remove_fingerprint(&mut self, fingerprint: &str) {
        let removed_bytes = self
            .entries
            .values()
            .filter(|entry| entry.fingerprint == fingerprint)
            .map(|entry| entry.image_bytes.len())
            .sum::<usize>();
        self.entries
            .retain(|_, entry| entry.fingerprint != fingerprint);
        self.resident_bytes = self.resident_bytes.saturating_sub(removed_bytes);
    }

    #[cfg(test)]
    pub(crate) fn cache_keys(&self) -> Vec<String> {
        self.entries.keys().cloned().collect()
    }

    #[cfg(test)]
    pub(crate) fn resident_bytes(&self) -> usize {
        self.resident_bytes
    }
}
