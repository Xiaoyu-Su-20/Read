import { describe, expect, it } from "vitest";

import { getSubmenuDirection, placeMenu } from "./menuPlacement";

describe("menuPlacement", () => {
  it("keeps a middle anchor unchanged when the menu fits", () => {
    expect(
      placeMenu(
        { x: 120, y: 140 },
        { width: 420, height: 360 },
        { width: 160, height: 120 }
      )
    ).toEqual({ x: 120, y: 140 });
  });

  it("clamps the menu near the left edge", () => {
    expect(
      placeMenu(
        { x: 2, y: 140 },
        { width: 420, height: 360 },
        { width: 160, height: 120 }
      )
    ).toEqual({ x: 8, y: 140 });
  });

  it("clamps the menu near the right edge", () => {
    expect(
      placeMenu(
        { x: 390, y: 140 },
        { width: 420, height: 360 },
        { width: 160, height: 120 }
      )
    ).toEqual({ x: 252, y: 140 });
  });

  it("clamps the menu near the bottom edge", () => {
    expect(
      placeMenu(
        { x: 120, y: 320 },
        { width: 420, height: 360 },
        { width: 160, height: 120 }
      )
    ).toEqual({ x: 120, y: 232 });
  });

  it("opens the submenu to the right when there is room", () => {
    expect(
      getSubmenuDirection(
        { x: 120, y: 140 },
        { width: 520, height: 360 },
        { width: 160, height: 120 },
        176
      )
    ).toBe("right");
  });

  it("flips the submenu left near the pane edge", () => {
    expect(
      getSubmenuDirection(
        { x: 300, y: 140 },
        { width: 520, height: 360 },
        { width: 160, height: 120 },
        176
      )
    ).toBe("left");
  });
});
