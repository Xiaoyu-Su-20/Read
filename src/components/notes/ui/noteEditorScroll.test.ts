import { describe, expect, it } from "vitest";

import { computeTopAlignedChildScrollTop } from "./noteEditorScroll";

describe("computeTopAlignedChildScrollTop", () => {
  it("places the child below the top offset when possible", () => {
    expect(
      computeTopAlignedChildScrollTop({
        childTop: 640,
        containerHeight: 400,
        topOffset: 28,
        scrollHeight: 1600
      })
    ).toBe(612);
  });

  it("clamps to the top when the top-aligned target would go negative", () => {
    expect(
      computeTopAlignedChildScrollTop({
        childTop: 40,
        containerHeight: 400,
        topOffset: 64,
        scrollHeight: 1600
      })
    ).toBe(0);
  });

  it("clamps to the bottom when the top-aligned target exceeds the scroll range", () => {
    expect(
      computeTopAlignedChildScrollTop({
        childTop: 1500,
        containerHeight: 400,
        topOffset: 28,
        scrollHeight: 1600
      })
    ).toBe(1200);
  });
});
