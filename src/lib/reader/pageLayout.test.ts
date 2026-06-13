import { describe, expect, it } from "vitest";

import {
  computePageAxisOffset,
  computePageShellOffsets,
  PAGE_CENTER_TRANSITION_BAND_PX,
  smoothstep
} from "./pageLayout";

describe("pageLayout", () => {
  it("keeps pages centered when they are comfortably smaller than the viewport", () => {
    expect(computePageAxisOffset(1000, 600)).toBe(200);
  });

  it("eases centering down as the page approaches overflow", () => {
    const centeredOffset = (1000 - 900) / 2;
    const expected = centeredOffset * smoothstep((1000 - 900) / PAGE_CENTER_TRANSITION_BAND_PX);

    expect(computePageAxisOffset(1000, 900)).toBeCloseTo(expected, 5);
    expect(computePageAxisOffset(1000, 900)).toBeLessThan(centeredOffset);
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
    expect(wideLandscape.offsetX).toBeLessThan((1200 - 1100) / 2);
    expect(wideLandscape.offsetY).toBe(200);
  });
});
