import type { RenderedPagePayload } from "./types";

type RenderedPageCacheEntry = RenderedPagePayload;

export function makeRenderCacheKey(documentId: string, pageNumber: number) {
  return `${documentId}:${pageNumber}`;
}

export function shouldIgnoreRenderResponse(
  requestSequence: number,
  activeSequence: number
) {
  return requestSequence !== activeSequence;
}

export function createRenderedPageCache(maxEntries: number) {
  const entries = new Map<string, RenderedPageCacheEntry>();

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
    keys() {
      return [...entries.keys()];
    },
    set(key: string, value: RenderedPageCacheEntry) {
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
