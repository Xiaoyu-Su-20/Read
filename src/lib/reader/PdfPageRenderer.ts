import { renderPdfPage } from "../api";
import { debugAction } from "../debugLog";
import type { RenderedPagePayload } from "../types";
import { makePageCacheKey, type CachedRenderedPage } from "./PageCache";

const inFlightPageRenders = new Map<string, Promise<CachedRenderedPage>>();
const completedPageRenders = new Map<string, { documentId: string; payload: RenderedPagePayload; zoom: number }>();
const MAX_COMPLETED_PAGE_RENDERS = 40;

type RasterIdentity = {
  normalizationToken?: string | null;
  renderVariant?: RenderedPagePayload["renderVariant"];
  rotation?: number;
};

function makeRasterRequestKey(
  documentId: string,
  pageNumber: number,
  zoom: number,
  identity?: RasterIdentity
) {
  const baseKey = makePageCacheKey(documentId, pageNumber, zoom);
  if (!identity) {
    return baseKey;
  }
  return `${baseKey}:r${identity.rotation ?? 0}:n${identity.normalizationToken ?? "raw"}:v${identity.renderVariant ?? "raw"}`;
}

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
  caller: RenderRequestCaller,
  identity?: RasterIdentity
) {
  const requestKey = makeRasterRequestKey(documentId, pageNumber, zoom, identity);
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
  caller: RenderRequestCaller,
  identity?: RasterIdentity
) {
  const requestKey = makeRasterRequestKey(documentId, pageNumber, zoom, identity);
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
  requestKey: string,
  documentId: string,
  zoom: number,
  payload: RenderedPagePayload
) {
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
    expectedNormalizationToken?: string | null;
    expectedRenderVariant?: RenderedPagePayload["renderVariant"];
    rotation?: number;
    bypassRegistry?: boolean;
  }
): Promise<CachedRenderedPage> {
  const caller = options?.caller ?? "foreground";
  const identity =
    options?.expectedNormalizationToken === undefined
      ? undefined
      : {
          normalizationToken: options.expectedNormalizationToken,
          renderVariant: options.expectedRenderVariant,
          rotation: options.rotation
        };
  const completed = options?.bypassRegistry
    ? null
    : getCompletedRenderedPage(documentId, pageNumber, zoom, caller, identity);
  if (completed) {
    return completed;
  }

  const existing = options?.bypassRegistry
    ? null
    : getInFlightRenderedPage(documentId, pageNumber, zoom, caller, identity);
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
    expectedNormalizationToken?: string | null;
    expectedRenderVariant?: RenderedPagePayload["renderVariant"];
    rotation?: number;
  }
) {
  const caller = options?.caller ?? "foreground";
  const identity =
    options?.expectedNormalizationToken === undefined
      ? undefined
      : {
          normalizationToken: options.expectedNormalizationToken,
          renderVariant: options.expectedRenderVariant,
          rotation: options.rotation
        };
  const requestKey = makeRasterRequestKey(documentId, pageNumber, zoom, identity);
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
    requestSequence: options?.requestSequence,
    expectedNormalizationToken: options?.expectedNormalizationToken,
    expectedRenderVariant: options?.expectedRenderVariant,
    rotation: options?.rotation
  })
    .then((payload) => {
      rememberCompletedRenderedPage(requestKey, documentId, zoom, payload);
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
  payload: RenderedPagePayload,
  options?: {
    documentGenerationId?: string | null;
    logicalKey?: string;
    rotation?: number;
  }
): CachedRenderedPage {
  const encodedByteSize = payload.imageBytes.length;
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
    pageNumber: payload.pageNumber,
    width: payload.width,
    height: payload.height,
    pageBaseWidth: payload.pageBaseWidth,
    pageBaseHeight: payload.pageBaseHeight,
    cacheKey: payload.cacheKey,
    renderVariant: payload.renderVariant,
    normalizationToken: payload.normalizationToken,
    textLayerTransform: payload.textLayerTransform,
    documentId,
    documentGenerationId: options?.documentGenerationId ?? null,
    imageUrl,
    requestKey: payload.cacheKey,
    logicalKey: options?.logicalKey ?? makePageCacheKey(documentId, payload.pageNumber, zoom),
    renderZoom: zoom,
    rotation: options?.rotation ?? 0,
    encodedByteSize,
    estimatedResidentBytes: payload.width * payload.height * 4 + encodedByteSize
  };
}
