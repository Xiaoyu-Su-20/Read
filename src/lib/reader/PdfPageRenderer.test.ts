import { describe, expect, it } from "vitest";

import { decodeRenderedPageResponse } from "../api";
import { toCachedRenderedPage } from "./PdfPageRenderer";

describe("decodeRenderedPageResponse", () => {
  function encode(metadata: Record<string, unknown>, image: number[]) {
    const header = new TextEncoder().encode(JSON.stringify(metadata));
    const body = new Uint8Array(4 + header.length + image.length);
    new DataView(body.buffer).setUint32(0, header.length, true);
    body.set(header, 4);
    body.set(image, 4 + header.length);
    return body;
  }

  it("splits the metadata header from the raw image bytes", () => {
    const body = encode({ imageBytes: [], pageNumber: 7, cacheKey: "cache:7" }, [255, 216, 255]);

    for (const response of [body.buffer, body, Array.from(body)]) {
      const payload = decodeRenderedPageResponse(response);
      expect(payload.pageNumber).toBe(7);
      expect(payload.cacheKey).toBe("cache:7");
      expect(payload.imageBytes).toBeInstanceOf(Uint8Array);
      expect(Array.from(payload.imageBytes)).toEqual([255, 216, 255]);
    }
  });

  it("rejects a truncated or inconsistent response", () => {
    expect(() => decodeRenderedPageResponse(new Uint8Array([1, 0]))).toThrow();
    expect(() => decodeRenderedPageResponse(new Uint8Array([200, 0, 0, 0, 1]))).toThrow();
  });
});

describe("toCachedRenderedPage", () => {
  it("drops transported image bytes after creating the blob URL", () => {
    const page = toCachedRenderedPage("doc", 1.5, {
      imageBytes: new Uint8Array([1, 2, 3]),
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
