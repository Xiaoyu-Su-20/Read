import { DEFAULT_READER_PANE_SPLIT_RATIO, normalizeReaderPaneSplitRatio } from "../reader/paneLayout";
import {
  DEFAULT_ACTIVE_THEME_ID,
  applyThemeDraft,
  builtinThemeDefinitions,
  createCustomThemeDefinition,
  createDefaultThemeSources,
  createThemeDraft,
  deriveThemeCssVariables,
  isBuiltinThemeId,
  normalizeCustomThemeDefinition,
  normalizeDocumentRenderTheme,
  normalizeThemeSourceColor,
  resolveTheme,
  resolveThemeById,
  themeSourceEditorSections,
  type DocumentRenderTheme,
  type ThemeDefinition,
  type ThemeDraft,
  type ThemeSourceKey,
  type ThemeSources,
  type ThemeSurfaceTone,
  type ViewerDisplayConfig
} from "./themeProfile";

export const APP_SETTINGS_STORAGE_KEY = "calm-reader.settings";
export const APP_SETTINGS_VERSION = 7;

export type ReaderPreferences = {
  fullscreenMode: boolean;
  showPageNumbers: boolean;
  twoPageView: boolean;
  verticalScrolling: boolean;
};

export type AppSettingsSchema = {
  readerPaneSplitRatio: number;
  readerPreferences: ReaderPreferences;
  activeThemeId: string;
  customThemes: ThemeDefinition[];
};

export type AppSettingKey = keyof AppSettingsSchema;

export type AppSettingsPayload = {
  version: number;
  settings: AppSettingsSchema;
};

export type ThemeEditorConfig = {
  activeTheme: ThemeDefinition;
  canEdit: boolean;
  canDelete: boolean;
  sourceSections: typeof themeSourceEditorSections;
};

type LegacyDocumentAppearanceMode = "light" | "dark";
type LegacyAppearanceProfileSource = "default" | "custom";

type LegacyAppearanceProfile = {
  paperColor: string;
  paperColorSource: LegacyAppearanceProfileSource;
  brightness: number;
  contrast: number;
};

type LegacyDarkAppearanceProfile = LegacyAppearanceProfile & {
  inversion: number;
};

type LegacyDocumentAppearanceSettings = {
  mode: LegacyDocumentAppearanceMode;
  useOnePaperColorForBoth: boolean;
  light: LegacyAppearanceProfile;
  dark: LegacyDarkAppearanceProfile;
};

type LegacyThemeProfile = {
  chrome: string;
  text: string;
  accent: string;
  interactive: string;
  danger: string;
};

type LegacySettingsV4 = {
  documentAppearance: LegacyDocumentAppearanceSettings;
  readerPaneSplitRatio: number;
  fullscreenMode: boolean;
  showPageNumbers: boolean;
  twoPageView: boolean;
  verticalScrolling: boolean;
  themeProfile: LegacyThemeProfile;
};

type AppSettingDefinition<Key extends AppSettingKey> = {
  defaultValue: AppSettingsSchema[Key];
  normalize: (value: unknown) => AppSettingsSchema[Key];
};

type AppSettingsRegistry = {
  [Key in AppSettingKey]: AppSettingDefinition<Key>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeString(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function normalizeReaderPreferences(value: unknown): ReaderPreferences {
  const record = isRecord(value) ? value : {};

  return {
    fullscreenMode: normalizeBoolean(record.fullscreenMode, false),
    showPageNumbers: normalizeBoolean(record.showPageNumbers, true),
    twoPageView: normalizeBoolean(record.twoPageView, false),
    verticalScrolling: normalizeBoolean(record.verticalScrolling, true)
  };
}

function normalizeCustomThemes(value: unknown): ThemeDefinition[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const nextThemes: ThemeDefinition[] = [];
  const seenThemeIds = new Set<string>();

  for (const themeCandidate of value) {
    const normalizedTheme = normalizeCustomThemeDefinition(themeCandidate);
    if (!normalizedTheme) {
      continue;
    }
    if (isBuiltinThemeId(normalizedTheme.id) || seenThemeIds.has(normalizedTheme.id)) {
      continue;
    }

    seenThemeIds.add(normalizedTheme.id);
    nextThemes.push(normalizedTheme);
  }

  return nextThemes;
}

function normalizeActiveThemeId(
  value: unknown,
  customThemes: readonly ThemeDefinition[]
) {
  const candidate = normalizeString(value, DEFAULT_ACTIVE_THEME_ID);
  if (isBuiltinThemeId(candidate)) {
    return candidate;
  }

  return customThemes.some((themeDefinition) => themeDefinition.id === candidate)
    ? candidate
    : DEFAULT_ACTIVE_THEME_ID;
}

function normalizeLegacyMode(value: unknown): LegacyDocumentAppearanceMode {
  return value === "dark" ? "dark" : "light";
}

function normalizeLegacyAppearanceProfileSource(
  value: unknown
): LegacyAppearanceProfileSource {
  return value === "custom" ? "custom" : "default";
}

function normalizeNumber(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(Math.max(value, min), max);
}

function createDefaultLegacyLightAppearanceProfile(): LegacyAppearanceProfile {
  return {
    paperColor: "#c8c2b8",
    paperColorSource: "default",
    brightness: 1,
    contrast: 1
  };
}

function createDefaultLegacyDarkAppearanceProfile(): LegacyDarkAppearanceProfile {
  return {
    paperColor: "#20242a",
    paperColorSource: "default",
    brightness: 0.9,
    contrast: 0.92,
    inversion: 1
  };
}

function createDefaultLegacyDocumentAppearanceSettings(): LegacyDocumentAppearanceSettings {
  return {
    mode: "light",
    useOnePaperColorForBoth: false,
    light: createDefaultLegacyLightAppearanceProfile(),
    dark: createDefaultLegacyDarkAppearanceProfile()
  };
}

function normalizeLegacyAppearanceProfile(
  value: unknown,
  defaults: LegacyAppearanceProfile
): LegacyAppearanceProfile {
  const record = isRecord(value) ? value : {};
  const paperColor = normalizeThemeSourceColor(record.paperColor, defaults.paperColor);

  return {
    paperColor,
    paperColorSource:
      paperColor === defaults.paperColor
        ? normalizeLegacyAppearanceProfileSource(record.paperColorSource)
        : "custom",
    brightness: normalizeNumber(record.brightness, defaults.brightness, 0.25, 2),
    contrast: normalizeNumber(record.contrast, defaults.contrast, 0.25, 2)
  };
}

function normalizeLegacyDarkAppearanceProfile(
  value: unknown,
  defaults: LegacyDarkAppearanceProfile
): LegacyDarkAppearanceProfile {
  const normalizedBase = normalizeLegacyAppearanceProfile(value, defaults);
  const record = isRecord(value) ? value : {};

  return {
    ...normalizedBase,
    inversion: normalizeNumber(record.inversion, defaults.inversion, 0, 1)
  };
}

function extractLegacyPaperColor(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  return normalizeThemeSourceColor(
    value.paper,
    createDefaultLegacyLightAppearanceProfile().paperColor
  );
}

function syncLegacyPaperColorAcrossProfiles(
  settings: LegacyDocumentAppearanceSettings
): LegacyDocumentAppearanceSettings {
  const sourceProfile = settings.mode === "dark" ? settings.dark : settings.light;
  return {
    ...settings,
    light: {
      ...settings.light,
      paperColor: sourceProfile.paperColor,
      paperColorSource: sourceProfile.paperColorSource
    },
    dark: {
      ...settings.dark,
      paperColor: sourceProfile.paperColor,
      paperColorSource: sourceProfile.paperColorSource
    }
  };
}

function normalizeLegacyDocumentAppearanceFromLegacy(
  modeCandidate: unknown,
  legacyPaperColor: string | null
): LegacyDocumentAppearanceSettings {
  const defaults = createDefaultLegacyDocumentAppearanceSettings();

  return {
    ...defaults,
    mode: normalizeLegacyMode(modeCandidate),
    light: legacyPaperColor
      ? {
          ...defaults.light,
          paperColor: legacyPaperColor,
          paperColorSource: legacyPaperColor === defaults.light.paperColor ? "default" : "custom"
        }
      : defaults.light
  };
}

function normalizeLegacyDocumentAppearanceSettings(
  value: unknown
): LegacyDocumentAppearanceSettings {
  if (!isRecord(value) || !("mode" in value) || !("light" in value) || !("dark" in value)) {
    return normalizeLegacyDocumentAppearanceFromLegacy(value, null);
  }

  const defaults = createDefaultLegacyDocumentAppearanceSettings();
  const normalized = {
    mode: normalizeLegacyMode(value.mode),
    useOnePaperColorForBoth: normalizeBoolean(value.useOnePaperColorForBoth, false),
    light: normalizeLegacyAppearanceProfile(value.light, defaults.light),
    dark: normalizeLegacyDarkAppearanceProfile(value.dark, defaults.dark)
  } satisfies LegacyDocumentAppearanceSettings;

  return normalized.useOnePaperColorForBoth
    ? syncLegacyPaperColorAcrossProfiles(normalized)
    : normalized;
}

function normalizeLegacyThemeProfile(candidate: unknown): LegacyThemeProfile {
  const defaults = createDefaultThemeSources();
  const record = isRecord(candidate) ? candidate : {};

  return {
    chrome: normalizeThemeSourceColor(record.chrome, defaults.chrome),
    text: normalizeThemeSourceColor(record.text, defaults.uiText),
    accent: normalizeThemeSourceColor(record.accent, defaults.accent),
    interactive: normalizeThemeSourceColor(record.interactive, defaults.interactive),
    danger: normalizeThemeSourceColor(record.danger, defaults.danger)
  };
}

function normalizeLegacySettingsV4(candidate: unknown): LegacySettingsV4 {
  const record = isRecord(candidate) ? candidate : {};

  return {
    documentAppearance: normalizeLegacyDocumentAppearanceSettings(record.documentAppearance),
    readerPaneSplitRatio: normalizeReaderPaneSplitRatio(record.readerPaneSplitRatio),
    fullscreenMode: normalizeBoolean(record.fullscreenMode, false),
    showPageNumbers: normalizeBoolean(record.showPageNumbers, true),
    twoPageView: normalizeBoolean(record.twoPageView, false),
    verticalScrolling: normalizeBoolean(record.verticalScrolling, true),
    themeProfile: normalizeLegacyThemeProfile(record.themeProfile)
  };
}

function createMigratedCustomTheme(
  legacySettings: LegacySettingsV4
): ThemeDefinition {
  const activeProfile =
    legacySettings.documentAppearance.mode === "dark"
      ? legacySettings.documentAppearance.dark
      : legacySettings.documentAppearance.light;

  return {
    id: "custom-migrated",
    name: "Migrated Theme",
    kind: "custom",
    source: {
      chrome: legacySettings.themeProfile.chrome,
      uiText: legacySettings.themeProfile.text,
      documentPaper: activeProfile.paperColor,
      documentInk: legacySettings.themeProfile.text,
      accent: legacySettings.themeProfile.accent,
      interactive: legacySettings.themeProfile.interactive,
      danger: legacySettings.themeProfile.danger
    },
    document: {
      surfaceTone: legacySettings.documentAppearance.mode
    }
  };
}

function migrateFromVersionZero(candidate: unknown) {
  if (!isRecord(candidate)) {
    return {};
  }

  if (isRecord(candidate.settings)) {
    return candidate.settings;
  }

  if (isRecord(candidate.values)) {
    return candidate.values;
  }

  return candidate;
}

function migrateFromVersionTwo(candidate: unknown) {
  if (!isRecord(candidate)) {
    return candidate;
  }

  if (isRecord(candidate.documentAppearance) && "mode" in candidate.documentAppearance) {
    return candidate;
  }

  return {
    ...candidate,
    documentAppearance: normalizeLegacyDocumentAppearanceFromLegacy(
      candidate.documentAppearance,
      extractLegacyPaperColor(candidate.themeProfile)
    )
  };
}

function migrateFromVersionFour(candidate: unknown): AppSettingsSchema {
  const legacySettings = normalizeLegacySettingsV4(candidate);
  const migratedTheme = createMigratedCustomTheme(legacySettings);

  return normalizeAppSettings({
    readerPaneSplitRatio: legacySettings.readerPaneSplitRatio,
    readerPreferences: {
      fullscreenMode: legacySettings.fullscreenMode,
      showPageNumbers: legacySettings.showPageNumbers,
      twoPageView: legacySettings.twoPageView,
      verticalScrolling: legacySettings.verticalScrolling
    },
    activeThemeId: migratedTheme.id,
    customThemes: [migratedTheme]
  });
}

function migrateFromVersionFive(candidate: unknown): AppSettingsSchema {
  return normalizeAppSettings(candidate);
}

function migrateFromVersionSix(candidate: unknown): AppSettingsSchema {
  return normalizeAppSettings(candidate);
}

function generateThemeId() {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createUniqueThemeName(
  existingThemes: readonly ThemeDefinition[],
  baseName: string
) {
  const trimmedBaseName = baseName.trim() || "Custom Theme";
  const existingNames = new Set(existingThemes.map((themeDefinition) => themeDefinition.name));
  if (!existingNames.has(trimmedBaseName)) {
    return trimmedBaseName;
  }

  let suffix = 2;
  while (existingNames.has(`${trimmedBaseName} ${suffix}`)) {
    suffix += 1;
  }

  return `${trimmedBaseName} ${suffix}`;
}

export const appSettingsRegistry = {
  readerPaneSplitRatio: {
    defaultValue: DEFAULT_READER_PANE_SPLIT_RATIO,
    normalize: normalizeReaderPaneSplitRatio
  },
  readerPreferences: {
    defaultValue: {
      fullscreenMode: false,
      showPageNumbers: true,
      twoPageView: false,
      verticalScrolling: true
    },
    normalize: normalizeReaderPreferences
  },
  activeThemeId: {
    defaultValue: DEFAULT_ACTIVE_THEME_ID,
    normalize: (value) => normalizeString(value, DEFAULT_ACTIVE_THEME_ID)
  },
  customThemes: {
    defaultValue: [],
    normalize: normalizeCustomThemes
  }
} satisfies AppSettingsRegistry;

export function createDefaultAppSettings(): AppSettingsSchema {
  return {
    readerPaneSplitRatio: appSettingsRegistry.readerPaneSplitRatio.defaultValue,
    readerPreferences: appSettingsRegistry.readerPreferences.defaultValue,
    activeThemeId: appSettingsRegistry.activeThemeId.defaultValue,
    customThemes: appSettingsRegistry.customThemes.defaultValue
  };
}

export function createDefaultAppSettingsPayload(): AppSettingsPayload {
  return {
    version: APP_SETTINGS_VERSION,
    settings: createDefaultAppSettings()
  };
}

export function normalizeAppSettings(candidate: unknown): AppSettingsSchema {
  const record = isRecord(candidate) ? candidate : {};
  const customThemes = appSettingsRegistry.customThemes.normalize(record.customThemes);

  return {
    readerPaneSplitRatio: appSettingsRegistry.readerPaneSplitRatio.normalize(
      record.readerPaneSplitRatio
    ),
    readerPreferences: appSettingsRegistry.readerPreferences.normalize(record.readerPreferences),
    activeThemeId: normalizeActiveThemeId(record.activeThemeId, customThemes),
    customThemes
  };
}

export function migrateAppSettingsPayload(candidate: unknown): AppSettingsPayload {
  if (!isRecord(candidate)) {
    return createDefaultAppSettingsPayload();
  }

  let version = typeof candidate.version === "number" ? candidate.version : 0;
  let nextSettingsCandidate: unknown =
    typeof candidate.version === "number" && "settings" in candidate
      ? candidate.settings
      : candidate;

  while (version < APP_SETTINGS_VERSION) {
    switch (version) {
      case 0:
        nextSettingsCandidate = migrateFromVersionZero(nextSettingsCandidate);
        version = 1;
        break;
      case 1:
        version = 2;
        break;
      case 2:
        nextSettingsCandidate = migrateFromVersionTwo(nextSettingsCandidate);
        version = 3;
        break;
      case 3:
        version = 4;
        break;
      case 4:
        nextSettingsCandidate = migrateFromVersionFour(nextSettingsCandidate);
        version = 5;
        break;
      case 5:
        nextSettingsCandidate = migrateFromVersionFive(nextSettingsCandidate);
        version = 6;
        break;
      case 6:
        nextSettingsCandidate = migrateFromVersionSix(nextSettingsCandidate);
        version = 7;
        break;
      default:
        version = APP_SETTINGS_VERSION;
        break;
    }
  }

  if (version > APP_SETTINGS_VERSION && isRecord(candidate.settings)) {
    nextSettingsCandidate = candidate.settings;
  }

  return {
    version: APP_SETTINGS_VERSION,
    settings: normalizeAppSettings(nextSettingsCandidate)
  };
}

export function parseStoredAppSettings(rawValue: string | null): AppSettingsPayload {
  if (!rawValue) {
    return createDefaultAppSettingsPayload();
  }

  try {
    return migrateAppSettingsPayload(JSON.parse(rawValue) as unknown);
  } catch {
    return createDefaultAppSettingsPayload();
  }
}

export function serializeAppSettingsPayload(payload: AppSettingsPayload) {
  return JSON.stringify(payload);
}

export function createViewerDisplayConfig(themeDefinition: ThemeDefinition): ViewerDisplayConfig {
  return resolveTheme(themeDefinition).viewerDisplayConfig;
}

export function resolveViewerPaperColor(viewerDisplayConfig: ViewerDisplayConfig) {
  return viewerDisplayConfig.paperColor;
}

export function resolveViewerImageFilter(viewerDisplayConfig: ViewerDisplayConfig) {
  return viewerDisplayConfig.imageFilter;
}

export function createThemePreview(themeDefinition: ThemeDefinition) {
  return {
    id: themeDefinition.id,
    name: themeDefinition.name,
    kind: themeDefinition.kind,
    chromeColor: themeDefinition.source.chrome,
    paperColor: themeDefinition.source.documentPaper,
    textColor: themeDefinition.source.uiText
  };
}

export function createNewCustomTheme(settings: AppSettingsSchema): AppSettingsSchema {
  const activeTheme = resolveThemeById(settings.activeThemeId, settings.customThemes);
  const themeList = [...builtinThemeDefinitions, ...settings.customThemes];
  const themeName = createUniqueThemeName(themeList, "New Theme");
  const nextTheme = createCustomThemeDefinition(generateThemeId(), themeName, activeTheme);

  return normalizeAppSettings({
    ...settings,
    activeThemeId: nextTheme.id,
    customThemes: [...settings.customThemes, nextTheme]
  });
}

export function duplicateTheme(settings: AppSettingsSchema, themeId: string): AppSettingsSchema {
  const sourceTheme = resolveThemeById(themeId, settings.customThemes);
  const themeList = [...builtinThemeDefinitions, ...settings.customThemes];
  const nextTheme = createCustomThemeDefinition(
    generateThemeId(),
    createUniqueThemeName(themeList, `${sourceTheme.name} Copy`),
    sourceTheme
  );

  return normalizeAppSettings({
    ...settings,
    activeThemeId: nextTheme.id,
    customThemes: [...settings.customThemes, nextTheme]
  });
}

export function deleteCustomTheme(
  settings: AppSettingsSchema,
  themeId: string
): AppSettingsSchema {
  if (isBuiltinThemeId(themeId)) {
    return settings;
  }

  const nextThemes = settings.customThemes.filter(
    (themeDefinition) => themeDefinition.id !== themeId
  );
  const nextActiveThemeId =
    settings.activeThemeId === themeId ? DEFAULT_ACTIVE_THEME_ID : settings.activeThemeId;

  return normalizeAppSettings({
    ...settings,
    activeThemeId: nextActiveThemeId,
    customThemes: nextThemes
  });
}

export function saveCustomThemeDraft(
  settings: AppSettingsSchema,
  themeId: string,
  themeDraft: ThemeDraft
): AppSettingsSchema {
  if (isBuiltinThemeId(themeId)) {
    return settings;
  }

  return normalizeAppSettings({
    ...settings,
    customThemes: settings.customThemes.map((themeDefinition) =>
      themeDefinition.id === themeId
        ? applyThemeDraft(themeDefinition, themeDraft)
        : themeDefinition
    )
  });
}

export function updateThemeDraftColor(
  themeDraft: ThemeDraft,
  key: ThemeSourceKey,
  value: string
): ThemeDraft {
  return {
    ...themeDraft,
    source: {
      ...themeDraft.source,
      [key]: normalizeThemeSourceColor(value, themeDraft.source[key])
    }
  };
}

export function updateThemeDraftName(themeDraft: ThemeDraft, value: string): ThemeDraft {
  return {
    ...themeDraft,
    name: value
  };
}

export function updateThemeDraftDocument(
  themeDraft: ThemeDraft,
  value: Partial<DocumentRenderTheme>
): ThemeDraft {
  return {
    ...themeDraft,
    document: normalizeDocumentRenderTheme({
      ...themeDraft.document,
      ...value
    })
  };
}

export const appSettingsSelectors = {
  readerPaneSplitRatio(settings: AppSettingsSchema) {
    return settings.readerPaneSplitRatio;
  },
  readerPreferences(settings: AppSettingsSchema) {
    return settings.readerPreferences;
  },
  themeList(settings: AppSettingsSchema) {
    return [...builtinThemeDefinitions, ...settings.customThemes];
  },
  activeTheme(settings: AppSettingsSchema) {
    return resolveThemeById(settings.activeThemeId, settings.customThemes);
  },
  themePresetCards(settings: AppSettingsSchema) {
    return [...builtinThemeDefinitions, ...settings.customThemes].map(createThemePreview);
  },
  themeEditorConfig(settings: AppSettingsSchema): ThemeEditorConfig {
    const activeTheme = resolveThemeById(settings.activeThemeId, settings.customThemes);
    return {
      activeTheme,
      canEdit: activeTheme.kind === "custom",
      canDelete: activeTheme.kind === "custom",
      sourceSections: themeSourceEditorSections
    };
  },
  viewerDisplayConfig(settings: AppSettingsSchema): ViewerDisplayConfig {
    return createViewerDisplayConfig(resolveThemeById(settings.activeThemeId, settings.customThemes));
  },
  themeCssVariables(settings: AppSettingsSchema) {
    return deriveThemeCssVariables(resolveThemeById(settings.activeThemeId, settings.customThemes));
  }
};

export {
  applyThemeDraft,
  builtinThemeDefinitions,
  createThemeDraft,
  deriveThemeCssVariables,
  resolveTheme,
  resolveThemeById,
  themeSourceEditorSections
};

export type {
  ThemeDefinition,
  ThemeDraft,
  ThemeSources,
  ThemeSourceKey,
  ThemeSurfaceTone,
  ViewerDisplayConfig
};
