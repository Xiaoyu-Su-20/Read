import type { RenderedPagePayload } from "../types";
import { debugAction } from "../debugLog";

export type CachedRenderedPage = RenderedPagePayload & {
  documentId: string;
  imageUrl: string;
  requestKey: string;
  logicalKey: string;
  renderZoom: number;
};

function revokeCachedPageImage(page: CachedRenderedPage | undefined) {
  if (!page) {
    return;
  }

  if (page.imageUrl.startsWith("blob:")) {
    debugAction("viewer.blob-url-revoked", {
      blobUrl: page.imageUrl,
      cacheKey: page.cacheKey,
      documentId: page.documentId,
      logicalKey: page.logicalKey,
      page: page.pageNumber,
      zoom: page.renderZoom
    });
    URL.revokeObjectURL(page.imageUrl);
  }
}

export function makePageCacheKey(documentId: string, pageNumber: number, zoom = 1) {
  return `${documentId}:${pageNumber}:${zoom.toFixed(2)}`;
}

export function createPageCache(maxEntries: number) {
  const entries = new Map<string, CachedRenderedPage>();

  return {
    clear() {
      for (const page of entries.values()) {
        revokeCachedPageImage(page);
      }
      entries.clear();
    },
    get(key: string) {
      const cached = entries.get(key);
      if (!cached) {
        return undefined;
      }

      entries.delete(key);
      entries.set(key, cached);
      return cached;
    },
    getByLogicalKey(logicalKey: string) {
      const match = [...entries.entries()].find(([, page]) => page.logicalKey === logicalKey);
      if (!match) {
        return undefined;
      }
      const [key, page] = match;
      entries.delete(key);
      entries.set(key, page);
      return page;
    },
    has(key: string) {
      return entries.has(key);
    },
    hasLogicalKey(logicalKey: string) {
      return [...entries.values()].some((page) => page.logicalKey === logicalKey);
    },
    keys() {
      return [...entries.keys()];
    },
    set(key: string, value: CachedRenderedPage) {
      const existing = entries.get(key);
      if (existing === value) {
        entries.delete(key);
        entries.set(key, value);
        return;
      }

      if (existing) {
        revokeCachedPageImage(existing);
        entries.delete(key);
      }

      entries.set(key, value);
      while (entries.size > maxEntries) {
        const oldestKey = entries.keys().next().value;
        if (!oldestKey) {
          break;
        }
        revokeCachedPageImage(entries.get(oldestKey));
        entries.delete(oldestKey);
      }
    }
  };
}
