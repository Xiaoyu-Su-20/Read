import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import DisplaySettingsPopover from "./DisplaySettingsPopover";

describe("DisplaySettingsPopover", () => {
  it("renders grouped source sections and derived preview samples", () => {
    const customTheme = {
      id: "custom-1",
      name: "Night Ink",
      kind: "custom" as const,
      source: {
        workspace: "#13191e",
        chrome: "#13191e",
        uiText: "#d8d8d8",
        documentPaper: "#20242a",
        documentInk: "#d8d8d8",
        accent: "#d4aa63",
        interactive: "#7682da",
        danger: "#b34444"
      },
      document: {
        surfaceTone: "dark" as const
      }
    };

    const markup = renderToStaticMarkup(
      createElement(DisplaySettingsPopover, {
        id: "display-settings-popover",
        activeTheme: customTheme,
        activeThemeId: "custom-1",
        readerPreferences: {
          fullscreenMode: false,
          showPageNumbers: true,
          twoPageView: false,
          verticalScrolling: true
        },
        themeList: [
          {
            ...customTheme,
            id: "builtin-midnight",
            name: "Midnight Reading",
            kind: "builtin"
          },
          customTheme
        ],
        onCreateTheme: vi.fn(),
        onDeleteTheme: vi.fn(),
        onDuplicateTheme: vi.fn(),
        onPreviewTheme: vi.fn(),
        onSaveThemeDraft: vi.fn(),
        onSelectTheme: vi.fn(),
        onToggleReaderPreference: vi.fn()
      })
    );

    expect(markup).toContain("Settings");
    expect(markup).toContain("General");
    expect(markup).toContain("Themes");
    expect(markup).toContain("Active Theme");
    expect(markup).toContain("Theme Presets");
    expect(markup).toContain("Theme Colors");
    expect(markup).toContain("Application");
    expect(markup).toContain("Document");
    expect(markup).toContain("Interaction");
    expect(markup).toContain("Workspace");
    expect(markup).toContain("Chrome");
    expect(markup).toContain("UI Text");
    expect(markup).toContain("Paper");
    expect(markup).toContain("Ink");
    expect(markup).toContain("Accent");
    expect(markup).toContain("Interactive");
    expect(markup).toContain("Derived Preview");
    expect(markup).toContain("Page link");
    expect(markup).toContain("Selected text");
    expect(markup).toContain("Menu item");
    expect(markup).toContain("Overlay");
    expect(markup).toContain("Save");
    expect(markup).toContain("Cancel");
    expect(markup).not.toContain("Document Appearance");
    expect(markup).not.toContain("Text Antialiasing");
    expect(markup).not.toContain("Danger");
  });

  it("shows built-in themes as read-only", () => {
    const builtinTheme = {
      id: "builtin-midnight",
      name: "Midnight Reading",
      kind: "builtin" as const,
      source: {
        workspace: "#13191e",
        chrome: "#13191e",
        uiText: "#d8d8d8",
        documentPaper: "#20242a",
        documentInk: "#d8d8d8",
        accent: "#d4aa63",
        interactive: "#7682da",
        danger: "#b34444"
      },
      document: {
        surfaceTone: "dark" as const
      }
    };

    const markup = renderToStaticMarkup(
      createElement(DisplaySettingsPopover, {
        id: "display-settings-popover",
        activeTheme: builtinTheme,
        activeThemeId: builtinTheme.id,
        readerPreferences: {
          fullscreenMode: false,
          showPageNumbers: true,
          twoPageView: false,
          verticalScrolling: true
        },
        themeList: [builtinTheme],
        onCreateTheme: vi.fn(),
        onDeleteTheme: vi.fn(),
        onDuplicateTheme: vi.fn(),
        onPreviewTheme: vi.fn(),
        onSaveThemeDraft: vi.fn(),
        onSelectTheme: vi.fn(),
        onToggleReaderPreference: vi.fn()
      })
    );

    expect(markup).toContain("Duplicate");
    expect(markup).toContain("Built-in themes are read-only. Duplicate one to customize it.");
    expect(markup.match(/disabled=""/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
