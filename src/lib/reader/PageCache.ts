import type { RenderedPagePayload } from "../types";
import { debugAction } from "../debugLog";

export type CachedRenderedPage = Omit<RenderedPagePayload, "imageBytes"> & {
  documentId: string;
  documentGenerationId: string | null;
  imageUrl: string;
  requestKey: string;
  logicalKey: string;
  renderZoom: number;
  rotation: number;
  encodedByteSize: number;
  estimatedResidentBytes: number;
};

export type RasterLookupIdentity = {
  documentId: string;
  documentGenerationId: string;
  pageNumber: number;
  rasterScale: number;
  rotation: number;
  normalizationToken: string | null;
  renderVariant: RenderedPagePayload["renderVariant"];
};

type RasterCacheEntry = {
  key: string;
  page: CachedRenderedPage;
  retainCount: number;
  pendingEviction: boolean;
};

const RASTER_SCALE_PRECISION = 10_000;

function rasterScaleKey(scale: number) {
  return Math.round(scale * RASTER_SCALE_PRECISION);
}

export function makeRasterFamilyKey(
  identity: Omit<RasterLookupIdentity, "rasterScale">
) {
  return [
    identity.documentId,
    identity.documentGenerationId,
    identity.pageNumber,
    identity.rotation,
    identity.normalizationToken ?? "raw",
    identity.renderVariant
  ].join(":");
}

function makePageRasterFamilyKey(page: CachedRenderedPage) {
  return makeRasterFamilyKey({
    documentId: page.documentId,
    documentGenerationId: page.documentGenerationId ?? "legacy",
    pageNumber: page.pageNumber,
    rotation: page.rotation,
    normalizationToken: page.normalizationToken,
    renderVariant: page.renderVariant
  });
}

function revokeCachedPageImage(
  page: CachedRenderedPage | undefined,
  reason: string,
  retainCount = 0,
  rasterCacheKey: string | null = null
) {
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
      reason,
      rasterCacheKey,
      retainCount,
      zoom: page.renderZoom
    });
    URL.revokeObjectURL(page.imageUrl);
  }
}

export function makePageCacheKey(documentId: string, pageNumber: number, zoom = 1) {
  return `${documentId}:${pageNumber}:${zoom.toFixed(2)}`;
}

export function createPageCache(limit: number | { maxBytes: number }) {
  const entries = new Map<string, RasterCacheEntry>();
  const entriesByFamily = new Map<string, Map<number, RasterCacheEntry>>();
  const pendingEntries = new Map<string, RasterCacheEntry>();
  const maxEntries = typeof limit === "number" ? limit : Number.POSITIVE_INFINITY;
  const maxBytes = typeof limit === "number" ? Number.POSITIVE_INFINITY : limit.maxBytes;
  let residentBytes = 0;

  function indexEntry(entry: RasterCacheEntry) {
    const familyKey = makePageRasterFamilyKey(entry.page);
    let family = entriesByFamily.get(familyKey);
    if (!family) {
      family = new Map();
      entriesByFamily.set(familyKey, family);
    }
    family.set(rasterScaleKey(entry.page.renderZoom), entry);
  }

  function unindexEntry(entry: RasterCacheEntry) {
    const familyKey = makePageRasterFamilyKey(entry.page);
    const family = entriesByFamily.get(familyKey);
    if (!family) {
      return;
    }
    const scaleKey = rasterScaleKey(entry.page.renderZoom);
    if (family.get(scaleKey) === entry) {
      family.delete(scaleKey);
    }
    if (family.size === 0) {
      entriesByFamily.delete(familyKey);
    }
  }

  function touchEntry(entry: RasterCacheEntry) {
    if (entries.get(entry.key) !== entry) {
      return;
    }
    entries.delete(entry.key);
    entries.set(entry.key, entry);
  }

  function findEntry(page: CachedRenderedPage) {
    for (const entry of entries.values()) {
      if (entry.page.imageUrl === page.imageUrl) {
        return entry;
      }
    }
    return pendingEntries.get(page.imageUrl);
  }

  function logBudget(event: string, entry?: RasterCacheEntry) {
    debugAction(event, {
      entryBytes: entry?.page.estimatedResidentBytes ?? null,
      entryCount: entries.size,
      maxBytes: Number.isFinite(maxBytes) ? maxBytes : null,
      page: entry?.page.pageNumber ?? null,
      pinned: entry?.retainCount ?? null,
      residentBytes
    });
  }

  function evictEntry(entry: RasterCacheEntry, reason: string, force = false) {
    if (entry.retainCount > 0 && !force) {
      return false;
    }
    entries.delete(entry.key);
    unindexEntry(entry);
    if (entry.retainCount > 0) {
      entry.pendingEviction = true;
      pendingEntries.set(entry.page.imageUrl, entry);
      debugAction("viewer.blob-url-eviction-deferred", {
        blobUrl: entry.page.imageUrl,
        page: entry.page.pageNumber,
        rasterCacheKey: entry.key,
        reason,
        retainCount: entry.retainCount,
        zoom: entry.page.renderZoom
      });
      return true;
    }
    residentBytes = Math.max(residentBytes - entry.page.estimatedResidentBytes, 0);
    revokeCachedPageImage(entry.page, reason, entry.retainCount, entry.key);
    logBudget("viewer.raster-cache-evicted", entry);
    return true;
  }

  function trim(reason: string, protectedKey?: string) {
    while (entries.size > maxEntries || residentBytes > maxBytes) {
      const candidate = [...entries.values()].find(
        (entry) => entry.key !== protectedKey && entry.retainCount === 0
      );
      if (!candidate || !evictEntry(candidate, reason)) {
        logBudget("viewer.raster-cache-over-budget");
        break;
      }
    }
  }

  return {
    clear() {
      for (const entry of [...entries.values()]) {
        evictEntry(entry, "cache-clear", true);
      }
    },
    get(key: string) {
      const entry = entries.get(key);
      if (!entry) {
        return undefined;
      }

      touchEntry(entry);
      return entry.page;
    },
    getExact(identity: RasterLookupIdentity) {
      const family = entriesByFamily.get(makeRasterFamilyKey(identity));
      const entry = family?.get(rasterScaleKey(identity.rasterScale));
      if (!entry) {
        return null;
      }
      touchEntry(entry);
      return entry.page;
    },
    getCompatibleFallback(identity: RasterLookupIdentity) {
      const family = entriesByFamily.get(makeRasterFamilyKey(identity));
      if (!family || family.size === 0) {
        return null;
      }

      const targetScale = identity.rasterScale;
      const entry = [...family.values()].reduce<RasterCacheEntry | null>((best, candidate) => {
        if (!best) {
          return candidate;
        }
        const candidateDistance = Math.abs(candidate.page.renderZoom - targetScale);
        const bestDistance = Math.abs(best.page.renderZoom - targetScale);
        if (candidateDistance < bestDistance) {
          return candidate;
        }
        if (
          Math.abs(candidateDistance - bestDistance) < 1 / RASTER_SCALE_PRECISION &&
          candidate.page.renderZoom > best.page.renderZoom
        ) {
          return candidate;
        }
        return best;
      }, null);
      if (!entry) {
        return null;
      }
      touchEntry(entry);
      return entry.page;
    },
    getByLogicalKey(logicalKey: string) {
      const match = [...entries.entries()].find(([, entry]) => entry.page.logicalKey === logicalKey);
      if (!match) {
        return undefined;
      }
      const [key, entry] = match;
      entries.delete(key);
      entries.set(key, entry);
      return entry.page;
    },
    has(key: string) {
      return entries.has(key);
    },
    hasLogicalKey(logicalKey: string) {
      return [...entries.values()].some((entry) => entry.page.logicalKey === logicalKey);
    },
    keys() {
      return [...entries.keys()];
    },
    residentBytes() {
      return residentBytes;
    },
    set(key: string, value: CachedRenderedPage) {
      const existing = entries.get(key);
      if (existing?.page === value) {
        entries.delete(key);
        entries.set(key, existing);
        return existing.page;
      }

      if (existing) {
        if (existing.page.imageUrl === value.imageUrl) {
          entries.delete(key);
          entries.set(key, existing);
          return existing.page;
        }
        revokeCachedPageImage(value, "duplicate-insertion", 0, key);
        entries.delete(key);
        entries.set(key, existing);
        return existing.page;
      }

      const entry: RasterCacheEntry = {
        key,
        page: value,
        retainCount: 0,
        pendingEviction: false
      };
      entries.set(key, entry);
      indexEntry(entry);
      residentBytes += value.estimatedResidentBytes;
      trim("lru-eviction", key);
      logBudget("viewer.raster-cache-admitted", entry);
      return value;
    },
    retain(page: CachedRenderedPage) {
      const entry = findEntry(page);
      if (!entry) {
        return false;
      }
      entry.retainCount += 1;
      debugAction("viewer.raster-cache-retained", {
        page: page.pageNumber,
        retainCount: entry.retainCount,
        residentBytes
      });
      return true;
    },
    release(page: CachedRenderedPage) {
      const entry = findEntry(page);
      if (!entry || entry.retainCount <= 0) {
        return;
      }
      entry.retainCount -= 1;
      debugAction("viewer.raster-cache-released", {
        page: page.pageNumber,
        retainCount: entry.retainCount,
        residentBytes
      });
      if (entry.retainCount === 0 && entry.pendingEviction) {
        pendingEntries.delete(entry.page.imageUrl);
        residentBytes = Math.max(residentBytes - entry.page.estimatedResidentBytes, 0);
        revokeCachedPageImage(entry.page, "final-release", 0, entry.key);
      }
      trim("release-trim");
    },
    discard(page: CachedRenderedPage, reason = "obsolete-render") {
      if (!findEntry(page)) {
        revokeCachedPageImage(page, reason, 0);
      }
    }
  };
}
