import {
  createDefaultThemeProfile,
  deriveThemeCssVariables,
  normalizeThemeColor,
  normalizeThemeProfile,
  type ThemeProfile
} from "./themeProfile";

export const APP_SETTINGS_STORAGE_KEY = "calm-reader.settings";
export const APP_SETTINGS_VERSION = 3;

export type DocumentAppearanceMode = "light" | "dark";
export type AppearanceProfileSource = "default" | "custom";

export type AppearanceProfile = {
  paperColor: string;
  paperColorSource: AppearanceProfileSource;
  brightness: number;
  contrast: number;
};

export type DarkAppearanceProfile = AppearanceProfile & {
  inversion: number;
};

export type DocumentAppearanceSettings = {
  mode: DocumentAppearanceMode;
  useOnePaperColorForBoth: boolean;
  light: AppearanceProfile;
  dark: DarkAppearanceProfile;
};

export type AppSettingsSchema = {
  documentAppearance: DocumentAppearanceSettings;
  fullscreenMode: boolean;
  showPageNumbers: boolean;
  twoPageView: boolean;
  verticalScrolling: boolean;
  themeProfile: ThemeProfile;
};

export type AppSettingKey = keyof AppSettingsSchema;

export type AppSettingsPayload = {
  version: number;
  settings: AppSettingsSchema;
};

export type ViewerDisplayConfig = DocumentAppearanceSettings;

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

function normalizeMode(value: unknown): DocumentAppearanceMode {
  return value === "dark" ? "dark" : "light";
}

function normalizeNumber(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(Math.max(value, min), max);
}

function normalizePaperColorSource(value: unknown): AppearanceProfileSource {
  return value === "custom" ? "custom" : "default";
}

export function createDefaultLightAppearanceProfile(): AppearanceProfile {
  return {
    paperColor: "#c8c2b8",
    paperColorSource: "default",
    brightness: 1,
    contrast: 1
  };
}

export function createDefaultDarkAppearanceProfile(): DarkAppearanceProfile {
  return {
    paperColor: "#20242a",
    paperColorSource: "default",
    brightness: 0.9,
    contrast: 0.92,
    inversion: 1
  };
}

export function createDefaultDocumentAppearanceSettings(): DocumentAppearanceSettings {
  return {
    mode: "light",
    useOnePaperColorForBoth: false,
    light: createDefaultLightAppearanceProfile(),
    dark: createDefaultDarkAppearanceProfile()
  };
}

function normalizeAppearanceProfile(
  value: unknown,
  defaults: AppearanceProfile
): AppearanceProfile {
  const record = isRecord(value) ? value : {};
  const paperColor = normalizeThemeColor(record.paperColor, defaults.paperColor);

  return {
    paperColor,
    paperColorSource:
      paperColor === defaults.paperColor
        ? normalizePaperColorSource(record.paperColorSource)
        : "custom",
    brightness: normalizeNumber(record.brightness, defaults.brightness, 0.25, 2),
    contrast: normalizeNumber(record.contrast, defaults.contrast, 0.25, 2)
  };
}

function normalizeDarkAppearanceProfile(
  value: unknown,
  defaults: DarkAppearanceProfile
): DarkAppearanceProfile {
  const normalizedBase = normalizeAppearanceProfile(value, defaults);
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

  return normalizeThemeColor(value.paper, createDefaultLightAppearanceProfile().paperColor);
}

function syncPaperColorAcrossProfiles(
  settings: DocumentAppearanceSettings
): DocumentAppearanceSettings {
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

function normalizeDocumentAppearanceFromLegacy(
  modeCandidate: unknown,
  legacyPaperColor: string | null
): DocumentAppearanceSettings {
  const defaults = createDefaultDocumentAppearanceSettings();

  return {
    ...defaults,
    mode: normalizeMode(modeCandidate),
    light: legacyPaperColor
      ? {
          ...defaults.light,
          paperColor: legacyPaperColor,
          paperColorSource: legacyPaperColor === defaults.light.paperColor ? "default" : "custom"
        }
      : defaults.light
  };
}

export function normalizeDocumentAppearanceSettings(
  value: unknown
): DocumentAppearanceSettings {
  if (!isRecord(value) || !("mode" in value) || !("light" in value) || !("dark" in value)) {
    return normalizeDocumentAppearanceFromLegacy(value, null);
  }

  const defaults = createDefaultDocumentAppearanceSettings();
  const normalized = {
    mode: normalizeMode(value.mode),
    useOnePaperColorForBoth: normalizeBoolean(value.useOnePaperColorForBoth, false),
    light: normalizeAppearanceProfile(value.light, defaults.light),
    dark: normalizeDarkAppearanceProfile(value.dark, defaults.dark)
  } satisfies DocumentAppearanceSettings;

  return normalized.useOnePaperColorForBoth ? syncPaperColorAcrossProfiles(normalized) : normalized;
}

export function getActiveAppearanceProfile(
  documentAppearance: DocumentAppearanceSettings
): AppearanceProfile | DarkAppearanceProfile {
  return documentAppearance.mode === "dark"
    ? documentAppearance.dark
    : documentAppearance.light;
}

export function updateDocumentAppearanceMode(
  current: DocumentAppearanceSettings,
  nextMode: DocumentAppearanceMode
) {
  return normalizeDocumentAppearanceSettings({
    ...current,
    mode: nextMode
  });
}

export function updateDocumentAppearancePaperColor(
  current: DocumentAppearanceSettings,
  nextPaperColor: string
) {
  const activeKey = current.mode === "dark" ? "dark" : "light";
  const activeProfile = current[activeKey];

  const nextSettings: DocumentAppearanceSettings = {
    ...current,
    [activeKey]: {
      ...activeProfile,
      paperColor: nextPaperColor,
      paperColorSource: "custom"
    }
  };

  return current.useOnePaperColorForBoth
    ? syncPaperColorAcrossProfiles(nextSettings)
    : normalizeDocumentAppearanceSettings(nextSettings);
}

export function toggleSharedDocumentAppearancePaper(
  current: DocumentAppearanceSettings
) {
  const nextValue = !current.useOnePaperColorForBoth;
  const nextSettings = normalizeDocumentAppearanceSettings({
    ...current,
    useOnePaperColorForBoth: nextValue
  });

  return nextValue ? syncPaperColorAcrossProfiles(nextSettings) : nextSettings;
}

export function resetActiveDocumentAppearanceProfile(
  current: DocumentAppearanceSettings
) {
  const defaults = createDefaultDocumentAppearanceSettings();
  const activeKey = current.mode === "dark" ? "dark" : "light";

  const nextSettings: DocumentAppearanceSettings = {
    ...current,
    [activeKey]: defaults[activeKey]
  };

  return current.useOnePaperColorForBoth
    ? syncPaperColorAcrossProfiles(nextSettings)
    : normalizeDocumentAppearanceSettings(nextSettings);
}

export function resetAllDocumentAppearanceSettings(
  currentMode: DocumentAppearanceMode
) {
  return normalizeDocumentAppearanceSettings({
    ...createDefaultDocumentAppearanceSettings(),
    mode: currentMode
  });
}

export function resolveViewerPaperColor(documentAppearance: DocumentAppearanceSettings) {
  return getActiveAppearanceProfile(documentAppearance).paperColor;
}

function buildImageFilter(
  profile: AppearanceProfile | DarkAppearanceProfile,
  mode: DocumentAppearanceMode
) {
  const filterParts: string[] = [];
  if (mode === "dark") {
    const darkProfile = profile as DarkAppearanceProfile;
    if (darkProfile.inversion > 0) {
      filterParts.push(`invert(${darkProfile.inversion})`, "hue-rotate(180deg)");
    }
  }

  filterParts.push(`brightness(${profile.brightness})`, `contrast(${profile.contrast})`);
  return filterParts.join(" ");
}

export function resolveViewerImageFilter(documentAppearance: DocumentAppearanceSettings) {
  const activeProfile = getActiveAppearanceProfile(documentAppearance);
  return buildImageFilter(activeProfile, documentAppearance.mode);
}

export const appSettingsRegistry = {
  documentAppearance: {
    defaultValue: createDefaultDocumentAppearanceSettings(),
    normalize: normalizeDocumentAppearanceSettings
  },
  fullscreenMode: {
    defaultValue: false,
    normalize: (value) => normalizeBoolean(value, false)
  },
  showPageNumbers: {
    defaultValue: true,
    normalize: (value) => normalizeBoolean(value, true)
  },
  twoPageView: {
    defaultValue: false,
    normalize: (value) => normalizeBoolean(value, false)
  },
  verticalScrolling: {
    defaultValue: true,
    normalize: (value) => normalizeBoolean(value, true)
  },
  themeProfile: {
    defaultValue: createDefaultThemeProfile(),
    normalize: normalizeThemeProfile
  }
} satisfies AppSettingsRegistry;

export function createDefaultAppSettings(): AppSettingsSchema {
  return {
    documentAppearance: appSettingsRegistry.documentAppearance.defaultValue,
    fullscreenMode: appSettingsRegistry.fullscreenMode.defaultValue,
    showPageNumbers: appSettingsRegistry.showPageNumbers.defaultValue,
    twoPageView: appSettingsRegistry.twoPageView.defaultValue,
    verticalScrolling: appSettingsRegistry.verticalScrolling.defaultValue,
    themeProfile: appSettingsRegistry.themeProfile.defaultValue
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

  return {
    documentAppearance: appSettingsRegistry.documentAppearance.normalize(record.documentAppearance),
    fullscreenMode: appSettingsRegistry.fullscreenMode.normalize(record.fullscreenMode),
    showPageNumbers: appSettingsRegistry.showPageNumbers.normalize(record.showPageNumbers),
    twoPageView: appSettingsRegistry.twoPageView.normalize(record.twoPageView),
    verticalScrolling: appSettingsRegistry.verticalScrolling.normalize(record.verticalScrolling),
    themeProfile: appSettingsRegistry.themeProfile.normalize(record.themeProfile)
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
    documentAppearance: normalizeDocumentAppearanceFromLegacy(
      candidate.documentAppearance,
      extractLegacyPaperColor(candidate.themeProfile)
    )
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

export const appSettingsSelectors = {
  viewerDisplayConfig(settings: AppSettingsSchema): ViewerDisplayConfig {
    return settings.documentAppearance;
  },
  themeCssVariables(settings: AppSettingsSchema) {
    return deriveThemeCssVariables(settings.themeProfile);
  }
};
