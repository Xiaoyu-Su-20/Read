import { describe, expect, it } from "vitest";

import {
  clampZoom,
  normalizeReaderFitMode,
  normalizeZoom,
  resolveAutoMaximizeZoom,
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
    expect(scaleZoomByWheelDelta(1, -100)).toBe(1.02);
    expect(scaleZoomByWheelDelta(1.02, 100)).toBe(1);
  });

  it("scales keyboard zoom in fixed steps", () => {
    expect(scaleZoomByKeyboardDirection(1, "in")).toBe(1.03);
    expect(scaleZoomByKeyboardDirection(1.03, "out")).toBe(1);
  });

  it("normalizes zoom values to two decimal places", () => {
    expect(normalizeZoom(1.236)).toBe(1.24);
  });

  it("maps legacy and unknown fit modes to auto maximize", () => {
    expect(normalizeReaderFitMode("width")).toBe("auto-maximize");
    expect(normalizeReaderFitMode("auto-maximize")).toBe("auto-maximize");
    expect(normalizeReaderFitMode("free")).toBe("free");
    expect(normalizeReaderFitMode("unexpected-mode")).toBe("auto-maximize");
  });

  it("resolves auto maximize zoom from viewport height and width margins", () => {
    expect(resolveAutoMaximizeZoom(900, 1200, 800, 1200)).toBe(0.98);
    expect(resolveAutoMaximizeZoom(680, 1200, 800, 1200)).toBe(0.78);
  });

  it("resolves surface scale from display and render zoom", () => {
    expect(resolveSurfaceScale(1.5, 1.2)).toBe(1.25);
    expect(resolveSurfaceScale(1, 0)).toBe(1);
  });
});
