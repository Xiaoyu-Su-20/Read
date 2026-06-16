import { describe, expect, it } from "vitest";

import { computePageAxisOffset, computePageShellOffsets } from "./pageLayout";

describe("pageLayout", () => {
  it("keeps pages centered when they are comfortably smaller than the viewport", () => {
    expect(computePageAxisOffset(1000, 600)).toBe(200);
  });

  it("keeps exact centering all the way until overflow begins", () => {
    expect(computePageAxisOffset(1000, 900)).toBe(50);
    expect(computePageAxisOffset(1000, 999)).toBe(0);
  });

  it("pins the page to the top-left once it overflows", () => {
    expect(computePageAxisOffset(1000, 1000)).toBe(0);
    expect(computePageAxisOffset(1000, 1200)).toBe(0);
  });

  it("computes both horizontal and vertical offsets for mixed page shapes", () => {
    expect(computePageShellOffsets(1200, 900, 700, 600)).toEqual({
      offsetX: 250,
      offsetY: 150
    });

    const wideLandscape = computePageShellOffsets(1200, 900, 1100, 500);
    expect(wideLandscape.offsetX).toBe(50);
    expect(wideLandscape.offsetY).toBe(200);
  });
});
