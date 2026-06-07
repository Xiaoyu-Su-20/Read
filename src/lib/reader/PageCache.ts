import type { RenderedPagePayload } from "../types";

export type CachedRenderedPage = RenderedPagePayload & {
  imageUrl: string;
  requestKey: string;
};

export function makePageCacheKey(documentId: string, pageNumber: number, zoom = 1) {
  return `${documentId}:${pageNumber}:${zoom.toFixed(2)}`;
}

export function createPageCache(maxEntries: number) {
  const entries = new Map<string, CachedRenderedPage>();

  return {
    clear() {
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
    has(key: string) {
      return entries.has(key);
    },
    keys() {
      return [...entries.keys()];
    },
    set(key: string, value: CachedRenderedPage) {
      if (entries.has(key)) {
        entries.delete(key);
      }

      entries.set(key, value);
      while (entries.size > maxEntries) {
        const oldestKey = entries.keys().next().value;
        if (!oldestKey) {
          break;
        }
        entries.delete(oldestKey);
      }
    }
  };
}
