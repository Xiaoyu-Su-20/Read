import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import CommandPalette from "./CommandPalette";
import type { PaletteSession } from "../lib/app/palette";

describe("CommandPalette", () => {
  it("renders grouped command results with a search shortcut badge and compact rows", () => {
    const session: PaletteSession = {
      kind: "commands",
      title: "Command palette",
      query: "",
      emptyMessage: "Nothing to show.",
      items: [
        {
          id: "go-to-page",
          title: "Go to page",
          subtitle: "Jump to the current page",
          group: "navigation",
          meta: "G",
          onSelect: vi.fn()
        },
        {
          id: "add-bookmark",
          title: "Add mark",
          subtitle: "Save this page",
          group: "bookmarks",
          keywords: ["bookmark"],
          onSelect: vi.fn()
        },
        {
          id: "import-pdf",
          title: "Import PDF",
          subtitle: "Copy a local PDF into a collection",
          group: "library",
          onSelect: vi.fn()
        }
      ]
    };

    const markup = renderToStaticMarkup(
      createElement(CommandPalette, {
        open: true,
        session,
        onClose: vi.fn(),
        onChangeQuery: vi.fn()
      })
    );

    expect(markup).toContain('class="palette palette--workspace"');
    expect(markup).toContain('class="palette__search"');
    expect(markup).toContain('class="palette__search-icon"');
    expect(markup).toContain('class="palette__search-meta"');
    expect(markup).toContain('class="palette__item-icon"');
    expect(markup).toContain('class="palette__item-meta"');
    expect(markup).toContain('class="palette__keycap"');
    expect(markup).toContain('class="palette__divider"');
    expect(markup.match(/class="palette__divider"/g)).toHaveLength(2);
    expect(markup).toContain("Go to page");
    expect(markup).toContain("Add mark");
    expect(markup).toContain("Import PDF");
    expect(markup).toContain(">G<");
    expect(markup).toContain(">Ctrl<");
    expect(markup).toContain(">P<");
    expect(markup).not.toContain("Copy a local PDF into a collection");
    expect(markup).not.toContain("<small");
  });

  it("collapses empty groups without rendering extra dividers", () => {
    const session: PaletteSession = {
      kind: "commands",
      title: "Command palette",
      query: "bookmark",
      emptyMessage: "Nothing to show.",
      items: [
        {
          id: "go-to-page",
          title: "Go to page",
          group: "navigation",
          onSelect: vi.fn()
        },
        {
          id: "add-bookmark",
          title: "Add mark",
          group: "bookmarks",
          keywords: ["bookmark"],
          onSelect: vi.fn()
        },
        {
          id: "import-pdf",
          title: "Import PDF",
          group: "library",
          onSelect: vi.fn()
        }
      ]
    };

    const markup = renderToStaticMarkup(
      createElement(CommandPalette, {
        open: true,
        session,
        onClose: vi.fn(),
        onChangeQuery: vi.fn()
      })
    );

    expect(markup).toContain("Add mark");
    expect(markup).not.toContain("Go to page");
    expect(markup).not.toContain("Import PDF");
    expect(markup).not.toContain('class="palette__divider"');
  });

  it("renders the input session shell without group-only command chrome", () => {
    const session: PaletteSession = {
      kind: "input",
      title: "Find in document",
      query: "",
      placeholder: "Search text",
      confirmLabel: "Search",
      onSubmit: vi.fn()
    };

    const markup = renderToStaticMarkup(
      createElement(CommandPalette, {
        open: true,
        session,
        onClose: vi.fn(),
        onChangeQuery: vi.fn()
      })
    );

    expect(markup).toContain('class="palette__search"');
    expect(markup).not.toContain('class="palette__search-meta"');
    expect(markup).not.toContain("listbox");
    expect(markup).toContain("Press Enter to search.");
  });

  it("renders the empty state for selection sessions with no matches", () => {
    const session: PaletteSession = {
      kind: "select",
      title: "Recent documents",
      query: "",
      emptyMessage: "No recent documents have been opened yet.",
      items: []
    };

    const markup = renderToStaticMarkup(
      createElement(CommandPalette, {
        open: true,
        session,
        onClose: vi.fn(),
        onChangeQuery: vi.fn()
      })
    );

    expect(markup).toContain("No recent documents have been opened yet.");
    expect(markup).not.toContain("listbox");
  });
});
