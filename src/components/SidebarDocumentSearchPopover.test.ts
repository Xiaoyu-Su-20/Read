import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import SidebarDocumentSearchPopover from "./SidebarDocumentSearchPopover";

describe("SidebarDocumentSearchPopover", () => {
  it("renders a palette-styled PDF picker with document-only results", () => {
    const markup = renderToStaticMarkup(
      createElement(SidebarDocumentSearchPopover, {
        open: true,
        anchorElement: null,
        documents: [
          {
            id: "doc-1",
            title: "Linear Algebra Notes",
            fileName: "linear-algebra-notes.pdf",
            folderId: "f-1",
            relativePath: "linear-algebra-notes.pdf",
            fingerprint: "fp-1",
            importedAt: "now",
            lastOpenedAt: null,
            availability: "available"
          },
          {
            id: "doc-2",
            title: "History of Rome",
            fileName: "history-of-rome.pdf",
            folderId: "f-1",
            relativePath: "history-of-rome.pdf",
            fingerprint: "fp-2",
            importedAt: "now",
            lastOpenedAt: null,
            availability: "available"
          }
        ],
        onClose: vi.fn(),
        onOpenDocument: vi.fn(async () => undefined)
      })
    );

    expect(markup).toContain('class="palette palette--workspace sidebar-document-search"');
    expect(markup).toContain('class="palette__search sidebar-document-search__search"');
    expect(markup).toContain("Search PDFs");
    expect(markup).toContain("ESC");
    expect(markup).toContain("Linear Algebra Notes");
    expect(markup).toContain("History of Rome");
    expect(markup).not.toContain("search-group");
    expect(markup).not.toContain("Search entire document");
    expect(markup).not.toContain("Search notes");
  });
});
