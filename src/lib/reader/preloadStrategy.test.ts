import { describe, expect, it } from "vitest";

import { resolveAdjacentPreloadPages } from "./preloadStrategy";

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
});
