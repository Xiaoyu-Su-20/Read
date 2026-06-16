import { convertFileSrc } from "@tauri-apps/api/core";

import { renderPdfPage } from "../api";
import type { RenderedPagePayload } from "../types";
import { makePageCacheKey, type CachedRenderedPage } from "./PageCache";

const inFlightPageRenders = new Map<string, Promise<CachedRenderedPage>>();

export function invalidatePdfPageRenders(documentId: string) {
  const prefix = `${documentId}:`;
  for (const key of inFlightPageRenders.keys()) {
    if (key.startsWith(prefix)) {
      inFlightPageRenders.delete(key);
    }
  }
}

export async function renderVisiblePdfPage(
  documentId: string,
  pageNumber: number,
  zoom: number
): Promise<CachedRenderedPage> {
  const requestKey = makePageCacheKey(documentId, pageNumber, zoom);
  const existing = inFlightPageRenders.get(requestKey);
  if (existing) {
    return existing;
  }

  const nextRender = renderPdfPage(documentId, pageNumber, zoom)
    .then((payload) => toCachedRenderedPage(documentId, zoom, payload))
    .finally(() => {
      if (inFlightPageRenders.get(requestKey) === nextRender) {
        inFlightPageRenders.delete(requestKey);
      }
    });

  inFlightPageRenders.set(requestKey, nextRender);
  return nextRender;
}

export function toCachedRenderedPage(
  documentId: string,
  zoom: number,
  payload: RenderedPagePayload
): CachedRenderedPage {
  return {
    ...payload,
    imageUrl: convertFileSrc(payload.imagePath),
    requestKey: payload.cacheKey,
    logicalKey: makePageCacheKey(documentId, payload.pageNumber, zoom),
    renderZoom: zoom
  };
}
