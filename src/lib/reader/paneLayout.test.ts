import { describe, expect, it } from "vitest";

import {
  clampReaderPaneSplitRatio,
  clampReaderPaneSplitRatioWithMinDocumentWidth,
  DEFAULT_READER_PANE_SPLIT_RATIO,
  deriveReaderPaneLayout,
  getReaderPaneNotesRatio,
  getReaderPaneSplitRatioBounds,
  getReaderPaneSplitRatioFromPointer,
  getReaderPaneUsableWidth,
  nudgeReaderPaneSplitRatio,
  normalizeReaderPaneSplitRatio
} from "./paneLayout";

describe("paneLayout helpers", () => {
  it("creates the default ratio when the stored value is malformed", () => {
    expect(normalizeReaderPaneSplitRatio("nope")).toBe(DEFAULT_READER_PANE_SPLIT_RATIO);
  });

  it("normalizes the stored ratio into a safe range", () => {
    expect(normalizeReaderPaneSplitRatio(0.1)).toBe(0.1);
    expect(normalizeReaderPaneSplitRatio(0.9)).toBe(0.9);
    expect(normalizeReaderPaneSplitRatio(-1)).toBe(0);
    expect(normalizeReaderPaneSplitRatio(2)).toBe(1);
  });

  it("clamps live ratios against the current container width", () => {
    expect(clampReaderPaneSplitRatio(0.1, 1000)).toBe(0.3203);
    expect(clampReaderPaneSplitRatio(0.9, 1000)).toBe(0.6797);
  });

  it("derives live pane widths from the preferred ratio and current usable width", () => {
    expect(getReaderPaneUsableWidth(1000)).toBe(999);
    expect(deriveReaderPaneLayout(0.4, 1000)).toEqual({
      preferredRatio: 0.4,
      constrainedRatio: 0.4,
      documentWidth: 399.6,
      notesWidth: 599.4,
      usableWidth: 999,
      isConstrained: false
    });
  });

  it("keeps the preferred ratio separate from temporary narrow-window clamping", () => {
    expect(deriveReaderPaneLayout(0.4, 700)).toEqual({
      preferredRatio: 0.4,
      constrainedRatio: 0.4578,
      documentWidth: 320,
      notesWidth: 379,
      usableWidth: 699,
      isConstrained: true
    });
  });

  it("collapses to the nearest feasible center ratio when both minimums cannot fit", () => {
    expect(getReaderPaneSplitRatioBounds(620)).toEqual({
      minRatio: 0.5,
      maxRatio: 0.5
    });
    expect(clampReaderPaneSplitRatio(0.2, 620)).toBe(0.5);
  });

  it("can clamp the document pane to a stronger locked-fit minimum width", () => {
    expect(clampReaderPaneSplitRatioWithMinDocumentWidth(0.2, 1200, 640)).toBe(0.5338);
    expect(clampReaderPaneSplitRatioWithMinDocumentWidth(0.8, 1200, 640)).toBe(0.7331);
  });

  it("converts pointer position into a ratio and derives the matching notes ratio", () => {
    expect(getReaderPaneSplitRatioFromPointer(560, 100, 1000)).toBe(0.4605);
    expect(getReaderPaneNotesRatio(0.46)).toBe(0.54);
  });

  it("nudges the ratio in keyboard-sized steps", () => {
    expect(nudgeReaderPaneSplitRatio(0.46, "left", 1000)).toBe(0.44);
    expect(nudgeReaderPaneSplitRatio(0.46, "right", 1000)).toBe(0.48);
  });
});
