import { describe, expect, it } from "vitest";

import { toCachedRenderedPage } from "./PdfPageRenderer";

describe("toCachedRenderedPage", () => {
  it("drops transported image bytes after creating the blob URL", () => {
    const page = toCachedRenderedPage("doc", 1.5, {
      imageBytes: [1, 2, 3],
      pageNumber: 4,
      width: 10,
      height: 20,
      pageBaseWidth: 10,
      pageBaseHeight: 20,
      cacheKey: "cache:4",
      renderVariant: "raw",
      normalizationToken: null,
      textLayerTransform: { sourceWidth: 10, sourceHeight: 20, matrix: [1, 0, 0, 1, 0, 0] }
    });

    expect("imageBytes" in page).toBe(false);
    expect(page.encodedByteSize).toBe(3);
    expect(page.estimatedResidentBytes).toBe(803);
    URL.revokeObjectURL(page.imageUrl);
  });
});
