export type ThemeSurfaceTone = "light" | "dark";

export type ThemeSources = {
  chrome: string;
  uiText: string;
  documentPaper: string;
  documentInk: string;
  accent: string;
  interactive: string;
  danger: string;
};

export type ThemeSourceKey = keyof ThemeSources;

export type ViewerDisplayConfig = {
  mode: ThemeSurfaceTone;
  paperColor: string;
  inkColor: string;
  imageFilter: string;
  blendMode: "multiply" | "screen";
};

export type DocumentRenderTheme = {
  surfaceTone: ThemeSurfaceTone;
};

export type ThemeKind = "builtin" | "custom";

export type ThemeDefinition = {
  id: string;
  name: string;
  kind: ThemeKind;
  source: ThemeSources;
  document: DocumentRenderTheme;
};

export type ThemeDraft = {
  name: string;
  source: ThemeSources;
  document: DocumentRenderTheme;
};

export type ThemeSourceDefinition = {
  key: Exclude<ThemeSourceKey, "danger">;
  label: string;
};

export type ThemeSourceSectionDefinition = {
  key: "application" | "document" | "interaction";
  label: string;
  definitions: ThemeSourceDefinition[];
};

export type ResolvedTheme = {
  source: ThemeSources;
  overlaySurface: string;
  overlaySurfaceStrong: string;
  overlayBorder: string;
  contextMenuSurface: string;
  contextMenuHover: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  iconColor: string;
  selectionBackground: string;
  selectionText: string;
  focusRing: string;
  switchOn: string;
  activeSurface: string;
  pageLinkBackground: string;
  pageLinkBorder: string;
  pageLinkText: string;
  pageLinkHoverBackground: string;
  viewerDisplayConfig: ViewerDisplayConfig;
  cssVariables: Record<string, string>;
};

export const DEFAULT_ACTIVE_THEME_ID = "builtin-midnight";

export const themeSourceEditorSections: ThemeSourceSectionDefinition[] = [
  {
    key: "application",
    label: "Application",
    definitions: [
      { key: "chrome", label: "Chrome" },
      { key: "uiText", label: "UI Text" }
    ]
  },
  {
    key: "document",
    label: "Document",
    definitions: [
      { key: "documentPaper", label: "Paper" },
      { key: "documentInk", label: "Ink" }
    ]
  },
  {
    key: "interaction",
    label: "Interaction",
    definitions: [
      { key: "accent", label: "Accent" },
      { key: "interactive", label: "Interactive" }
    ]
  }
];

const HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

type RgbColor = {
  red: number;
  green: number;
  blue: number;
};

type HslColor = {
  hue: number;
  saturation: number;
  lightness: number;
};

type OklabColor = {
  lightness: number;
  a: number;
  b: number;
};

type OklchColor = {
  lightness: number;
  chroma: number;
  hue: number;
};

function clampChannel(value: number) {
  return Math.min(Math.max(Math.round(value), 0), 255);
}

function clampUnit(value: number) {
  return Math.min(Math.max(value, 0), 1);
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function formatCssNumber(value: number) {
  return Number.parseFloat(value.toFixed(3)).toString();
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

function normalizeRgbChannel(channel: number) {
  const normalized = channel / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function toHslColor(color: string): HslColor {
  const { red, green, blue } = parseHexColor(color);
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const lightness = (max + min) / 2;

  if (delta === 0) {
    return {
      hue: 0,
      saturation: 0,
      lightness
    };
  }

  const saturation =
    lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);

  let hue = 0;
  switch (max) {
    case r:
      hue = ((g - b) / delta + (g < b ? 6 : 0)) / 6;
      break;
    case g:
      hue = ((b - r) / delta + 2) / 6;
      break;
    default:
      hue = ((r - g) / delta + 4) / 6;
      break;
  }

  return {
    hue: hue * 360,
    saturation,
    lightness
  };
}

function linearToSrgbChannel(channel: number) {
  return channel <= 0.0031308
    ? 12.92 * channel
    : 1.055 * Math.pow(channel, 1 / 2.4) - 0.055;
}

function toOklabColor(color: string): OklabColor {
  const { red, green, blue } = parseHexColor(color);
  const r = normalizeRgbChannel(red);
  const g = normalizeRgbChannel(green);
  const b = normalizeRgbChannel(blue);

  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  const lRoot = Math.cbrt(l);
  const mRoot = Math.cbrt(m);
  const sRoot = Math.cbrt(s);

  return {
    lightness: 0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot,
    a: 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot,
    b: 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot
  };
}

function toOklchColor(color: string): OklchColor {
  const oklab = toOklabColor(color);
  const hue = (Math.atan2(oklab.b, oklab.a) * 180) / Math.PI;

  return {
    lightness: oklab.lightness,
    chroma: Math.sqrt(oklab.a ** 2 + oklab.b ** 2),
    hue: hue >= 0 ? hue : hue + 360
  };
}

function fromOklchColor(color: OklchColor) {
  const hueRadians = (color.hue * Math.PI) / 180;
  const a = color.chroma * Math.cos(hueRadians);
  const b = color.chroma * Math.sin(hueRadians);

  const lRoot = color.lightness + 0.3963377774 * a + 0.2158037573 * b;
  const mRoot = color.lightness - 0.1055613458 * a - 0.0638541728 * b;
  const sRoot = color.lightness - 0.0894841775 * a - 1.291485548 * b;

  const l = lRoot ** 3;
  const m = mRoot ** 3;
  const s = sRoot ** 3;

  return toHexColor({
    red: linearToSrgbChannel(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s) * 255,
    green: linearToSrgbChannel(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s) * 255,
    blue: linearToSrgbChannel(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s) * 255
  });
}

function getRelativeLuminance(color: string) {
  const { red, green, blue } = parseHexColor(color);

  return (
    0.2126 * normalizeRgbChannel(red) +
    0.7152 * normalizeRgbChannel(green) +
    0.0722 * normalizeRgbChannel(blue)
  );
}

function contrastRatio(colorA: string, colorB: string) {
  const luminanceA = getRelativeLuminance(colorA);
  const luminanceB = getRelativeLuminance(colorB);
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);
  return (lighter + 0.05) / (darker + 0.05);
}

function mixColors(base: string, blend: string, blendAmount: number) {
  const safeBlendAmount = clampUnit(blendAmount);
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
  return `rgba(${rgb.red}, ${rgb.green}, ${rgb.blue}, ${clampUnit(alpha)})`;
}

function lighten(color: string, amount: number) {
  return mixColors(color, "#ffffff", amount);
}

function darken(color: string, amount: number) {
  return mixColors(color, "#000000", amount);
}

type RaisedSurfaceFamily = {
  surface: string;
  surfaceStrong: string;
  hover: string;
  selected: string;
  border: string;
  shadow: string;
};

function createRaisedSurfaceCandidate(
  baseSurface: string,
  textColor: string,
  deltaLightness: number
): RaisedSurfaceFamily & { textContrast: number } {
  const baseOklch = toOklchColor(baseSurface);
  const baseHue = Number.isFinite(baseOklch.hue) ? baseOklch.hue : 0;
  const direction = deltaLightness >= 0 ? 1 : -1;
  const sharedChroma = clampNumber(baseOklch.chroma * 0.88, 0, 0.32);
  const baseLightness = clampUnit(baseOklch.lightness + deltaLightness);
  const strongLightness = clampUnit(baseLightness + direction * 0.02);
  const hoverLightness = clampUnit(baseLightness + direction * 0.028);
  const selectedLightness = clampUnit(baseLightness + direction * 0.042);

  const surface = fromOklchColor({
    lightness: baseLightness,
    chroma: sharedChroma,
    hue: baseHue
  });
  const surfaceStrong = fromOklchColor({
    lightness: strongLightness,
    chroma: clampNumber(sharedChroma * 0.96, 0, 0.32),
    hue: baseHue
  });
  const hover = fromOklchColor({
    lightness: hoverLightness,
    chroma: clampNumber(sharedChroma * 0.94, 0, 0.32),
    hue: baseHue
  });
  const selected = fromOklchColor({
    lightness: selectedLightness,
    chroma: clampNumber(sharedChroma * 0.98, 0, 0.32),
    hue: baseHue
  });
  const textContrast = contrastRatio(textColor, surface);
  const baseLuminance = getRelativeLuminance(baseSurface);
  const shadowColor =
    baseLuminance >= 0.34
      ? withAlpha("#000000", 0.14)
      : withAlpha(darken(baseSurface, 0.42), 0.42);

  return {
    surface,
    surfaceStrong,
    hover,
    selected,
    border: withAlpha(textColor, 0.14),
    shadow: `0 18px 46px ${shadowColor}`,
    textContrast
  };
}

function createRaisedSurfaceFamily(baseSurface: string, textColor: string): RaisedSurfaceFamily {
  const baseOklch = toOklchColor(baseSurface);
  const lighterCandidate = createRaisedSurfaceCandidate(baseSurface, textColor, 0.055);
  const darkerCandidate = createRaisedSurfaceCandidate(baseSurface, textColor, -0.045);

  if (baseOklch.lightness >= 0.62) {
    return darkerCandidate;
  }

  if (baseOklch.lightness <= 0.46) {
    return lighterCandidate;
  }

  return lighterCandidate.textContrast >= darkerCandidate.textContrast
    ? lighterCandidate
    : darkerCandidate;
}

function ensureReadableTextColor(
  preferred: string,
  backgroundHint: string,
  minimumRatio = 4.2
) {
  if (contrastRatio(preferred, backgroundHint) >= minimumRatio) {
    return preferred;
  }

  const darkCandidate = "#0d1116";
  const lightCandidate = "#f7fbff";
  return contrastRatio(darkCandidate, backgroundHint) >= contrastRatio(lightCandidate, backgroundHint)
    ? darkCandidate
    : lightCandidate;
}

function createViewerFilterRecipe(
  source: ThemeSources,
  surfaceTone: ThemeSurfaceTone
) {
  const paperLuminance = getRelativeLuminance(source.documentPaper);
  const inkLuminance = getRelativeLuminance(source.documentInk);
  const paperInkContrast = contrastRatio(source.documentPaper, source.documentInk);
  const inkHsl = toHslColor(source.documentInk);
  const contrastFactor = clampUnit((paperInkContrast - 1) / 8);
  const sepiaAmount =
    surfaceTone === "dark"
      ? clampNumber(inkHsl.saturation * 0.5, 0, 0.52)
      : clampNumber(inkHsl.saturation * 0.34, 0, 0.4);
  const saturateAmount =
    surfaceTone === "dark"
      ? clampNumber(1.2 + inkHsl.saturation * 2.2, 1.2, 3.1)
      : clampNumber(1 + inkHsl.saturation * 1.6, 1, 2.6);
  const brightness =
    surfaceTone === "dark"
      ? clampNumber(0.78 + paperLuminance * 0.22 + inkLuminance * 0.08, 0.74, 0.96)
      : clampNumber(0.96 + paperLuminance * 0.08, 0.92, 1.08);
  const contrast =
    surfaceTone === "dark"
      ? clampNumber(0.9 + contrastFactor * 0.16, 0.88, 1.06)
      : clampNumber(0.92 + contrastFactor * 0.16, 0.9, 1.08);
  const filterParts = [
    surfaceTone === "dark" ? "invert(1)" : "",
    surfaceTone === "dark" ? "hue-rotate(180deg)" : "",
    "grayscale(1)",
    `sepia(${formatCssNumber(sepiaAmount)})`,
    `saturate(${formatCssNumber(saturateAmount)})`,
    `hue-rotate(${Math.round(inkHsl.hue)}deg)`,
    `brightness(${formatCssNumber(brightness)})`,
    `contrast(${formatCssNumber(contrast)})`
  ].filter(Boolean);

  return filterParts.join(" ");
}

export function createDefaultThemeSources(): ThemeSources {
  return {
    chrome: "#13191e",
    uiText: "#d8d8d8",
    documentPaper: "#20242a",
    documentInk: "#d8d8d8",
    accent: "#d4aa63",
    interactive: "#7682da",
    danger: "#b34444"
  };
}

export function createDefaultDocumentRenderTheme(): DocumentRenderTheme {
  return {
    surfaceTone: "dark"
  };
}

export const builtinThemeDefinitions: ThemeDefinition[] = [
  {
    id: "builtin-light",
    name: "Light",
    kind: "builtin",
    source: {
      chrome: "#f1ece2",
      uiText: "#2f261c",
      documentPaper: "#f7f1e5",
      documentInk: "#2f261c",
      accent: "#7b5b33",
      interactive: "#4e6fc4",
      danger: "#b5594f"
    },
    document: {
      surfaceTone: "light"
    }
  },
  {
    id: DEFAULT_ACTIVE_THEME_ID,
    name: "Midnight Reading",
    kind: "builtin",
    source: {
      chrome: "#13191e",
      uiText: "#d8d8d8",
      documentPaper: "#20242a",
      documentInk: "#d8d8d8",
      accent: "#d4aa63",
      interactive: "#7682da",
      danger: "#b34444"
    },
    document: {
      surfaceTone: "dark"
    }
  },
  {
    id: "builtin-sepia",
    name: "Sepia",
    kind: "builtin",
    source: {
      chrome: "#211b16",
      uiText: "#d7c5a8",
      documentPaper: "#eadcbd",
      documentInk: "#3a2c1d",
      accent: "#c28a45",
      interactive: "#a87945",
      danger: "#bd6758"
    },
    document: {
      surfaceTone: "light"
    }
  }
];

const builtinThemeMap = new Map(
  builtinThemeDefinitions.map((themeDefinition) => [themeDefinition.id, themeDefinition] as const)
);

export function normalizeThemeSourceColor(value: unknown, fallback: string) {
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

function normalizeThemeSurfaceTone(value: unknown, fallback: ThemeSurfaceTone) {
  return value === "light" ? "light" : value === "dark" ? "dark" : fallback;
}

export function normalizeThemeSources(candidate: unknown): ThemeSources {
  const defaults = createDefaultThemeSources();
  const record =
    typeof candidate === "object" && candidate !== null && !Array.isArray(candidate)
      ? (candidate as Record<string, unknown>)
      : {};

  return {
    chrome: normalizeThemeSourceColor(record.chrome, defaults.chrome),
    uiText: normalizeThemeSourceColor(record.uiText, defaults.uiText),
    documentPaper: normalizeThemeSourceColor(record.documentPaper, defaults.documentPaper),
    documentInk: normalizeThemeSourceColor(record.documentInk, defaults.documentInk),
    accent: normalizeThemeSourceColor(record.accent, defaults.accent),
    interactive: normalizeThemeSourceColor(record.interactive, defaults.interactive),
    danger: normalizeThemeSourceColor(record.danger, defaults.danger)
  };
}

export function normalizeDocumentRenderTheme(candidate: unknown): DocumentRenderTheme {
  const defaults = createDefaultDocumentRenderTheme();
  const record =
    typeof candidate === "object" && candidate !== null && !Array.isArray(candidate)
      ? (candidate as Record<string, unknown>)
      : {};

  return {
    surfaceTone: normalizeThemeSurfaceTone(record.surfaceTone, defaults.surfaceTone)
  };
}

function normalizeLegacyThemeSources(
  candidate: unknown,
  documentTone: ThemeSurfaceTone
): ThemeSources {
  const defaults = createDefaultThemeSources();
  const record =
    typeof candidate === "object" && candidate !== null && !Array.isArray(candidate)
      ? (candidate as Record<string, unknown>)
      : {};

  const legacyText = normalizeThemeSourceColor(record.text, defaults.uiText);
  const legacyPaper = normalizeThemeSourceColor(record.paper, defaults.documentPaper);
  const fallbackPaper =
    documentTone === "light"
      ? builtinThemeDefinitions[0].source.documentPaper
      : defaults.documentPaper;

  return {
    chrome: normalizeThemeSourceColor(record.chrome, defaults.chrome),
    uiText: legacyText,
    documentPaper: normalizeThemeSourceColor(record.paper, fallbackPaper || legacyPaper),
    documentInk: legacyText,
    accent: normalizeThemeSourceColor(record.accent, defaults.accent),
    interactive: normalizeThemeSourceColor(record.interactive, defaults.interactive),
    danger: normalizeThemeSourceColor(record.danger, defaults.danger)
  };
}

export function normalizeCustomThemeDefinition(
  candidate: unknown,
  fallback?: ThemeDefinition
): ThemeDefinition | null {
  const record =
    typeof candidate === "object" && candidate !== null && !Array.isArray(candidate)
      ? (candidate as Record<string, unknown>)
      : null;
  if (!record) {
    return null;
  }

  const fallbackTheme = fallback ?? createCustomThemeDefinition("custom-theme", "Custom Theme");
  const id =
    typeof record.id === "string" && record.id.trim().length > 0
      ? record.id.trim()
      : fallbackTheme.id;
  const name =
    typeof record.name === "string" && record.name.trim().length > 0
      ? record.name.trim()
      : fallbackTheme.name;
  const document = normalizeDocumentRenderTheme(record.document);
  const sourceCandidate =
    record.source ??
    (typeof record.colors === "object" && record.colors !== null ? record.colors : null);

  return {
    id,
    name,
    kind: "custom",
    source:
      sourceCandidate && isRecordLike(sourceCandidate) && "uiText" in sourceCandidate
        ? normalizeThemeSources(sourceCandidate)
        : normalizeLegacyThemeSources(sourceCandidate, document.surfaceTone),
    document
  };
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createCustomThemeDefinition(
  id: string,
  name: string,
  sourceTheme?: ThemeDefinition
): ThemeDefinition {
  const fallbackTheme =
    sourceTheme ?? builtinThemeMap.get(DEFAULT_ACTIVE_THEME_ID) ?? builtinThemeDefinitions[0];

  return {
    id,
    name,
    kind: "custom",
    source: { ...fallbackTheme.source },
    document: { ...fallbackTheme.document }
  };
}

export function createThemeDraft(themeDefinition: ThemeDefinition): ThemeDraft {
  return {
    name: themeDefinition.name,
    source: { ...themeDefinition.source },
    document: { ...themeDefinition.document }
  };
}

export function applyThemeDraft(
  themeDefinition: ThemeDefinition,
  themeDraft: ThemeDraft
): ThemeDefinition {
  return {
    ...themeDefinition,
    name: themeDraft.name.trim() || themeDefinition.name,
    source: { ...themeDraft.source },
    document: { ...themeDraft.document }
  };
}

export function isBuiltinThemeId(themeId: string) {
  return builtinThemeMap.has(themeId);
}

export function getBuiltinTheme(themeId: string) {
  return builtinThemeMap.get(themeId) ?? null;
}

export function resolveThemeById(
  activeThemeId: string,
  customThemes: readonly ThemeDefinition[]
): ThemeDefinition {
  return (
    customThemes.find((themeDefinition) => themeDefinition.id === activeThemeId) ??
    builtinThemeMap.get(activeThemeId) ??
    builtinThemeMap.get(DEFAULT_ACTIVE_THEME_ID) ??
    builtinThemeDefinitions[0]
  );
}

export function createViewerDisplayConfig(themeDefinition: ThemeDefinition): ViewerDisplayConfig {
  return {
    mode: themeDefinition.document.surfaceTone,
    paperColor: themeDefinition.source.documentPaper,
    inkColor: themeDefinition.source.documentInk,
    imageFilter:
      themeDefinition.document.surfaceTone === "light"
        ? "none"
        : createViewerFilterRecipe(
            themeDefinition.source,
            themeDefinition.document.surfaceTone
          ),
    blendMode: themeDefinition.document.surfaceTone === "dark" ? "screen" : "multiply"
  };
}

export function resolveTheme(themeDefinition: ThemeDefinition): ResolvedTheme {
  const { source } = themeDefinition;
  const workspaceBase = source.chrome;
  const textPrimary = ensureReadableTextColor(source.uiText, workspaceBase, 4.5);
  const workspaceElevated = darken(lighten(source.chrome, 0.02), 0.02);
  const raisedSurfaceFamily = createRaisedSurfaceFamily(workspaceBase, textPrimary);
  const chromeSurface = withAlpha(source.chrome, 0.9);
  const chromeSurfaceStrong = withAlpha(darken(source.chrome, 0.06), 0.96);
  const chromeBorder = lighten(source.chrome, 0.08);
  const textSecondary = withAlpha(textPrimary, 0.72);
  const textMuted = withAlpha(textPrimary, 0.52);
  const iconColor = withAlpha(textPrimary, 0.86);
  const accentPrimary = source.accent;
  const accentSoft = withAlpha(source.accent, 0.18);
  const interactiveHover = withAlpha(textPrimary, 0.05);
  const interactiveActive = withAlpha(source.interactive, 0.22);
  const switchOn = withAlpha(source.interactive, 0.9);
  const focusRing = withAlpha(lighten(source.interactive, 0.22), 0.62);
  const overlaySurface = raisedSurfaceFamily.surface;
  const overlaySurfaceStrong = raisedSurfaceFamily.surfaceStrong;
  const overlayBorder = raisedSurfaceFamily.border;
  const contextMenuSurface = raisedSurfaceFamily.surfaceStrong;
  const contextMenuHover = raisedSurfaceFamily.hover;
  const overlaySurfaceHover = raisedSurfaceFamily.hover;
  const overlaySurfaceSelected = raisedSurfaceFamily.selected;
  const overlayShadow = raisedSurfaceFamily.shadow;
  const selectionBackground = withAlpha(source.interactive, 0.32);
  const selectionText = ensureReadableTextColor(textPrimary, source.interactive, 4);
  const pageLinkBackground = withAlpha(source.interactive, 0.13);
  const pageLinkBorder = withAlpha(source.interactive, 0.2);
  const pageLinkText = withAlpha(textPrimary, 0.88);
  const pageLinkHoverBackground = withAlpha(source.interactive, 0.2);
  const pageLinkHoverBorder = withAlpha(source.interactive, 0.24);
  const pageLinkSelectedBackground = withAlpha(source.interactive, 0.28);
  const pageLinkSelectedBorder = withAlpha(source.interactive, 0.38);
  const pageLinkSelectedText = withAlpha(textPrimary, 0.96);
  const readerStatusSurface = withAlpha(mixColors(source.chrome, darken(source.chrome, 0.18), 0.42), 0.88);
  const readerStatusBorder = withAlpha(lighten(textPrimary, 0.08), 0.12);
  const readerStatusText = withAlpha(textPrimary, 0.74);
  const readerStatusErrorBase = mixColors(source.danger, source.chrome, 0.42);
  const readerStatusErrorSurface = withAlpha(readerStatusErrorBase, 0.9);
  const readerStatusErrorBorder = withAlpha(lighten(source.danger, 0.2), 0.22);
  const readerStatusErrorText = ensureReadableTextColor(lighten(source.danger, 0.36), readerStatusErrorBase, 4);
  const readerStatusDebugBase = mixColors(source.interactive, source.chrome, 0.34);
  const readerStatusDebugSurface = withAlpha(readerStatusDebugBase, 0.92);
  const readerStatusDebugBorder = withAlpha(lighten(source.interactive, 0.16), 0.2);
  const readerStatusDebugText = ensureReadableTextColor(lighten(textPrimary, 0.08), readerStatusDebugBase, 4.2);
  const rapidTurnSurfaceBase = darken(source.chrome, themeDefinition.document.surfaceTone === "light" ? 0.18 : 0.1);
  const rapidTurnSurface = withAlpha(rapidTurnSurfaceBase, 0.9);
  const rapidTurnBorder = withAlpha(lighten(textPrimary, 0.1), 0.14);
  const rapidTurnText = ensureReadableTextColor(lighten(textPrimary, 0.18), rapidTurnSurfaceBase, 4.5);
  const rapidTurnTrack = withAlpha(rapidTurnText, 0.14);
  const rapidTurnProgressStart = lighten(source.accent, 0.04);
  const rapidTurnProgressEnd = mixColors(lighten(source.accent, 0.08), lighten(source.interactive, 0.12), 0.44);
  const rapidTurnMetaText = withAlpha(rapidTurnText, 0.78);
  const rapidTurnShadow = `0 18px 44px ${withAlpha(darken(source.chrome, 0.32), 0.26)}`;
  const searchPlaceholderText = withAlpha(lighten(textPrimary, 0.02), 0.58);
  const searchActionText = withAlpha(lighten(source.interactive, 0.1), 0.96);
  const searchActionMuted = withAlpha(lighten(textPrimary, 0.06), 0.72);
  const searchEmptyText = withAlpha(lighten(textPrimary, 0.04), 0.6);
  const collectionPanelSurface = withAlpha(lighten(source.chrome, 0.02), 0.34);
  const collectionCardSurface = withAlpha(lighten(source.chrome, 0.03), 0.24);
  const collectionCardBorder = withAlpha(lighten(textPrimary, 0.08), 0.08);
  const collectionAddBorder = withAlpha(lighten(source.interactive, 0.12), 0.18);
  const collectionAddBorderHover = withAlpha(lighten(source.interactive, 0.16), 0.26);
  const collectionAddSurfaceStart = withAlpha(mixColors(source.interactive, source.chrome, 0.26), 0.34);
  const collectionAddSurfaceEnd = withAlpha(mixColors(darken(source.chrome, 0.04), source.interactive, 0.12), 0.22);
  const collectionAddSurfaceHoverStart = withAlpha(mixColors(source.interactive, source.chrome, 0.32), 0.42);
  const collectionAddSurfaceHoverEnd = withAlpha(mixColors(darken(source.chrome, 0.06), source.interactive, 0.16), 0.28);
  const collectionAddInset = withAlpha(lighten(textPrimary, 0.14), 0.04);
  const collectionAddShadow = `0 10px 24px ${withAlpha(darken(source.chrome, 0.3), 0.16)}`;
  const collectionRowSeparator = withAlpha(lighten(textPrimary, 0.04), 0.05);
  const collectionRowHover = withAlpha(lighten(textPrimary, 0.04), 0.03);
  const collectionRowActive = withAlpha(source.interactive, 0.22);
  const collectionRowIcon = withAlpha(mixColors(lighten(source.interactive, 0.1), textPrimary, 0.4), 0.9);
  const collectionRowCount = withAlpha(lighten(textPrimary, 0.08), 0.72);
  const collectionActionHover = withAlpha(lighten(textPrimary, 0.08), 0.06);
  const collectionActionDisabled = withAlpha(lighten(textPrimary, 0.14), 0.42);
  const collectionDangerText = ensureReadableTextColor(lighten(source.danger, 0.36), source.danger, 3.8);
  const collectionDangerHover = withAlpha(source.danger, 0.14);
  const collectionTooltipSurface = overlaySurfaceStrong;
  const collectionTooltipBorder = overlayBorder;
  const collectionTooltipText = withAlpha(lighten(textPrimary, 0.08), 0.84);
  const collectionTooltipTitle = withAlpha(lighten(textPrimary, 0.14), 0.96);
  const collectionTooltipHelp = withAlpha(lighten(textPrimary, 0.08), 0.68);
  const collectionTooltipShadow = `0 18px 36px ${withAlpha(darken(source.chrome, 0.34), 0.34)}`;
  const collectionMenuButtonSurface = withAlpha(lighten(textPrimary, 0.08), 0.08);
  const collectionMenuButtonHover = withAlpha(lighten(textPrimary, 0.12), 0.13);
  const collectionMenuButtonGhost = withAlpha(lighten(textPrimary, 0.06), 0.05);
  const collectionMenuButtonDanger = withAlpha(source.danger, 0.18);
  const collectionMenuButtonDangerHover = withAlpha(source.danger, 0.28);
  const collectionBookRowSeparator = withAlpha(lighten(textPrimary, 0.02), 0.035);
  const collectionBookRowHover = withAlpha(lighten(textPrimary, 0.04), 0.03);
  const settingsNavText = withAlpha(lighten(textPrimary, 0.08), 0.72);
  const settingsNavTextActive = lighten(textPrimary, 0.16);
  const settingsLabelText = withAlpha(lighten(textPrimary, 0.06), 0.88);
  const settingsMutedText = withAlpha(lighten(textPrimary, 0.08), 0.68);
  const settingsControlBg = withAlpha(textPrimary, 0.04);
  const settingsControlBgHover = withAlpha(textPrimary, 0.07);
  const settingsControlBorder = withAlpha(textPrimary, 0.09);
  const settingsControlText = withAlpha(lighten(textPrimary, 0.12), 0.92);
  const settingsAccentSurface = withAlpha(source.interactive, 0.22);
  const settingsAccentSurfaceStrong = withAlpha(source.interactive, 0.24);
  const settingsAccentBorder = withAlpha(lighten(source.interactive, 0.16), 0.28);
  const settingsAccentFocus = focusRing;
  const settingsAccentFocusRing = withAlpha(lighten(source.interactive, 0.24), 0.16);
  const settingsSwitchOff = withAlpha(textPrimary, 0.18);
  const settingsSwitchHandle = lighten(textPrimary, 0.18);
  const splitterLine = withAlpha(lighten(textPrimary, 0.1), 0.18);
  const splitterLineActive = withAlpha(lighten(textPrimary, 0.16), 0.34);
  const splitterGripBorder = withAlpha(lighten(textPrimary, 0.12), 0.18);
  const splitterGripBorderActive = withAlpha(lighten(textPrimary, 0.16), 0.3);
  const splitterGripSurfaceStart = withAlpha(lighten(source.chrome, 0.12), 0.98);
  const splitterGripSurfaceEnd = withAlpha(darken(source.chrome, 0.02), 0.98);
  const splitterGripShadow = `0 4px 12px ${withAlpha(darken(source.chrome, 0.28), 0.22)}`;
  const splitterGripShadowActive = `0 6px 14px ${withAlpha(darken(source.chrome, 0.34), 0.28)}`;
  const splitterGripInset = `inset 0 1px 0 ${withAlpha(lighten(textPrimary, 0.14), 0.04)}`;
  const splitterGripInsetActive = `inset 0 1px 0 ${withAlpha(lighten(textPrimary, 0.18), 0.06)}`;
  const splitterDot = withAlpha(lighten(textPrimary, 0.04), 0.55);
  const splitterDotActive = withAlpha(lighten(textPrimary, 0.14), 0.82);
  const readerHeaderDivider = withAlpha(lighten(textPrimary, 0.08), 0.2);
  const notesSurface = withAlpha(source.chrome, 0.9);
  const notesText = lighten(textPrimary, 0.1);
  const notesMuted = withAlpha(lighten(textPrimary, 0.12), 0.76);
  const dangerSurface = withAlpha(source.danger, 0.18);
  const dangerSurfaceStrong = withAlpha(source.danger, 0.85);
  const dangerText = lighten(source.danger, 0.36);
  const viewerDisplayConfig = createViewerDisplayConfig(themeDefinition);

  return {
    source,
    overlaySurface,
    overlaySurfaceStrong,
    overlayBorder,
    contextMenuSurface,
    contextMenuHover,
    textPrimary,
    textSecondary,
    textMuted,
    iconColor,
    selectionBackground,
    selectionText,
    focusRing,
    switchOn,
    activeSurface: interactiveActive,
    pageLinkBackground,
    pageLinkBorder,
    pageLinkText,
    pageLinkHoverBackground,
    viewerDisplayConfig,
    cssVariables: {
      "--theme-workspace": workspaceBase,
      "--theme-chrome": source.chrome,
      "--theme-ui-text": textPrimary,
      "--theme-document-paper": source.documentPaper,
      "--theme-document-ink": source.documentInk,
      "--theme-accent": source.accent,
      "--theme-interactive": source.interactive,
      "--theme-danger": source.danger,
      "--theme-paper": source.documentPaper,
      "--theme-text": textPrimary,
      "--workspace-base": workspaceBase,
      "--workspace-elevated": workspaceElevated,
      "--chrome-surface": chromeSurface,
      "--chrome-surface-strong": chromeSurfaceStrong,
      "--chrome-border": chromeBorder,
      "--chrome-hover": interactiveHover,
      "--chrome-active": interactiveActive,
      "--text-primary": textPrimary,
      "--text-secondary": textSecondary,
      "--text-tertiary": textMuted,
      "--icon-color": iconColor,
      "--accent-primary": accentPrimary,
      "--accent-soft": accentSoft,
      "--interactive-hover": interactiveHover,
      "--interactive-active": interactiveActive,
      "--interactive-switch-on": switchOn,
      "--interactive-focus": focusRing,
      "--selection-background": selectionBackground,
      "--selection-text": selectionText,
      "--focus-ring": focusRing,
      "--active-surface": interactiveActive,
      "--overlay-surface": overlaySurface,
      "--overlay-surface-strong": overlaySurfaceStrong,
      "--overlay-surface-hover": overlaySurfaceHover,
      "--overlay-surface-selected": overlaySurfaceSelected,
      "--overlay-border": overlayBorder,
      "--overlay-shadow": overlayShadow,
      "--context-menu-surface": contextMenuSurface,
      "--context-menu-hover": contextMenuHover,
      "--page-link-background": pageLinkBackground,
      "--page-link-border": pageLinkBorder,
      "--page-link-text": pageLinkText,
      "--page-link-hover-background": pageLinkHoverBackground,
      "--page-link-hover-border": pageLinkHoverBorder,
      "--page-link-hover-text": pageLinkText,
      "--page-link-selected-background": pageLinkSelectedBackground,
      "--page-link-selected-border": pageLinkSelectedBorder,
      "--page-link-selected-text": pageLinkSelectedText,
      "--reader-status-surface": readerStatusSurface,
      "--reader-status-border": readerStatusBorder,
      "--reader-status-text": readerStatusText,
      "--reader-status-error-surface": readerStatusErrorSurface,
      "--reader-status-error-border": readerStatusErrorBorder,
      "--reader-status-error-text": readerStatusErrorText,
      "--reader-status-debug-surface": readerStatusDebugSurface,
      "--reader-status-debug-border": readerStatusDebugBorder,
      "--reader-status-debug-text": readerStatusDebugText,
      "--rapid-turn-surface": rapidTurnSurface,
      "--rapid-turn-border": rapidTurnBorder,
      "--rapid-turn-text": rapidTurnText,
      "--rapid-turn-track": rapidTurnTrack,
      "--rapid-turn-progress-start": rapidTurnProgressStart,
      "--rapid-turn-progress-end": rapidTurnProgressEnd,
      "--rapid-turn-meta-text": rapidTurnMetaText,
      "--rapid-turn-shadow": rapidTurnShadow,
      "--search-placeholder-text": searchPlaceholderText,
      "--search-action-text": searchActionText,
      "--search-action-muted": searchActionMuted,
      "--search-empty-text": searchEmptyText,
      "--collection-panel-surface": collectionPanelSurface,
      "--collection-card-surface": collectionCardSurface,
      "--collection-card-border": collectionCardBorder,
      "--collection-add-border": collectionAddBorder,
      "--collection-add-border-hover": collectionAddBorderHover,
      "--collection-add-surface-start": collectionAddSurfaceStart,
      "--collection-add-surface-end": collectionAddSurfaceEnd,
      "--collection-add-surface-hover-start": collectionAddSurfaceHoverStart,
      "--collection-add-surface-hover-end": collectionAddSurfaceHoverEnd,
      "--collection-add-inset": collectionAddInset,
      "--collection-add-shadow": collectionAddShadow,
      "--collection-row-separator": collectionRowSeparator,
      "--collection-row-hover": collectionRowHover,
      "--collection-row-active": collectionRowActive,
      "--collection-row-icon": collectionRowIcon,
      "--collection-row-count": collectionRowCount,
      "--collection-action-hover": collectionActionHover,
      "--collection-action-disabled": collectionActionDisabled,
      "--collection-danger-text": collectionDangerText,
      "--collection-danger-hover": collectionDangerHover,
      "--collection-tooltip-surface": collectionTooltipSurface,
      "--collection-tooltip-border": collectionTooltipBorder,
      "--collection-tooltip-text": collectionTooltipText,
      "--collection-tooltip-title": collectionTooltipTitle,
      "--collection-tooltip-help": collectionTooltipHelp,
      "--collection-tooltip-shadow": collectionTooltipShadow,
      "--collection-menu-button-surface": collectionMenuButtonSurface,
      "--collection-menu-button-hover": collectionMenuButtonHover,
      "--collection-menu-button-ghost": collectionMenuButtonGhost,
      "--collection-menu-button-danger": collectionMenuButtonDanger,
      "--collection-menu-button-danger-hover": collectionMenuButtonDangerHover,
      "--collection-book-row-separator": collectionBookRowSeparator,
      "--collection-book-row-hover": collectionBookRowHover,
      "--settings-nav-text": settingsNavText,
      "--settings-nav-text-active": settingsNavTextActive,
      "--settings-label-text": settingsLabelText,
      "--settings-muted-text": settingsMutedText,
      "--settings-control-bg": settingsControlBg,
      "--settings-control-bg-hover": settingsControlBgHover,
      "--settings-control-border": settingsControlBorder,
      "--settings-control-text": settingsControlText,
      "--settings-accent-surface": settingsAccentSurface,
      "--settings-accent-surface-strong": settingsAccentSurfaceStrong,
      "--settings-accent-border": settingsAccentBorder,
      "--settings-accent-focus": settingsAccentFocus,
      "--settings-accent-focus-ring": settingsAccentFocusRing,
      "--settings-switch-off": settingsSwitchOff,
      "--settings-switch-handle": settingsSwitchHandle,
      "--reader-header-divider": readerHeaderDivider,
      "--splitter-line": splitterLine,
      "--splitter-line-active": splitterLineActive,
      "--splitter-grip-border": splitterGripBorder,
      "--splitter-grip-border-active": splitterGripBorderActive,
      "--splitter-grip-surface-start": splitterGripSurfaceStart,
      "--splitter-grip-surface-end": splitterGripSurfaceEnd,
      "--splitter-grip-shadow": splitterGripShadow,
      "--splitter-grip-shadow-active": splitterGripShadowActive,
      "--splitter-grip-inset": splitterGripInset,
      "--splitter-grip-inset-active": splitterGripInsetActive,
      "--splitter-dot": splitterDot,
      "--splitter-dot-active": splitterDotActive,
      "--notes-surface": notesSurface,
      "--notes-text": notesText,
      "--notes-text-muted": notesMuted,
      "--paper-surface": source.documentPaper,
      "--paper-surface-dark": source.documentPaper,
      "--paper-shadow": withAlpha(
        darken(source.documentPaper, themeDefinition.document.surfaceTone === "dark" ? 0.24 : 0.38),
        themeDefinition.document.surfaceTone === "dark" ? 0.42 : 0.35
      ),
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
      "--accent": accentPrimary,
      "--paper": source.documentPaper
    }
  };
}

export function deriveThemeCssVariables(themeDefinition: ThemeDefinition): Record<string, string> {
  return resolveTheme(themeDefinition).cssVariables;
}
