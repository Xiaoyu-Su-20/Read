import { describe, expect, it } from "vitest";

import { builtinThemeDefinitions, resolveTheme } from "./themeProfile";

describe("themeProfile resolver", () => {
  it("derives semantic overlay, selection, and page-link tokens from theme sources", () => {
    const resolvedTheme = resolveTheme({
      id: "custom-1",
      name: "Custom",
      kind: "custom",
      source: {
        workspace: "#101820",
        chrome: "#18222c",
        uiText: "#dde7f0",
        documentPaper: "#1f262d",
        documentInk: "#d7dce4",
        accent: "#c08b4a",
        interactive: "#6d67d8",
        danger: "#b84a4a"
      },
      document: {
        surfaceTone: "dark"
      }
    });

    expect(resolvedTheme.overlaySurface).toContain("rgba(");
    expect(resolvedTheme.contextMenuSurface).toContain("rgba(");
    expect(resolvedTheme.selectionBackground).toContain("rgba(");
    expect(resolvedTheme.pageLinkBackground).toContain("rgba(");
    expect(resolvedTheme.pageLinkBorder).toContain("rgba(");
    expect(resolvedTheme.pageLinkText).toMatch(/^#/);
    expect(resolvedTheme.viewerDisplayConfig.imageFilter).toContain("invert(1)");
  });

  it("changes viewer filter recipe between light and dark document tones", () => {
    const lightTheme = resolveTheme(builtinThemeDefinitions[0]).viewerDisplayConfig;
    const darkTheme = resolveTheme(builtinThemeDefinitions[1]).viewerDisplayConfig;

    expect(lightTheme.mode).toBe("light");
    expect(lightTheme.imageFilter).not.toContain("invert(1)");
    expect(darkTheme.mode).toBe("dark");
    expect(darkTheme.imageFilter).toContain("invert(1)");
  });
});
