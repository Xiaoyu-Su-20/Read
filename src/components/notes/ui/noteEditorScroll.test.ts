import { describe, expect, it } from "vitest";

import { computeCenteredChildScrollTop } from "./noteEditorScroll";

describe("computeCenteredChildScrollTop", () => {
  it("centers the child within the scroll container when possible", () => {
    expect(
      computeCenteredChildScrollTop({
        childHeight: 120,
        childTop: 640,
        containerHeight: 400,
        scrollHeight: 1600
      })
    ).toBe(500);
  });

  it("clamps to the top when the centered target would go negative", () => {
    expect(
      computeCenteredChildScrollTop({
        childHeight: 100,
        childTop: 40,
        containerHeight: 400,
        scrollHeight: 1600
      })
    ).toBe(0);
  });

  it("clamps to the bottom when the centered target exceeds the scroll range", () => {
    expect(
      computeCenteredChildScrollTop({
        childHeight: 120,
        childTop: 1500,
        containerHeight: 400,
        scrollHeight: 1600
      })
    ).toBe(1200);
  });
});
