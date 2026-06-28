import { describe, expect, it, vi } from "vitest";

import {
  createPageCache,
  makePageCacheKey,
  type CachedRenderedPage,
  type RasterLookupIdentity
} from "./PageCache";

function makeBudgetPage(
  pageNumber: number,
  estimatedResidentBytes: number,
  overrides: Partial<ReturnType<typeof makeBudgetPageBase>> = {}
) {
  return { ...makeBudgetPageBase(pageNumber, estimatedResidentBytes), ...overrides };
}

function makeBudgetPageBase(
  pageNumber: number,
  estimatedResidentBytes: number
): CachedRenderedPage {
  return {
    documentId: "doc",
    documentGenerationId: "session",
    encodedByteSize: 10,
    estimatedResidentBytes,
    imageUrl: `asset://${pageNumber}`,
    pageNumber,
    width: 10,
    height: 20,
    pageBaseWidth: 10,
    pageBaseHeight: 20,
    cacheKey: `doc:${pageNumber}`,
    requestKey: `doc:${pageNumber}`,
    logicalKey: `doc:${pageNumber}`,
    renderZoom: 1,
    rotation: 0,
    renderVariant: "raw" as const,
    normalizationToken: null,
    textLayerTransform: {
      sourceWidth: 10,
      sourceHeight: 20,
      matrix: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number]
    }
  };
}

function lookupIdentity(overrides: Partial<RasterLookupIdentity> = {}): RasterLookupIdentity {
  return {
    documentId: "doc",
    documentGenerationId: "session",
    pageNumber: 1,
    rasterScale: 1.1,
    rotation: 0,
    normalizationToken: null,
    renderVariant: "raw",
    ...overrides
  };
}

describe("PageCache helpers", () => {
  it("builds cache keys from the document, page, and zoom", () => {
    expect(makePageCacheKey("doc-1", 12, 1.25)).toBe("doc-1:12:1.25");
  });

  it("evicts the least recently used page once the cache is full", () => {
    const cache = createPageCache(2);

    cache.set("doc:1", {
      documentId: "doc",
      documentGenerationId: "session",
      encodedByteSize: 3,
      estimatedResidentBytes: 1_939_395,
      imageUrl: "asset://1",
      pageNumber: 1,
      width: 612,
      height: 792,
      pageBaseWidth: 612,
      pageBaseHeight: 792,
      cacheKey: "doc:1",
      requestKey: "doc:1",
      logicalKey: "doc:1",
      renderZoom: 1,
      rotation: 0,
      renderVariant: "raw",
      normalizationToken: null,
      textLayerTransform: { sourceWidth: 612, sourceHeight: 792, matrix: [1, 0, 0, 1, 0, 0] }
    });
    cache.set("doc:2", {
      documentId: "doc",
      documentGenerationId: "session",
      encodedByteSize: 3,
      estimatedResidentBytes: 1_939_395,
      imageUrl: "asset://2",
      pageNumber: 2,
      width: 612,
      height: 792,
      pageBaseWidth: 612,
      pageBaseHeight: 792,
      cacheKey: "doc:2",
      requestKey: "doc:2",
      logicalKey: "doc:2",
      renderZoom: 1,
      rotation: 0,
      renderVariant: "raw",
      normalizationToken: null,
      textLayerTransform: { sourceWidth: 612, sourceHeight: 792, matrix: [1, 0, 0, 1, 0, 0] }
    });

    expect(cache.get("doc:1")?.pageNumber).toBe(1);

    cache.set("doc:3", {
      documentId: "doc",
      documentGenerationId: "session",
      encodedByteSize: 3,
      estimatedResidentBytes: 1_939_395,
      imageUrl: "asset://3",
      pageNumber: 3,
      width: 612,
      height: 792,
      pageBaseWidth: 612,
      pageBaseHeight: 792,
      cacheKey: "doc:3",
      requestKey: "doc:3",
      logicalKey: "doc:3",
      renderZoom: 1,
      rotation: 0,
      renderVariant: "raw",
      normalizationToken: null,
      textLayerTransform: { sourceWidth: 612, sourceHeight: 792, matrix: [1, 0, 0, 1, 0, 0] }
    });

    expect(cache.get("doc:2")).toBeUndefined();
    expect(cache.keys()).toEqual(["doc:1", "doc:3"]);
    expect(cache.getByLogicalKey("doc:3")?.cacheKey).toBe("doc:3");
  });

  it("does not revoke a blob URL when re-setting the same page object", () => {
    const cache = createPageCache(2);
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const page = {
      documentId: "doc",
      documentGenerationId: "session",
      encodedByteSize: 3,
      estimatedResidentBytes: 1_939_395,
      imageUrl: "blob:http://localhost:1420/example",
      pageNumber: 1,
      width: 612,
      height: 792,
      pageBaseWidth: 612,
      pageBaseHeight: 792,
      cacheKey: "doc:1",
      requestKey: "doc:1",
      logicalKey: "doc:1",
      renderZoom: 1,
      rotation: 0,
      renderVariant: "raw" as const,
      normalizationToken: null,
      textLayerTransform: { sourceWidth: 612, sourceHeight: 792, matrix: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number] }
    };

    cache.set("doc:1", page);
    cache.set("doc:1", page);

    expect(revokeSpy).not.toHaveBeenCalled();
    expect(cache.get("doc:1")).toBe(page);

    revokeSpy.mockRestore();
  });

  it("defers revocation while an evicted raster is retained", () => {
    const cache = createPageCache(1);
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const makePage = (pageNumber: number) => ({
      documentId: "doc",
      documentGenerationId: "session",
      encodedByteSize: 1,
      estimatedResidentBytes: 1_939_393,
      imageUrl: `blob:http://localhost:1420/${pageNumber}`,
      pageNumber,
      width: 612,
      height: 792,
      pageBaseWidth: 612,
      pageBaseHeight: 792,
      cacheKey: `doc:${pageNumber}`,
      requestKey: `doc:${pageNumber}`,
      logicalKey: `doc:${pageNumber}`,
      renderZoom: 1,
      rotation: 0,
      renderVariant: "raw" as const,
      normalizationToken: null,
      textLayerTransform: { sourceWidth: 612, sourceHeight: 792, matrix: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number] }
    });
    const retained = cache.set("doc:1", makePage(1));
    cache.retain(retained);

    cache.set("doc:2", makePage(2));
    expect(revokeSpy).not.toHaveBeenCalledWith(retained.imageUrl);

    cache.release(retained);
    expect(revokeSpy).toHaveBeenCalledWith(retained.imageUrl);
    revokeSpy.mockRestore();
  });

  it("keeps the canonical raster when the same key is inserted twice", () => {
    const cache = createPageCache(2);
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const canonical = {
      documentId: "doc",
      documentGenerationId: "session",
      encodedByteSize: 1,
      estimatedResidentBytes: 1_939_393,
      imageUrl: "blob:http://localhost:1420/canonical",
      pageNumber: 1,
      width: 612,
      height: 792,
      pageBaseWidth: 612,
      pageBaseHeight: 792,
      cacheKey: "doc:1",
      requestKey: "doc:1",
      logicalKey: "doc:1",
      renderZoom: 1,
      rotation: 0,
      renderVariant: "raw" as const,
      normalizationToken: null,
      textLayerTransform: { sourceWidth: 612, sourceHeight: 792, matrix: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number] }
    };
    const duplicate = { ...canonical, imageUrl: "blob:http://localhost:1420/duplicate" };

    cache.set("doc:1", canonical);
    expect(cache.set("doc:1", duplicate)).toBe(canonical);
    expect(revokeSpy).toHaveBeenCalledWith(duplicate.imageUrl);
    expect(revokeSpy).not.toHaveBeenCalledWith(canonical.imageUrl);
    revokeSpy.mockRestore();
  });

  it("evicts unpinned pages by resident-byte budget", () => {
    const cache = createPageCache({ maxBytes: 200 });
    cache.set("doc:1", makeBudgetPage(1, 100));
    cache.set("doc:2", makeBudgetPage(2, 100));
    cache.set("doc:3", makeBudgetPage(3, 100));

    expect(cache.get("doc:1")).toBeUndefined();
    expect(cache.keys()).toEqual(["doc:2", "doc:3"]);
    expect(cache.residentBytes()).toBe(200);
  });

  it("allows temporary overage while pages are pinned and trims on release", () => {
    const cache = createPageCache({ maxBytes: 100 });
    const pinned = cache.set("doc:1", makeBudgetPage(1, 80));
    cache.retain(pinned);
    cache.set("doc:2", makeBudgetPage(2, 80));

    expect(cache.residentBytes()).toBe(160);
    expect(cache.has("doc:1")).toBe(true);

    cache.release(pinned);
    expect(cache.residentBytes()).toBe(80);
    expect(cache.get("doc:1")).toBeUndefined();
    expect(cache.get("doc:2")?.pageNumber).toBe(2);
  });

  it("looks up exact rasters and chooses the nearest compatible scale", () => {
    const cache = createPageCache({ maxBytes: 1_000 });
    const smaller = makeBudgetPage(1, 100, { renderZoom: 1 });
    const larger = makeBudgetPage(1, 100, {
      imageUrl: "asset://1.2",
      logicalKey: "doc:1:1.2",
      renderZoom: 1.2
    });
    cache.set("doc:1:1", smaller);
    cache.set("doc:1:1.2", larger);

    expect(cache.getExact(lookupIdentity({ rasterScale: 1 }))).toBe(smaller);
    expect(cache.getExact(lookupIdentity({ rasterScale: 1.1 }))).toBeNull();
    expect(cache.getCompatibleFallback(lookupIdentity({ rasterScale: 1.1 }))).toBe(larger);
    expect(cache.getCompatibleFallback(lookupIdentity({ rasterScale: 1.04 }))).toBe(smaller);
  });

  it("never returns incompatible raster families as fallbacks", () => {
    const incompatibleOverrides: Array<Partial<RasterLookupIdentity>> = [
      { documentId: "other-doc" },
      { documentGenerationId: "other-session" },
      { pageNumber: 2 },
      { rotation: 90 },
      { normalizationToken: "normalized-v2" },
      { renderVariant: "normalized" }
    ];

    for (const [index, overrides] of incompatibleOverrides.entries()) {
      const cache = createPageCache({ maxBytes: 1_000 });
      cache.set(
        `incompatible:${index}`,
        makeBudgetPage(1, 100, {
          documentId: overrides.documentId ?? "doc",
          documentGenerationId: overrides.documentGenerationId ?? "session",
          pageNumber: overrides.pageNumber ?? 1,
          rotation: overrides.rotation ?? 0,
          normalizationToken: overrides.normalizationToken ?? null,
          renderVariant: overrides.renderVariant ?? "raw",
          renderZoom: 1
        })
      );

      expect(cache.getCompatibleFallback(lookupIdentity())).toBeNull();
    }
  });

  it("removes evicted rasters from the compatible family index", () => {
    const cache = createPageCache(1);
    cache.set("doc:1:1", makeBudgetPage(1, 100, { renderZoom: 1 }));
    cache.set("doc:2:1", makeBudgetPage(2, 100, { renderZoom: 1 }));

    expect(cache.getCompatibleFallback(lookupIdentity())).toBeNull();
  });

  it("keeps a prior-scale raster alive across remount until the exact raster replaces it", () => {
    const cache = createPageCache({ maxBytes: 1_000 });
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const prior = cache.set(
      "doc:1:1",
      makeBudgetPage(1, 100, {
        imageUrl: "blob:http://localhost:1420/prior",
        renderZoom: 1
      })
    );

    cache.retain(prior);
    cache.release(prior);
    const remountedFallback = cache.getCompatibleFallback(lookupIdentity({ rasterScale: 1.1 }));
    expect(remountedFallback).toBe(prior);
    expect(cache.retain(remountedFallback!)).toBe(true);

    const exact = cache.set(
      "doc:1:1.1",
      makeBudgetPage(1, 100, {
        imageUrl: "blob:http://localhost:1420/exact",
        logicalKey: "doc:1:1.1",
        renderZoom: 1.1
      })
    );
    expect(cache.retain(exact)).toBe(true);
    expect(revokeSpy).not.toHaveBeenCalledWith(prior.imageUrl);

    cache.release(remountedFallback!);
    expect(cache.getExact(lookupIdentity({ rasterScale: 1.1 }))).toBe(exact);
    revokeSpy.mockRestore();
  });
});
