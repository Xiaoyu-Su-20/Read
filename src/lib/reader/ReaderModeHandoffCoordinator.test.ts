import { describe, expect, it, vi } from "vitest";

import type { ViewerApi } from "../types";
import { ReaderModeHandoffCoordinator } from "./ReaderModeHandoffCoordinator";

function viewerApi() {
  return {
    goToPage: vi.fn()
  } as unknown as ViewerApi;
}

describe("ReaderModeHandoffCoordinator", () => {
  it("hands Page mode location to the top of Scroll mode", () => {
    const coordinator = new ReaderModeHandoffCoordinator();
    const api = viewerApi();
    const handoff = coordinator.capture("doc-1", 47, "page", "scroll");

    expect(coordinator.shouldPublishSnapshot("scroll", "doc-1", {
      currentPage: 1,
      pageCount: 100,
      zoom: 1
    })).toBe(false);
    expect(coordinator.apply("scroll", "doc-1", api)).toEqual(handoff);
    expect(api.goToPage).toHaveBeenCalledWith(47, { alignment: "top" });
    expect(coordinator.shouldPublishSnapshot("scroll", "doc-1", {
      currentPage: 1,
      pageCount: 100,
      zoom: 1
    })).toBe(false);
    expect(coordinator.shouldPublishSnapshot("scroll", "doc-1", {
      currentPage: 47,
      pageCount: 100,
      zoom: 1
    })).toBe(true);
  });

  it("hands Scroll mode reading-line location to Page mode", () => {
    const coordinator = new ReaderModeHandoffCoordinator();
    const api = viewerApi();
    coordinator.capture("doc-1", 83, "scroll", "page");

    coordinator.apply("page", "doc-1", api);

    expect(api.goToPage).toHaveBeenCalledWith(83, { alignment: "page" });
    expect(coordinator.shouldPublishState("page", "doc-1", {
      version: 2,
      documentId: "doc-1",
      fingerprint: "fingerprint",
      lastOpenedAt: "2026-07-03T00:00:00.000Z",
      lastPage: 1,
      scrollZoom: 1,
      bookmarks: []
    })).toBe(false);
  });

  it("lets the newest rapid toggle supersede an older destination", () => {
    const coordinator = new ReaderModeHandoffCoordinator();
    const staleScrollApi = viewerApi();
    const currentPageApi = viewerApi();
    const first = coordinator.capture("doc-1", 47, "page", "scroll");
    const retainedPage = coordinator.preferredPage("doc-1", 1);
    const second = coordinator.capture("doc-1", retainedPage, "scroll", "page");

    expect(second.token).toBeGreaterThan(first.token);
    expect(coordinator.apply("scroll", "doc-1", staleScrollApi)).toBeNull();
    expect(staleScrollApi.goToPage).not.toHaveBeenCalled();
    expect(coordinator.apply("page", "doc-1", currentPageApi)).toEqual(second);
    expect(currentPageApi.goToPage).toHaveBeenCalledWith(47, { alignment: "page" });
  });

  it("discards a handoff when the active document changes", () => {
    const coordinator = new ReaderModeHandoffCoordinator();
    const api = viewerApi();
    coordinator.capture("doc-1", 47, "page", "scroll");

    coordinator.resetForDocument("doc-2");

    expect(coordinator.apply("scroll", "doc-2", api)).toBeNull();
    expect(api.goToPage).not.toHaveBeenCalled();
  });
});
