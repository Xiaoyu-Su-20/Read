import { describe, expect, it } from "vitest";

import {
  clampZoom,
  normalizeZoom,
  resolveSurfaceScale,
  scaleZoomByKeyboardDirection,
  scaleZoomByWheelDelta
} from "./zoom";

describe("zoom helpers", () => {
  it("clamps zoom to the supported range", () => {
    expect(clampZoom(0.1)).toBe(0.7);
    expect(clampZoom(9)).toBe(2.5);
  });

  it("scales wheel zoom multiplicatively", () => {
    expect(scaleZoomByWheelDelta(1, -100)).toBe(1.04);
    expect(scaleZoomByWheelDelta(1.04, 100)).toBe(1);
  });

  it("scales keyboard zoom in fixed steps", () => {
    expect(scaleZoomByKeyboardDirection(1, "in")).toBe(1.06);
    expect(scaleZoomByKeyboardDirection(1.06, "out")).toBe(1);
  });

  it("normalizes zoom values to two decimal places", () => {
    expect(normalizeZoom(1.236)).toBe(1.24);
  });

  it("resolves surface scale from display and render zoom", () => {
    expect(resolveSurfaceScale(1.5, 1.2)).toBe(1.25);
    expect(resolveSurfaceScale(1, 0)).toBe(1);
  });
});
