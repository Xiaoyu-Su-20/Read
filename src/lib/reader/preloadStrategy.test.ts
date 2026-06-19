import { describe, expect, it } from "vitest";

import { resolveAdjacentPreloadPages, resolveDisplayListWarmupPages } from "./preloadStrategy";

describe("preloadStrategy", () => {
  it("prefers the next page by default", () => {
    expect(resolveAdjacentPreloadPages(10, 20, null)).toEqual([11, 9]);
  });

  it("prefers the previous page when navigating backward", () => {
    expect(resolveAdjacentPreloadPages(10, 20, "previous")).toEqual([9, 11]);
  });

  it("omits pages that would fall outside the document bounds", () => {
    expect(resolveAdjacentPreloadPages(1, 20, null)).toEqual([2]);
    expect(resolveAdjacentPreloadPages(20, 20, "previous")).toEqual([19]);
  });

  it("warms the current page, two forward pages, and one previous page by default", () => {
    expect(resolveDisplayListWarmupPages(10, 20, null)).toEqual([10, 11, 12, 9]);
  });

  it("warms the current page, two previous pages, and one next page when navigating backward", () => {
    expect(resolveDisplayListWarmupPages(10, 20, "previous")).toEqual([10, 9, 8, 11]);
  });

  it("clamps display-list warmup pages to document bounds", () => {
    expect(resolveDisplayListWarmupPages(1, 2, null)).toEqual([1, 2]);
    expect(resolveDisplayListWarmupPages(2, 2, "previous")).toEqual([2, 1]);
  });
});
