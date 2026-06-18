import { renderPdfPage } from "../api";
import { debugAction } from "../debugLog";
import type { RenderedPagePayload } from "../types";
import { makePageCacheKey, type CachedRenderedPage } from "./PageCache";

const inFlightPageRenders = new Map<string, Promise<CachedRenderedPage>>();
const completedPageRenders = new Map<string, { documentId: string; payload: RenderedPagePayload; zoom: number }>();
const MAX_COMPLETED_PAGE_RENDERS = 40;

export type RenderRequestCaller = "foreground" | "preload";
export type RendererAcquisitionSource = "completed-registry" | "inflight-join" | "fresh-render";

export function invalidatePdfPageRenders(documentId: string) {
  const prefix = `${documentId}:`;
  for (const key of inFlightPageRenders.keys()) {
    if (key.startsWith(prefix)) {
      inFlightPageRenders.delete(key);
    }
  }
  for (const key of completedPageRenders.keys()) {
    if (key.startsWith(prefix)) {
      completedPageRenders.delete(key);
    }
  }
}

export function getCompletedRenderedPage(
  documentId: string,
  pageNumber: number,
  zoom: number,
  caller: RenderRequestCaller
) {
  const requestKey = makePageCacheKey(documentId, pageNumber, zoom);
  const cached = completedPageRenders.get(requestKey);
  if (!cached) {
    return null;
  }

  completedPageRenders.delete(requestKey);
  completedPageRenders.set(requestKey, cached);
  debugAction("renderer.completed-registry-hit", {
    caller,
    documentId,
    logicalKey: requestKey,
    page: pageNumber,
    zoom
  });
  return toCachedRenderedPage(documentId, zoom, cached.payload);
}

export function getInFlightRenderedPage(
  documentId: string,
  pageNumber: number,
  zoom: number,
  caller: RenderRequestCaller
) {
  const requestKey = makePageCacheKey(documentId, pageNumber, zoom);
  const existing = inFlightPageRenders.get(requestKey);
  if (!existing) {
    return null;
  }

  debugAction("renderer.inflight-joined", {
    caller,
    documentId,
    logicalKey: requestKey,
    page: pageNumber,
    zoom
  });
  return existing;
}

function rememberCompletedRenderedPage(
  documentId: string,
  zoom: number,
  payload: RenderedPagePayload
) {
  const requestKey = makePageCacheKey(documentId, payload.pageNumber, zoom);
  if (completedPageRenders.has(requestKey)) {
    completedPageRenders.delete(requestKey);
  }
  completedPageRenders.set(requestKey, {
    documentId,
    payload,
    zoom
  });

  while (completedPageRenders.size > MAX_COMPLETED_PAGE_RENDERS) {
    const oldestKey = completedPageRenders.keys().next().value;
    if (!oldestKey) {
      break;
    }
    debugAction("renderer.completed-registry-evicted", {
      caller: "preload",
      logicalKey: oldestKey
    });
    completedPageRenders.delete(oldestKey);
  }
}

export async function renderVisiblePdfPage(
  documentId: string,
  pageNumber: number,
  zoom: number,
  options?: {
    caller?: RenderRequestCaller;
    openSessionId?: string | null;
    requestSequence?: number;
  }
): Promise<CachedRenderedPage> {
  const caller = options?.caller ?? "foreground";
  const completed = getCompletedRenderedPage(documentId, pageNumber, zoom, caller);
  if (completed) {
    return completed;
  }

  const existing = getInFlightRenderedPage(documentId, pageNumber, zoom, caller);
  if (existing) {
    return existing;
  }

  return startFreshPdfPageRender(documentId, pageNumber, zoom, options);
}

export function startFreshPdfPageRender(
  documentId: string,
  pageNumber: number,
  zoom: number,
  options?: {
    caller?: RenderRequestCaller;
    openSessionId?: string | null;
    requestSequence?: number;
  }
) {
  const caller = options?.caller ?? "foreground";
  const requestKey = makePageCacheKey(documentId, pageNumber, zoom);
  debugAction("renderer.tauri-invoked", {
    caller,
    documentId,
    logicalKey: requestKey,
    page: pageNumber,
    requestSequence: options?.requestSequence ?? null,
    zoom
  });
  const nextRender = renderPdfPage(documentId, pageNumber, zoom, {
    openSessionId: options?.openSessionId ?? undefined,
    requestSequence: options?.requestSequence
  })
    .then((payload) => {
      rememberCompletedRenderedPage(documentId, zoom, payload);
      return toCachedRenderedPage(documentId, zoom, payload);
    })
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
  const imageBlob = new Blob([Uint8Array.from(payload.imageBytes)], {
    type: "image/jpeg"
  });
  const imageUrl = URL.createObjectURL(imageBlob);

  debugAction("viewer.blob-url-created", {
    blobUrl: imageUrl,
    documentId,
    logicalKey: makePageCacheKey(documentId, payload.pageNumber, zoom),
    page: payload.pageNumber,
    zoom
  });

  return {
    ...payload,
    documentId,
    imageUrl,
    requestKey: payload.cacheKey,
    logicalKey: makePageCacheKey(documentId, payload.pageNumber, zoom),
    renderZoom: zoom
  };
}
