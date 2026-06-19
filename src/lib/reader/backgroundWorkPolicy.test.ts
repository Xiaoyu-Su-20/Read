import { describe, expect, it } from "vitest";

import {
  PDF_RUNTIME_OUTLINE_LOAD_DELAY_MS,
  shouldRequestNativeTextLayer,
  shouldScheduleDeferredOutlineLoad
} from "./backgroundWorkPolicy";

describe("reader background work policy", () => {
  it("makes native text eligible before deferred outline work", () => {
    expect(
      shouldRequestNativeTextLayer({
        backgroundWorkSuspended: false,
        displayedPageDocumentId: "doc-1",
        documentId: "doc-1",
        hasDisplayedPage: true
      })
    ).toBe(true);

    expect(
      shouldScheduleDeferredOutlineLoad({
        backgroundWorkSuspended: false,
        displayedPageRequestKey: "page-1",
        hasDisplayedPage: true,
        hasOutlineProvider: true,
        outlineLoadedForDocument: false,
        postVisibleWorkReadyKey: null
      })
    ).toBe(false);
    expect(PDF_RUNTIME_OUTLINE_LOAD_DELAY_MS).toBeGreaterThanOrEqual(2500);
  });

  it("schedules outline only after the displayed page is marked post-visible ready", () => {
    expect(
      shouldScheduleDeferredOutlineLoad({
        backgroundWorkSuspended: false,
        displayedPageRequestKey: "page-1",
        hasDisplayedPage: true,
        hasOutlineProvider: true,
        outlineLoadedForDocument: false,
        postVisibleWorkReadyKey: "page-1"
      })
    ).toBe(true);
  });

  it("does not schedule outline after switching documents or views", () => {
    expect(
      shouldScheduleDeferredOutlineLoad({
        backgroundWorkSuspended: true,
        displayedPageRequestKey: "page-1",
        hasDisplayedPage: true,
        hasOutlineProvider: true,
        outlineLoadedForDocument: false,
        postVisibleWorkReadyKey: "page-1"
      })
    ).toBe(false);
  });

  it("suppresses background work while reader work is suspended", () => {
    expect(
      shouldRequestNativeTextLayer({
        backgroundWorkSuspended: true,
        displayedPageDocumentId: "doc-1",
        documentId: "doc-1",
        hasDisplayedPage: true
      })
    ).toBe(false);

    expect(
      shouldScheduleDeferredOutlineLoad({
        backgroundWorkSuspended: true,
        displayedPageRequestKey: "page-1",
        hasDisplayedPage: true,
        hasOutlineProvider: true,
        outlineLoadedForDocument: false,
        postVisibleWorkReadyKey: "page-1"
      })
    ).toBe(false);
  });
});

