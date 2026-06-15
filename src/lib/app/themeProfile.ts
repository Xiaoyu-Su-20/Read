export type ThemeProfile = {
  workspace: string;
  chrome: string;
  text: string;
  accent: string;
  interactive: string;
  danger: string;
};

export type ThemeProfileKey = keyof ThemeProfile;

export const themeProfileDefinitions: Array<{
  key: ThemeProfileKey;
  label: string;
}> = [
  { key: "workspace", label: "Workspace" },
  { key: "chrome", label: "Chrome" },
  { key: "text", label: "Text" },
  { key: "accent", label: "Accent" },
  { key: "interactive", label: "Interactive" },
  { key: "danger", label: "Danger" }
];

const HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

type RgbColor = {
  red: number;
  green: number;
  blue: number;
};

function clampChannel(value: number) {
  return Math.min(Math.max(Math.round(value), 0), 255);
}

function toHexChannel(value: number) {
  return clampChannel(value).toString(16).padStart(2, "0");
}

function parseHexColor(value: string): RgbColor {
  const normalizedValue = value.slice(1);
  const expandedValue =
    normalizedValue.length === 3
      ? normalizedValue
          .split("")
          .map((character) => `${character}${character}`)
          .join("")
      : normalizedValue;

  return {
    red: Number.parseInt(expandedValue.slice(0, 2), 16),
    green: Number.parseInt(expandedValue.slice(2, 4), 16),
    blue: Number.parseInt(expandedValue.slice(4, 6), 16)
  };
}

function toHexColor({ red, green, blue }: RgbColor) {
  return `#${toHexChannel(red)}${toHexChannel(green)}${toHexChannel(blue)}`;
}

function mixColors(base: string, blend: string, blendAmount: number) {
  const safeBlendAmount = Math.min(Math.max(blendAmount, 0), 1);
  const baseColor = parseHexColor(base);
  const blendColor = parseHexColor(blend);

  return toHexColor({
    red: baseColor.red + (blendColor.red - baseColor.red) * safeBlendAmount,
    green: baseColor.green + (blendColor.green - baseColor.green) * safeBlendAmount,
    blue: baseColor.blue + (blendColor.blue - baseColor.blue) * safeBlendAmount
  });
}

function withAlpha(color: string, alpha: number) {
  const rgb = parseHexColor(color);
  const safeAlpha = Math.min(Math.max(alpha, 0), 1);
  return `rgba(${rgb.red}, ${rgb.green}, ${rgb.blue}, ${safeAlpha})`;
}

function lighten(color: string, amount: number) {
  return mixColors(color, "#ffffff", amount);
}

function darken(color: string, amount: number) {
  return mixColors(color, "#000000", amount);
}

export function createDefaultThemeProfile(): ThemeProfile {
  return {
    workspace: "#13191e",
    chrome: "#13191e",
    text: "#d8d8d8",
    accent: "#d4aa63",
    interactive: "#7682da",
    danger: "#b34444"
  };
}

export function normalizeThemeColor(value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalizedValue = value.trim().toLowerCase();
  if (!HEX_COLOR_PATTERN.test(normalizedValue)) {
    return fallback;
  }

  if (normalizedValue.length === 4) {
    return `#${normalizedValue[1]}${normalizedValue[1]}${normalizedValue[2]}${normalizedValue[2]}${normalizedValue[3]}${normalizedValue[3]}`;
  }

  return normalizedValue;
}

export function normalizeThemeProfile(candidate: unknown): ThemeProfile {
  const defaults = createDefaultThemeProfile();
  const record =
    typeof candidate === "object" && candidate !== null && !Array.isArray(candidate)
      ? candidate
      : {};

  return {
    workspace: normalizeThemeColor((record as Record<string, unknown>).workspace, defaults.workspace),
    chrome: normalizeThemeColor((record as Record<string, unknown>).chrome, defaults.chrome),
    text: normalizeThemeColor((record as Record<string, unknown>).text, defaults.text),
    accent: normalizeThemeColor((record as Record<string, unknown>).accent, defaults.accent),
    interactive: normalizeThemeColor((record as Record<string, unknown>).interactive, defaults.interactive),
    danger: normalizeThemeColor((record as Record<string, unknown>).danger, defaults.danger)
  };
}

export function deriveThemeCssVariables(profile: ThemeProfile): Record<string, string> {
  const workspaceBase = profile.workspace;
  const workspaceElevated = darken(lighten(profile.workspace, 0.02), 0.02);
  const chromeSurface = withAlpha(profile.chrome, 0.9);
  const chromeSurfaceStrong = withAlpha(darken(profile.chrome, 0.06), 0.96);
  const chromeBorder = lighten(profile.chrome, 0.08);
  const textPrimary = profile.text;
  const textSecondary = mixColors(profile.text, profile.workspace, 0.28);
  const textTertiary = withAlpha(profile.text, 0.58);
  const accentPrimary = profile.accent;
  const accentSoft = withAlpha(profile.accent, 0.18);
  const interactiveHover = withAlpha(profile.text, 0.05);
  const interactiveActive = withAlpha(profile.interactive, 0.22);
  const interactiveSwitchOn = withAlpha(profile.interactive, 0.9);
  const interactiveFocus = withAlpha(profile.interactive, 0.55);
  const overlaySurface = withAlpha(darken(profile.chrome, 0.08), 0.96);
  const overlaySurfaceStrong = withAlpha(darken(profile.chrome, 0.14), 0.98);
  const overlayBorder = withAlpha(profile.text, 0.08);
  const notesSurface = withAlpha(profile.chrome, 0.9);
  const notesText = lighten(profile.text, 0.1);
  const notesMuted = withAlpha(lighten(profile.text, 0.12), 0.76);
  const dangerSurface = withAlpha(profile.danger, 0.18);
  const dangerSurfaceStrong = withAlpha(profile.danger, 0.85);
  const dangerText = lighten(profile.danger, 0.36);

  return {
    "--theme-workspace": profile.workspace,
    "--theme-chrome": profile.chrome,
    "--theme-text": profile.text,
    "--theme-accent": profile.accent,
    "--theme-interactive": profile.interactive,
    "--theme-danger": profile.danger,
    "--workspace-base": workspaceBase,
    "--workspace-elevated": workspaceElevated,
    "--chrome-surface": chromeSurface,
    "--chrome-surface-strong": chromeSurfaceStrong,
    "--chrome-border": chromeBorder,
    "--chrome-hover": interactiveHover,
    "--chrome-active": interactiveActive,
    "--text-primary": textPrimary,
    "--text-secondary": textSecondary,
    "--text-tertiary": textTertiary,
    "--accent-primary": accentPrimary,
    "--accent-soft": accentSoft,
    "--interactive-hover": interactiveHover,
    "--interactive-active": interactiveActive,
    "--interactive-switch-on": interactiveSwitchOn,
    "--interactive-focus": interactiveFocus,
    "--overlay-surface": overlaySurface,
    "--overlay-surface-strong": overlaySurfaceStrong,
    "--overlay-border": overlayBorder,
    "--notes-surface": notesSurface,
    "--notes-text": notesText,
    "--notes-text-muted": notesMuted,
    "--feedback-danger-surface": dangerSurface,
    "--feedback-danger-surface-strong": dangerSurfaceStrong,
    "--feedback-danger-text": dangerText,
    "--bg": workspaceBase,
    "--bg-soft": workspaceElevated,
    "--panel": chromeSurfaceStrong,
    "--panel-border": chromeBorder,
    "--note-text-muted": notesMuted,
    "--text": textPrimary,
    "--muted": textSecondary,
    "--accent": accentPrimary
  };
}
