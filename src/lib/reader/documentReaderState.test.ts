import { describe, expect, it } from "vitest";

import type { DocumentState } from "../types";
import { updatePageReaderState, updateScrollReaderState } from "./documentReaderState";

function state(scrollZoom = 1.65): DocumentState {
  return {
    version: 2,
    documentId: "doc-1",
    fingerprint: "fingerprint",
    lastOpenedAt: null,
    lastPage: 10,
    scrollZoom,
    bookmarks: []
  };
}

describe("document reader state ownership", () => {
  it("keeps Scroll zoom unchanged across Page navigation and resize-equivalent updates", () => {
    const before = state(1.65);

    const afterPageNavigation = updatePageReaderState(before, 47);
    const afterAnotherPagePresentation = updatePageReaderState(afterPageNavigation, 47);

    expect(afterAnotherPagePresentation.lastPage).toBe(47);
    expect(afterAnotherPagePresentation.scrollZoom).toBe(1.65);
  });

  it("lets Scroll mode update its durable zoom", () => {
    const updated = updateScrollReaderState(state(1.25), 83, 1.8);

    expect(updated.lastPage).toBe(83);
    expect(updated.scrollZoom).toBe(1.8);
  });

  it("preserves Scroll zoom through a Scroll to Page to Scroll round trip", () => {
    const scrolled = updateScrollReaderState(state(), 83, 1.75);
    const paged = updatePageReaderState(scrolled, 84);
    const returnedToScroll = updateScrollReaderState(
      paged,
      paged.lastPage,
      paged.scrollZoom
    );

    expect(returnedToScroll.lastPage).toBe(84);
    expect(returnedToScroll.scrollZoom).toBe(1.75);
  });
});
