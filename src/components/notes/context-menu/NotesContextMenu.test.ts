import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import NotesContextMenu from "./NotesContextMenu";

describe("NotesContextMenu", () => {
  it("renders the pagemark actions for heading blocks without the old PDF section actions", () => {
    const markup = renderToStaticMarkup(
      createElement(NotesContextMenu, {
        state: {
          target: "body",
          blockId: "heading-1",
          blockType: "heading2",
          canAddPageLink: true,
          sourceReference: {
            id: "ref-1",
            documentId: "doc-1",
            kind: "direct",
            outlineItemId: null,
            outlineSource: null,
            title: "Heading",
            target: {
              documentId: "doc-1",
              pageIndex: 9,
              fit: "xyz"
            },
            createdAt: "2026-06-20T00:00:00Z"
          },
          anchor: { x: 12, y: 24 }
        },
        position: null,
        submenuOpen: false,
        submenuDirection: "right",
        menuRef: { current: null },
        submenuRef: { current: null },
        onCopy: vi.fn(),
        onCut: vi.fn(),
        onPaste: vi.fn(),
        onTurnInto: vi.fn(),
        onAddPageLink: vi.fn(),
        onAddHeadingPagemark: vi.fn(),
        onRemoveHeadingReference: vi.fn(),
        onOpenPage: vi.fn(),
        onEditPageLink: vi.fn(),
        onCopyPageReference: vi.fn(),
        onRemovePageLink: vi.fn(),
        onOpenSubmenu: vi.fn(),
        onScheduleCloseSubmenu: vi.fn()
      })
    );

    expect(markup).toContain("Add PageLink");
    expect(markup).toContain("Add pagemark");
    expect(markup).toContain("Remove pagemark");
    expect(markup).not.toContain("Link heading to current page");
    expect(markup).not.toContain("Link heading to PDF section");
    expect(markup).not.toContain("Create PDF section from heading");
  });
});
