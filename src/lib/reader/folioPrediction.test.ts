import { describe, expect, it } from "vitest";

import { predictFolio } from "./folioPrediction";
import type { NativeTextPagePayload } from "../types";

function page(lines: Array<{ text: string; x: number; y: number }>): NativeTextPagePayload {
  return {
    pageNumber: 17,
    sourceWidth: 600,
    sourceHeight: 900,
    bounds: { x0: 0, y0: 0, x1: 600, y1: 900 },
    chars: [],
    lines: lines.map((line, index) => ({
      index,
      charStart: 0,
      charEnd: line.text.length,
      text: line.text,
      bounds: { x0: line.x, y0: line.y, x1: line.x + 20, y1: line.y + 12 }
    }))
  };
}

describe("predictFolio", () => {
  it("accepts an isolated bottom-center folio", () => {
    expect(predictFolio(page([{ text: "1", x: 290, y: 860 }])).prediction).toEqual({
      label: "1",
      confidence: "high"
    });
  });

  it("accepts bottom outer-corner folios", () => {
    expect(predictFolio(page([{ text: "42", x: 32, y: 860 }])).prediction?.label).toBe("42");
  });

  it("accepts an isolated top-corner folio", () => {
    expect(predictFolio(page([{ text: "42", x: 548, y: 20 }])).prediction?.label).toBe("42");
  });

  it("prefers a centered folio over a footer copyright year", () => {
    expect(
      predictFolio(page([
        { text: "2024", x: 32, y: 860 },
        { text: "42", x: 290, y: 860 }
      ])).prediction?.label
    ).toBe("42");
  });

  it("marks a margin number without conventional alignment as medium confidence", () => {
    expect(predictFolio(page([{ text: "42", x: 180, y: 860 }])).prediction).toEqual({
      label: "42",
      confidence: "medium"
    });
  });

  it("rejects numbers in body text and ambiguous footer candidates", () => {
    expect(predictFolio(page([{ text: "2024", x: 290, y: 500 }])).prediction).toBeNull();
    expect(
      predictFolio(page([
        { text: "42", x: 32, y: 860 },
        { text: "2024", x: 548, y: 860 }
      ])).prediction
    ).toBeNull();
  });
});
