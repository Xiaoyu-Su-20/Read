import { describe, expect, it } from "vitest";

import {
  APP_SETTINGS_VERSION,
  appSettingsSelectors,
  createDefaultAppSettingsPayload,
  migrateAppSettingsPayload,
  normalizeAppSettings,
  parseStoredAppSettings,
  resetActiveDocumentAppearanceProfile,
  toggleSharedDocumentAppearancePaper,
  updateDocumentAppearancePaperColor
} from "./settingsRegistry";

describe("settingsRegistry", () => {
  it("creates the default payload with the current version", () => {
    expect(createDefaultAppSettingsPayload()).toEqual({
      version: APP_SETTINGS_VERSION,
      settings: {
        documentAppearance: {
          mode: "light",
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
      }
    });
  });

  it("migrates the old global paper color into the light appearance profile only", () => {
    expect(
      migrateAppSettingsPayload({
        version: 2,
        settings: {
          documentAppearance: "dark",
          fullscreenMode: true,
          themeProfile: {
            workspace: "#13191e",
            chrome: "#13191e",
            paper: "#ff0000",
            text: "#d8d8d8",
            accent: "#d4aa63",
            interactive: "#7682da",
            danger: "#b34444"
          }
        }
      })
    ).toEqual({
      version: APP_SETTINGS_VERSION,
      settings: {
        documentAppearance: {
          mode: "dark",
          useOnePaperColorForBoth: false,
          light: {
            paperColor: "#ff0000",
            paperColorSource: "custom",
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
        fullscreenMode: true,
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
      }
    });
  });

  it("drops unknown keys while normalizing known values", () => {
    expect(
      migrateAppSettingsPayload({
        version: APP_SETTINGS_VERSION,
        settings: {
          documentAppearance: {
            mode: "dark",
            useOnePaperColorForBoth: false,
            light: {
              paperColor: "#abc",
              paperColorSource: "custom",
              brightness: 1,
              contrast: 1
            },
            dark: {
              paperColor: "#101010",
              paperColorSource: "custom",
              brightness: 0.8,
              contrast: 1.2,
              inversion: 1
            },
            foo: "bar"
          },
          fullscreenMode: true,
          showPageNumbers: false,
          twoPageView: true,
          verticalScrolling: false,
          themeProfile: {
            workspace: "#000",
            chrome: "#13191e",
            text: "#d8d8d8",
            accent: "#d4aa63",
            interactive: "#7682da",
            danger: "#b34444"
          },
          appTheme: "midnight"
        }
      })
    ).toEqual({
      version: APP_SETTINGS_VERSION,
      settings: {
        documentAppearance: {
          mode: "dark",
          useOnePaperColorForBoth: false,
          light: {
            paperColor: "#aabbcc",
            paperColorSource: "custom",
            brightness: 1,
            contrast: 1
          },
          dark: {
            paperColor: "#101010",
            paperColorSource: "custom",
            brightness: 0.8,
            contrast: 1.2,
            inversion: 1
          }
        },
        fullscreenMode: true,
        showPageNumbers: false,
        twoPageView: true,
        verticalScrolling: false,
        themeProfile: {
          workspace: "#000000",
          chrome: "#13191e",
          text: "#d8d8d8",
          accent: "#d4aa63",
          interactive: "#7682da",
          danger: "#b34444"
        }
      }
    });
  });

  it("falls back safely when stored JSON is malformed", () => {
    expect(parseStoredAppSettings("{nope")).toEqual(createDefaultAppSettingsPayload());
  });

  it("validates each setting and falls back to per-setting defaults", () => {
    expect(
      normalizeAppSettings({
        documentAppearance: {
          mode: "sepia",
          useOnePaperColorForBoth: "yes",
          light: {
            paperColor: "#12345z",
            paperColorSource: "manual",
            brightness: 9,
            contrast: null
          },
          dark: {
            paperColor: "#111",
            paperColorSource: "custom",
            brightness: 0.5,
            contrast: 3,
            inversion: -1
          }
        },
        fullscreenMode: "yes",
        showPageNumbers: null,
        twoPageView: 1,
        verticalScrolling: undefined,
        themeProfile: {
          workspace: "#12345z",
          chrome: "#1a2",
          text: "#ABCDEF",
          accent: "#d4aa63",
          interactive: "#zzz999",
          danger: 42
        }
      })
    ).toEqual({
      documentAppearance: {
        mode: "light",
        useOnePaperColorForBoth: false,
        light: {
          paperColor: "#c8c2b8",
          paperColorSource: "default",
          brightness: 2,
          contrast: 1
        },
        dark: {
          paperColor: "#111111",
          paperColorSource: "custom",
          brightness: 0.5,
          contrast: 2,
          inversion: 0
        }
      },
      fullscreenMode: false,
      showPageNumbers: true,
      twoPageView: false,
      verticalScrolling: true,
      themeProfile: {
        workspace: "#13191e",
        chrome: "#11aa22",
        text: "#abcdef",
        accent: "#d4aa63",
        interactive: "#7682da",
        danger: "#b34444"
      }
    });
  });

  it("returns the full viewer display config through the typed selector", () => {
    expect(
      appSettingsSelectors.viewerDisplayConfig({
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
        fullscreenMode: true,
        showPageNumbers: false,
        twoPageView: true,
        verticalScrolling: false,
        themeProfile: {
          workspace: "#13191e",
          chrome: "#13191e",
          text: "#d8d8d8",
          accent: "#d4aa63",
          interactive: "#7682da",
          danger: "#b34444"
        }
      })
    ).toEqual({
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
    });
  });

  it("keeps shared paper colors synchronized when the active profile changes", () => {
    const shared = toggleSharedDocumentAppearancePaper({
      mode: "dark",
      useOnePaperColorForBoth: false,
      light: {
        paperColor: "#c8c2b8",
        paperColorSource: "default",
        brightness: 1,
        contrast: 1
      },
      dark: {
        paperColor: "#14181d",
        paperColorSource: "custom",
        brightness: 0.9,
        contrast: 0.92,
        inversion: 1
      }
    });

    expect(
      updateDocumentAppearancePaperColor(shared, "#330000")
    ).toMatchObject({
      light: {
        paperColor: "#330000",
        paperColorSource: "custom"
      },
      dark: {
        paperColor: "#330000",
        paperColorSource: "custom"
      }
    });
  });

  it("resets only the active appearance profile by default", () => {
    expect(
      resetActiveDocumentAppearanceProfile({
        mode: "dark",
        useOnePaperColorForBoth: false,
        light: {
          paperColor: "#ff0000",
          paperColorSource: "custom",
          brightness: 1.1,
          contrast: 1
        },
        dark: {
          paperColor: "#000000",
          paperColorSource: "custom",
          brightness: 0.4,
          contrast: 1.3,
          inversion: 0.2
        }
      })
    ).toEqual({
      mode: "dark",
      useOnePaperColorForBoth: false,
      light: {
        paperColor: "#ff0000",
        paperColorSource: "custom",
        brightness: 1.1,
        contrast: 1
      },
      dark: {
        paperColor: "#20242a",
        paperColorSource: "default",
        brightness: 0.9,
        contrast: 0.92,
        inversion: 1
      }
    });
  });

  it("derives theme css variables from the grouped theme profile", () => {
    const variables = appSettingsSelectors.themeCssVariables({
      documentAppearance: createDefaultAppSettingsPayload().settings.documentAppearance,
      fullscreenMode: false,
      showPageNumbers: true,
      twoPageView: false,
      verticalScrolling: true,
      themeProfile: {
        workspace: "#101010",
        chrome: "#202020",
        text: "#efefef",
        accent: "#c08040",
        interactive: "#4466cc",
        danger: "#aa3344"
      }
    });

    expect(variables["--theme-workspace"]).toBe("#101010");
    expect(variables["--theme-interactive"]).toBe("#4466cc");
    expect(variables["--chrome-surface"]).toContain("rgba(");
    expect(variables["--panel"]).toContain("rgba(");
  });
});
