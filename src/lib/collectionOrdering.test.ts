import { describe, expect, it } from "vitest";

import {
  filterPdfPaths,
  moveIdWithinOrder,
  resolveVerticalDropTarget
} from "./collectionOrdering";

describe("collectionOrdering", () => {
  it("moves an id before the target id", () => {
    expect(moveIdWithinOrder(["a", "b", "c"], "c", "a", "before")).toEqual([
      "c",
      "a",
      "b"
    ]);
  });

  it("moves an id after the target id", () => {
    expect(moveIdWithinOrder(["a", "b", "c"], "a", "b", "after")).toEqual([
      "b",
      "a",
      "c"
    ]);
  });

  it("leaves the order unchanged when the drag target is invalid", () => {
    expect(moveIdWithinOrder(["a", "b"], "a", "missing", "before")).toEqual([
      "a",
      "b"
    ]);
  });

  it("filters dropped paths to pdf files only", () => {
    expect(
      filterPdfPaths([
        "C:/Books/one.pdf",
        "C:/Books/two.PDF",
        "C:/Books/notes.txt"
      ])
    ).toEqual(["C:/Books/one.pdf", "C:/Books/two.PDF"]);
  });

  it("resolves a vertical drop target before the first matching row center", () => {
    expect(
      resolveVerticalDropTarget(
        [
          { id: "a", top: 0, bottom: 40 },
          { id: "b", top: 40, bottom: 80 }
        ],
        15
      )
    ).toEqual({
      targetId: "a",
      position: "before"
    });
  });

  it("resolves a vertical drop target after the last row center", () => {
    expect(
      resolveVerticalDropTarget(
        [
          { id: "a", top: 0, bottom: 40 },
          { id: "b", top: 40, bottom: 80 }
        ],
        79
      )
    ).toEqual({
      targetId: "b",
      position: "after"
    });
  });
});
