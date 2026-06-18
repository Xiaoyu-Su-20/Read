import { describe, expect, it } from "vitest";

import { builtinThemeDefinitions, resolveTheme } from "./themeProfile";

function parseHexColor(color: string) {
  return {
    red: Number.parseInt(color.slice(1, 3), 16),
    green: Number.parseInt(color.slice(3, 5), 16),
    blue: Number.parseInt(color.slice(5, 7), 16)
  };
}

function normalizeChannel(channel: number) {
  const normalized = channel / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(color: string) {
  const { red, green, blue } = parseHexColor(color);

  return (
    0.2126 * normalizeChannel(red) +
    0.7152 * normalizeChannel(green) +
    0.0722 * normalizeChannel(blue)
  );
}

describe("themeProfile resolver", () => {
  it("derives semantic overlay, selection, and page-link tokens from theme sources", () => {
    const resolvedTheme = resolveTheme({
      id: "custom-1",
      name: "Custom",
      kind: "custom",
      source: {
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

    expect(resolvedTheme.overlaySurface).toMatch(/^#/);
    expect(resolvedTheme.contextMenuSurface).toMatch(/^#/);
    expect(resolvedTheme.selectionBackground).toContain("rgba(");
    expect(resolvedTheme.pageLinkBackground).toContain("rgba(");
    expect(resolvedTheme.pageLinkBorder).toContain("rgba(");
    expect(resolvedTheme.pageLinkText).toContain("rgba(");
    expect(resolvedTheme.cssVariables["--reader-status-surface"]).toContain("rgba(");
    expect(resolvedTheme.cssVariables["--rapid-turn-progress-start"]).toMatch(/^#/);
    expect(resolvedTheme.cssVariables["--search-placeholder-text"]).toContain("rgba(");
    expect(resolvedTheme.cssVariables["--collection-row-active"]).toContain("rgba(");
    expect(resolvedTheme.cssVariables["--collection-add-surface-start"]).toContain("rgba(");
    expect(resolvedTheme.viewerDisplayConfig.imageFilter).toContain("invert(1)");
    expect(resolvedTheme.viewerDisplayConfig.blendMode).toBe("screen");
  });

  it("changes viewer filter recipe between light and dark document tones", () => {
    const lightTheme = resolveTheme(builtinThemeDefinitions[0]).viewerDisplayConfig;
    const darkTheme = resolveTheme(builtinThemeDefinitions[1]).viewerDisplayConfig;

    expect(lightTheme.mode).toBe("light");
    expect(lightTheme.blendMode).toBe("multiply");
    expect(lightTheme.imageFilter).not.toContain("invert(1)");
    expect(darkTheme.mode).toBe("dark");
    expect(darkTheme.blendMode).toBe("screen");
    expect(darkTheme.imageFilter).toContain("invert(1)");
  });

  it("moves raised surfaces away from the base workspace lightness while preserving themed color", () => {
    const lightResolved = resolveTheme(builtinThemeDefinitions[0]);
    const darkResolved = resolveTheme(builtinThemeDefinitions[1]);

    expect(relativeLuminance(lightResolved.overlaySurface)).toBeLessThan(
      relativeLuminance(builtinThemeDefinitions[0].source.chrome)
    );
    expect(relativeLuminance(darkResolved.overlaySurface)).toBeGreaterThan(
      relativeLuminance(builtinThemeDefinitions[1].source.chrome)
    );
  });
});
