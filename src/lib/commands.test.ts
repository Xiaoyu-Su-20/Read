import { describe, expect, it } from "vitest";

import {
  filterPaletteItems,
  findBookmarkAtPage,
  sortRecentDocuments
} from "./commands";
import type { PaletteItem } from "./types";

describe("commands helpers", () => {
  it("filters palette items by title and keywords", () => {
    const items: PaletteItem[] = [
      {
        id: "import",
        title: "Import PDF",
        keywords: ["open", "file"],
        onSelect: () => undefined
      },
      {
        id: "zoom",
        title: "Zoom in",
        keywords: ["scale"],
        onSelect: () => undefined
      }
    ];

    expect(filterPaletteItems(items, "file")).toHaveLength(1);
    expect(filterPaletteItems(items, "file")[0]?.id).toBe("import");
    expect(filterPaletteItems(items, "zoom")).toHaveLength(1);
  });

  it("sorts recent documents by last opened descending", () => {
    const sorted = sortRecentDocuments([
      {
        id: "older",
        title: "Older",
        fileName: "older.pdf",
        folderId: "root",
        relativePath: "older.pdf",
        sidecarRelativePath: "older.pdf.reader.json",
        fingerprint: "a",
        importedAt: "2026-01-01T00:00:00Z",
        lastOpenedAt: "2026-01-02T00:00:00Z"
      },
      {
        id: "newer",
        title: "Newer",
        fileName: "newer.pdf",
        folderId: "root",
        relativePath: "newer.pdf",
        sidecarRelativePath: "newer.pdf.reader.json",
        fingerprint: "b",
        importedAt: "2026-01-01T00:00:00Z",
        lastOpenedAt: "2026-01-03T00:00:00Z"
      }
    ]);

    expect(sorted[0]?.id).toBe("newer");
  });

  it("finds the bookmark matching the current page", () => {
    const bookmark = findBookmarkAtPage(
      [
        {
          id: "bookmark-1",
          page: 3,
          label: "Page 3",
          createdAt: "2026-01-01T00:00:00Z"
        }
      ],
      3
    );

    expect(bookmark?.label).toBe("Page 3");
    expect(findBookmarkAtPage([], 1)).toBeNull();
  });
});
