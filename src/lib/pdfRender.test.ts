import { describe, expect, it } from "vitest";

import {
  createRenderedPageCache,
  makeRenderCacheKey,
  shouldIgnoreRenderResponse
} from "./pdfRender";

describe("pdfRender helpers", () => {
  it("builds simple cache keys from the document and page", () => {
    expect(makeRenderCacheKey("doc-1", 12)).toBe("doc-1:12");
  });

  it("treats outdated request sequences as stale", () => {
    expect(shouldIgnoreRenderResponse(2, 3)).toBe(true);
    expect(shouldIgnoreRenderResponse(3, 3)).toBe(false);
  });

  it("evicts the least recently used page once the cache is full", () => {
    const cache = createRenderedPageCache(2);

    cache.set("doc:1", {
      imagePath: "C:/Reader/rendered-pages/1.jpg",
      pageNumber: 1,
      width: 612,
      height: 792,
      cacheKey: "doc:1"
    });
    cache.set("doc:2", {
      imagePath: "C:/Reader/rendered-pages/2.jpg",
      pageNumber: 2,
      width: 612,
      height: 792,
      cacheKey: "doc:2"
    });

    expect(cache.get("doc:1")?.pageNumber).toBe(1);

    cache.set("doc:3", {
      imagePath: "C:/Reader/rendered-pages/3.jpg",
      pageNumber: 3,
      width: 612,
      height: 792,
      cacheKey: "doc:3"
    });

    expect(cache.get("doc:2")).toBeUndefined();
    expect(cache.keys()).toEqual(["doc:1", "doc:3"]);
  });
});
