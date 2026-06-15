import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import DisplaySettingsPopover from "./DisplaySettingsPopover";

describe("DisplaySettingsPopover", () => {
  it("renders the scoped document appearance controls and grouped theme colors", () => {
    const markup = renderToStaticMarkup(
      createElement(DisplaySettingsPopover, {
        id: "display-settings-popover",
        controlsDisabled: true,
        settings: {
          documentAppearance: {
            mode: "dark",
            useOnePaperColorForBoth: false,
            light: {
              paperColor: "#c8c2b8",
              paperColorSource: "default",
              brightness: 1,
              contrast: 1
            },
            dark: {
              paperColor: "#20242a",
              paperColorSource: "default",
              brightness: 0.9,
              contrast: 0.92,
              inversion: 1
            }
          },
          fullscreenMode: false,
          showPageNumbers: true,
          twoPageView: false,
          verticalScrolling: true,
          themeProfile: {
            workspace: "#13191e",
            chrome: "#13191e",
            text: "#d8d8d8",
            accent: "#d4aa63",
            interactive: "#7682da",
            danger: "#b34444"
          }
        },
        onChangeDocumentAppearanceMode: vi.fn(),
        onChangeDocumentPaperColor: vi.fn(),
        onResetActiveDocumentAppearance: vi.fn(),
        onResetAllDocumentAppearance: vi.fn(),
        onToggleSharedDocumentPaperColor: vi.fn(),
        onChangeThemeColor: vi.fn(),
        onToggleSetting: vi.fn()
      })
    );

    expect(markup).toContain("Display Settings");
    expect(markup).toContain("Document Appearance");
    expect(markup).toContain("Paper");
    expect(markup).toContain("Changes apply to Dark appearance");
    expect(markup).toContain("Use one paper color for both appearances");
    expect(markup).toContain("Reset appearance");
    expect(markup).toContain("Reset all document appearance settings");
    expect(markup).toContain("Theme Colors");
    expect(markup).toContain("Workspace");
    expect(markup).toContain("Chrome");
    expect(markup).toContain("Text");
    expect(markup).toContain("Accent");
    expect(markup).toContain("Interactive");
    expect(markup).toContain("Danger");
    expect(markup).not.toContain("App Theme");
    expect(markup).not.toContain("Text Antialiasing");
    expect(markup.match(/disabled=""/g)?.length ?? 0).toBeGreaterThanOrEqual(9);
  });
});
