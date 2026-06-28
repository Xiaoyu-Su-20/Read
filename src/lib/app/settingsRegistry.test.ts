import { describe, expect, it } from "vitest";

import {
  APP_SETTINGS_VERSION,
  appSettingsSelectors,
  createDefaultAppSettingsPayload,
  createNewCustomTheme,
  createThemeDraft,
  deleteCustomTheme,
  duplicateTheme,
  migrateAppSettingsPayload,
  normalizeAppSettings,
  parseStoredAppSettings,
  saveCustomThemeDraft
} from "./settingsRegistry";

describe("settingsRegistry", () => {
  it("migrates version 14 settings with automatic updates enabled by default", () => {
    const previous = createDefaultAppSettingsPayload().settings;
    const { automaticUpdates: _automaticUpdates, ...versionFourteenSettings } = previous;

    expect(
      migrateAppSettingsPayload({
        version: 14,
        settings: versionFourteenSettings
      }).settings.automaticUpdates
    ).toBe(true);
  });

  it("creates the default payload with built-in-theme-backed settings", () => {
    expect(createDefaultAppSettingsPayload()).toEqual({
      version: APP_SETTINGS_VERSION,
      settings: {
        automaticUpdates: true,
        readerPaneSplitRatio: 0.42,
        readerPreferences: {
          fullscreenMode: false,
          showPageNumbers: true,
          twoPageView: false,
          verticalScrolling: true,
          autoHidePageResizer: true
        },
        activeThemeId: "builtin-midnight",
        customThemes: expect.any(Array),
        ignoredSpellcheckWords: []
      }
    });
  });

  it("migrates legacy live appearance settings into one active custom theme", () => {
    expect(
      migrateAppSettingsPayload({
        version: 4,
        settings: {
          documentAppearance: {
            mode: "dark",
            useOnePaperColorForBoth: false,
            light: {
              paperColor: "#f7f1e5",
              paperColorSource: "default",
              brightness: 1,
              contrast: 1
            },
            dark: {
              paperColor: "#1f2328",
              paperColorSource: "custom",
              brightness: 0.85,
              contrast: 0.95,
              inversion: 1
            }
          },
          readerPaneSplitRatio: 0.52,
          fullscreenMode: true,
          showPageNumbers: false,
          twoPageView: true,
          verticalScrolling: false,
          themeProfile: {
            chrome: "#151a1f",
            text: "#d7dbdf",
            accent: "#c59354",
            interactive: "#6e7fd8",
            danger: "#b34444"
          }
        }
      })
    ).toEqual({
      version: APP_SETTINGS_VERSION,
      settings: {
        automaticUpdates: true,
        readerPaneSplitRatio: 0.52,
        readerPreferences: {
          fullscreenMode: true,
          showPageNumbers: false,
          twoPageView: true,
          verticalScrolling: false,
          autoHidePageResizer: true
        },
        activeThemeId: "custom-migrated",
        customThemes: expect.arrayContaining([
          {
            id: "custom-migrated",
            name: "Migrated Theme",
            kind: "custom",
            source: {
              chrome: "#151a1f",
              uiText: "#d7dbdf",
              documentPaper: "#1f2328",
              documentInk: "#d7dbdf",
              accent: "#c59354",
              interactive: "#6e7fd8",
              danger: "#b34444"
            },
            document: {
              surfaceTone: "dark"
            }
          }
        ]),
        ignoredSpellcheckWords: []
      }
    });
  });

  it("migrates the current theme payload shape into source colors and drops old filter fields", () => {
    expect(
      migrateAppSettingsPayload({
        version: 5,
        settings: {
          readerPaneSplitRatio: 0.48,
          readerPreferences: {
            fullscreenMode: false,
            showPageNumbers: true,
            twoPageView: false,
            verticalScrolling: true
          },
          activeThemeId: "custom-1",
          customThemes: [
            {
              id: "custom-1",
              name: "Night Ink",
              kind: "custom",
              colors: {
                chrome: "#111",
                paper: "#222",
                text: "#ddd",
                accent: "#c90",
                interactive: "#57f",
                danger: "#c44"
              },
              document: {
                surfaceTone: "dark",
                brightness: 0.88,
                contrast: 1.1,
                inversion: 1
              }
            }
          ]
        }
      })
    ).toEqual({
      version: APP_SETTINGS_VERSION,
      settings: {
        automaticUpdates: true,
        readerPaneSplitRatio: 0.48,
        readerPreferences: {
          fullscreenMode: false,
          showPageNumbers: true,
          twoPageView: false,
          verticalScrolling: true,
          autoHidePageResizer: true
        },
        activeThemeId: "custom-1",
        customThemes: expect.arrayContaining([
          {
            id: "custom-1",
            name: "Night Ink",
            kind: "custom",
            source: {
              chrome: "#111111",
              uiText: "#dddddd",
              documentPaper: "#222222",
              documentInk: "#dddddd",
              accent: "#cc9900",
              interactive: "#5577ff",
              danger: "#cc4444"
            },
            document: {
              surfaceTone: "dark"
            }
          }
        ]),
        ignoredSpellcheckWords: []
      }
    });
  });

  it("drops persisted workspace colors from version-6 custom themes", () => {
    expect(
      migrateAppSettingsPayload({
        version: 6,
        settings: {
          readerPaneSplitRatio: 0.48,
          readerPreferences: {
            fullscreenMode: false,
            showPageNumbers: true,
            twoPageView: false,
            verticalScrolling: true
          },
          activeThemeId: "custom-1",
          customThemes: [
            {
              id: "custom-1",
              name: "Night Ink",
              kind: "custom",
              source: {
                workspace: "#000000",
                chrome: "#111111",
                uiText: "#dddddd",
                documentPaper: "#222222",
                documentInk: "#dddddd",
                accent: "#cc9900",
                interactive: "#5577ff",
                danger: "#cc4444"
              },
              document: {
                surfaceTone: "dark"
              }
            }
          ]
        }
      })
    ).toEqual({
      version: APP_SETTINGS_VERSION,
      settings: {
        automaticUpdates: true,
        readerPaneSplitRatio: 0.48,
        readerPreferences: {
          fullscreenMode: false,
          showPageNumbers: true,
          twoPageView: false,
          verticalScrolling: true,
          autoHidePageResizer: true
        },
        activeThemeId: "custom-1",
        customThemes: expect.arrayContaining([
          {
            id: "custom-1",
            name: "Night Ink",
            kind: "custom",
            source: {
              chrome: "#111111",
              uiText: "#dddddd",
              documentPaper: "#222222",
              documentInk: "#dddddd",
              accent: "#cc9900",
              interactive: "#5577ff",
              danger: "#cc4444"
            },
            document: {
              surfaceTone: "dark"
            }
          }
        ]),
        ignoredSpellcheckWords: []
      }
    });
  });

  it("falls back safely when stored JSON is malformed", () => {
    expect(parseStoredAppSettings("{nope")).toEqual(createDefaultAppSettingsPayload());
  });

  it("migrates the untouched legacy reader split default to the wider notes layout", () => {
    expect(
      migrateAppSettingsPayload({
        version: 7,
        settings: {
          ...createDefaultAppSettingsPayload().settings,
          readerPaneSplitRatio: 0.46
        }
      }).settings.readerPaneSplitRatio
    ).toBe(0.42);
  });

  it("preserves customized reader split ratios during version-7 migration", () => {
    expect(
      migrateAppSettingsPayload({
        version: 7,
        settings: {
          ...createDefaultAppSettingsPayload().settings,
          readerPaneSplitRatio: 0.52
        }
      }).settings.readerPaneSplitRatio
    ).toBe(0.52);
  });

  it("validates each setting and falls back to per-setting defaults", () => {
    expect(
      normalizeAppSettings({
        readerPaneSplitRatio: "nope",
        readerPreferences: {
          fullscreenMode: "yes",
          showPageNumbers: null,
          twoPageView: 1,
          verticalScrolling: undefined
        },
        activeThemeId: "missing-theme",
        customThemes: [
          {
            id: "custom-1",
            name: "",
            kind: "custom",
            source: {
              chrome: "#1a2",
              uiText: "#ABCDEF",
              documentPaper: "#ffeedd",
              documentInk: "#zzz999",
              accent: "#d4aa63",
              interactive: "#zzz999",
              danger: 42
            },
            document: {
              surfaceTone: "sepia"
            }
          }
        ]
      })
    ).toEqual({
      automaticUpdates: true,
      readerPaneSplitRatio: 0.42,
      readerPreferences: {
        fullscreenMode: false,
        showPageNumbers: true,
        twoPageView: false,
        verticalScrolling: true,
        autoHidePageResizer: true
      },
      activeThemeId: "builtin-midnight",
      customThemes: [
        {
          id: "custom-1",
          name: "Custom Theme",
          kind: "custom",
          source: {
            chrome: "#11aa22",
            uiText: "#abcdef",
            documentPaper: "#ffeedd",
            documentInk: "#d8d8d8",
            accent: "#d4aa63",
            interactive: "#7682da",
            danger: "#b34444"
          },
          document: {
            surfaceTone: "dark"
          }
        }
      ],
      ignoredSpellcheckWords: []
    });
  });

  it("returns active-theme-driven viewer config through the typed selector", () => {
    const viewerConfig = appSettingsSelectors.viewerDisplayConfig({
      ...createDefaultAppSettingsPayload().settings,
      activeThemeId: "builtin-sepia"
    });

    expect(viewerConfig).toMatchObject({
      mode: "light",
      paperColor: "#eadcbd",
      inkColor: "#3a2c1d",
      blendMode: "multiply"
    });
    expect(viewerConfig.imageFilter).toBe("none");
  });

  it("returns theme lists and reader preferences through typed selectors", () => {
    const settings = {
      ...createDefaultAppSettingsPayload().settings,
      readerPaneSplitRatio: 0.52,
      readerPreferences: {
        fullscreenMode: true,
        showPageNumbers: false,
        twoPageView: true,
        verticalScrolling: false,
        autoHidePageResizer: true
      },
      customThemes: [
        {
          id: "custom-1",
          name: "Night Ink",
          kind: "custom" as const,
          source: {
            chrome: "#111111",
            uiText: "#dddddd",
            documentPaper: "#1f2328",
            documentInk: "#dddddd",
            accent: "#cc9900",
            interactive: "#5577ff",
            danger: "#cc4444"
          },
          document: {
            surfaceTone: "dark" as const
          }
        }
      ],
      activeThemeId: "custom-1"
    };

    expect(appSettingsSelectors.readerPaneSplitRatio(settings)).toBe(0.52);
    expect(appSettingsSelectors.readerPreferences(settings)).toEqual(settings.readerPreferences);
    expect(appSettingsSelectors.activeTheme(settings).name).toBe("Night Ink");
    expect(appSettingsSelectors.themeList(settings)).toHaveLength(4);
    expect(appSettingsSelectors.themePresetCards(settings)).toHaveLength(4);
    expect(appSettingsSelectors.themeEditorConfig(settings)).toMatchObject({
      canEdit: true,
      canDelete: true
    });
    expect(appSettingsSelectors.themeEditorConfig(settings).sourceSections).toHaveLength(3);
  });

  it("derives theme css variables from the active theme", () => {
    const variables = appSettingsSelectors.themeCssVariables({
      ...createDefaultAppSettingsPayload().settings,
      customThemes: [
        {
          id: "custom-1",
          name: "Warm Paper",
          kind: "custom",
          source: {
            chrome: "#202020",
            uiText: "#efefef",
            documentPaper: "#efe1c3",
            documentInk: "#2e261c",
            accent: "#c08040",
            interactive: "#4466cc",
            danger: "#aa3344"
          },
          document: {
            surfaceTone: "light"
          }
        }
      ],
      activeThemeId: "custom-1"
    });

    expect(variables["--theme-workspace"]).toBe("#202020");
    expect(variables["--theme-document-paper"]).toBe("#efe1c3");
    expect(variables["--theme-interactive"]).toBe("#4466cc");
    expect(variables["--context-menu-surface"]).toMatch(/^#/);
    expect(variables["--page-link-background"]).toContain("rgba(");
    expect(variables["--reader-status-surface"]).toContain("rgba(");
    expect(variables["--rapid-turn-surface"]).toContain("rgba(");
    expect(variables["--search-action-text"]).toContain("rgba(");
    expect(variables["--collection-row-hover"]).toContain("rgba(");
    expect(variables["--collection-tooltip-surface"]).toMatch(/^#/);
  });

  it("creates, duplicates, saves, and deletes custom themes while protecting built-ins", () => {
    const defaults = createDefaultAppSettingsPayload().settings;
    const created = createNewCustomTheme(defaults);
    expect(created.customThemes).toHaveLength(defaults.customThemes.length + 1);
    expect(created.customThemes.some((theme) => theme.id === created.activeThemeId)).toBe(true);

    const duplicated = duplicateTheme(created, "builtin-sepia");
    expect(duplicated.customThemes).toHaveLength(defaults.customThemes.length + 2);

    const customThemeId = duplicated.activeThemeId;
    const duplicatedTheme = duplicated.customThemes.find((theme) => theme.id === customThemeId)!;
    const themeDraft = createThemeDraft(duplicatedTheme);
    themeDraft.name = "Sepia Copy";
    themeDraft.source.documentPaper = "#f0d8b2";

    const saved = saveCustomThemeDraft(duplicated, customThemeId, themeDraft);
    expect(saved.customThemes.find((themeDefinition) => themeDefinition.id === customThemeId))
      .toMatchObject({
        name: "Sepia Copy",
        source: {
          documentPaper: "#f0d8b2"
        }
      });

    expect(deleteCustomTheme(saved, "builtin-midnight")).toEqual(saved);

    const deleted = deleteCustomTheme(saved, customThemeId);
    expect(deleted.customThemes).toHaveLength(defaults.customThemes.length + 1);
    expect(deleted.activeThemeId).toBe("builtin-midnight");
  });
});
