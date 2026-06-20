import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import OutlineOverlay, {
  defaultMarksPopoverTab,
  initialExpandedOutlineIds
} from "./OutlineOverlay";
import type { Bookmark, OutlineItem } from "../lib/types";

function outlineItem(
  args: Partial<OutlineItem> & Pick<OutlineItem, "id" | "title" | "page">
): OutlineItem {
  return {
    id: args.id,
    title: args.title,
    source: args.source ?? "embedded",
    sourceId: args.sourceId ?? args.id,
    target: args.page
      ? {
          documentId: "doc-1",
          pageIndex: args.page - 1,
          fit: "xyz"
        }
      : null,
    page: args.page,
    externalUrl: null,
    bold: false,
    italic: false,
    color: null,
    items: args.items ?? [],
    createdAt: null
  };
}

function bookmark(id: string, page: number, label: string): Bookmark {
  return {
    id,
    page,
    label,
    createdAt: "2026-06-20T00:00:00Z"
  };
}

describe("OutlineOverlay", () => {
  it("renders the anchored popover shell and defaults to bookmarks when saved marks exist", () => {
    const markup = renderToStaticMarkup(
      createElement(OutlineOverlay, {
        anchorElement: null,
        currentPage: 57,
        open: true,
        items: [outlineItem({ id: "chapter-3", title: "Chapter 3 Coding", page: 57 })],
        bookmarks: [bookmark("bm-57", 57, "Coding note")],
        onClose: vi.fn(),
        onDeleteBookmark: vi.fn(),
        onSelect: vi.fn(),
        onSelectBookmark: vi.fn()
      })
    );

    expect(markup).toContain('class="marks-popover"');
    expect(markup).toContain("Outline");
    expect(markup).toContain("Bookmarks");
    expect(markup).toContain('aria-selected="true">Bookmarks<');
    expect(markup).toContain("Coding note");
    expect(markup).toContain(">57<");
    expect(markup).toContain("Bookmark actions for Coding note");
    expect(markup).not.toContain("overlay-shell");
    expect(markup).not.toContain("Saved places");
    expect(markup).not.toContain(">Close<");
  });

  it("defaults to outline when an outline exists and bookmarks are empty", () => {
    const markup = renderToStaticMarkup(
      createElement(OutlineOverlay, {
        anchorElement: null,
        currentPage: 21,
        open: true,
        items: [
          outlineItem({
            id: "chapter-1",
            title: "Chapter 1",
            page: 21,
            items: [outlineItem({ id: "chapter-1.1", title: "Section 1.1", page: 23 })]
          })
        ],
        bookmarks: [],
        onClose: vi.fn(),
        onDeleteBookmark: vi.fn(),
        onSelect: vi.fn(),
        onSelectBookmark: vi.fn()
      })
    );

    expect(markup).toContain('aria-selected="true">Outline<');
    expect(markup).toContain("Chapter 1");
    expect(markup).toContain("Section 1.1");
  });
});

describe("marks popover helpers", () => {
  it("prefers bookmarks unless outline is the only available source", () => {
    expect(defaultMarksPopoverTab([], [])).toBe("bookmarks");
    expect(defaultMarksPopoverTab([outlineItem({ id: "outline-only", title: "Outline", page: 10 })], [])).toBe(
      "outline"
    );
    expect(
      defaultMarksPopoverTab(
        [outlineItem({ id: "outline", title: "Outline", page: 10 })],
        [bookmark("bm-10", 10, "Saved")]
      )
    ).toBe("bookmarks");
  });

  it("expands the branch nearest the current page before falling back to the first expandable root", () => {
    const items = [
      outlineItem({
        id: "chapter-1",
        title: "Chapter 1",
        page: 1,
        items: [outlineItem({ id: "chapter-1.1", title: "Section 1.1", page: 7 })]
      }),
      outlineItem({
        id: "chapter-2",
        title: "Chapter 2",
        page: 40,
        items: [
          outlineItem({
            id: "chapter-2.1",
            title: "Section 2.1",
            page: 57,
            items: [outlineItem({ id: "chapter-2.1.1", title: "Topic", page: 60 })]
          })
        ]
      })
    ];

    expect(initialExpandedOutlineIds(items, 58)).toEqual(["chapter-2", "chapter-2.1"]);
    expect(initialExpandedOutlineIds(items, null)).toEqual(["chapter-1"]);
  });
});
