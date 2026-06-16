import { describe, expect, it } from "vitest";

import { createPageCache, makePageCacheKey } from "./PageCache";

describe("PageCache helpers", () => {
  it("builds cache keys from the document, page, and zoom", () => {
    expect(makePageCacheKey("doc-1", 12, 1.25)).toBe("doc-1:12:1.25");
  });

  it("evicts the least recently used page once the cache is full", () => {
    const cache = createPageCache(2);

    cache.set("doc:1", {
      imagePath: "C:/Reader/rendered-pages/1.jpg",
      imageUrl: "asset://1",
      pageNumber: 1,
      width: 612,
      height: 792,
      cacheKey: "doc:1",
      requestKey: "doc:1",
      logicalKey: "doc:1",
      renderZoom: 1,
      renderVariant: "raw",
      normalizationToken: null,
      textLayerTransform: { sourceWidth: 612, sourceHeight: 792, matrix: [1, 0, 0, 1, 0, 0] }
    });
    cache.set("doc:2", {
      imagePath: "C:/Reader/rendered-pages/2.jpg",
      imageUrl: "asset://2",
      pageNumber: 2,
      width: 612,
      height: 792,
      cacheKey: "doc:2",
      requestKey: "doc:2",
      logicalKey: "doc:2",
      renderZoom: 1,
      renderVariant: "raw",
      normalizationToken: null,
      textLayerTransform: { sourceWidth: 612, sourceHeight: 792, matrix: [1, 0, 0, 1, 0, 0] }
    });

    expect(cache.get("doc:1")?.pageNumber).toBe(1);

    cache.set("doc:3", {
      imagePath: "C:/Reader/rendered-pages/3.jpg",
      imageUrl: "asset://3",
      pageNumber: 3,
      width: 612,
      height: 792,
      cacheKey: "doc:3",
      requestKey: "doc:3",
      logicalKey: "doc:3",
      renderZoom: 1,
      renderVariant: "raw",
      normalizationToken: null,
      textLayerTransform: { sourceWidth: 612, sourceHeight: 792, matrix: [1, 0, 0, 1, 0, 0] }
    });

    expect(cache.get("doc:2")).toBeUndefined();
    expect(cache.keys()).toEqual(["doc:1", "doc:3"]);
    expect(cache.getByLogicalKey("doc:3")?.cacheKey).toBe("doc:3");
  });
});
