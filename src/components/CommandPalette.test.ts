import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import CommandPalette from "./CommandPalette";
import type { PaletteSession } from "../lib/app/palette";

describe("CommandPalette", () => {
  it("renders compact rows without subtitles while keeping shortcut metadata", () => {
    const session: PaletteSession = {
      kind: "commands",
      title: "Command palette",
      query: "",
      emptyMessage: "Nothing to show.",
      items: [
        {
          id: "import-pdf",
          title: "Import PDF",
          subtitle: "Copy a local PDF into a collection",
          meta: "Tab",
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

    expect(markup).toContain("Import PDF");
    expect(markup).toContain("Tab");
    expect(markup).not.toContain("Copy a local PDF into a collection");
    expect(markup).not.toContain("<small");
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
