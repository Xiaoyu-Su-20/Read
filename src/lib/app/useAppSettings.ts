import { useCallback, useEffect, useRef, useState } from "react";

import { loadAppSettings, saveAppSettings } from "../api";
import type { AppSettingKey, AppSettingsPayload, AppSettingsSchema } from "./settingsRegistry";
import {
  APP_SETTINGS_STORAGE_KEY,
  appSettingsSelectors,
  createDefaultAppSettingsPayload,
  normalizeAppSettings,
  parseStoredAppSettings,
  serializeAppSettingsPayload
} from "./settingsRegistry";

function loadInitialSettingsPayload(): AppSettingsPayload {
  if (typeof window === "undefined") {
    return createDefaultAppSettingsPayload();
  }

  return parseStoredAppSettings(window.localStorage.getItem(APP_SETTINGS_STORAGE_KEY));
}

export function useAppSettings() {
  const [payload, setPayload] = useState<AppSettingsPayload>(() => loadInitialSettingsPayload());
  const [hydrated, setHydrated] = useState(false);
  const latestPayloadRef = useRef(payload);
  const savePromiseRef = useRef<Promise<void>>(Promise.resolve());

  latestPayloadRef.current = payload;

  useEffect(() => {
    let cancelled = false;

    void loadAppSettings()
      .then((storedRawValue) => {
        if (cancelled) {
          return;
        }

        const localRawValue =
          typeof window === "undefined"
            ? null
            : window.localStorage.getItem(APP_SETTINGS_STORAGE_KEY);
        const nextPayload = storedRawValue
          ? parseStoredAppSettings(storedRawValue)
          : parseStoredAppSettings(localRawValue);

        setPayload(nextPayload);
        setHydrated(true);

        if (!storedRawValue && localRawValue) {
          void saveAppSettings(serializeAppSettingsPayload(nextPayload));
        }
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        setPayload(loadInitialSettingsPayload());
        setHydrated(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    savePromiseRef.current = saveAppSettings(serializeAppSettingsPayload(payload));
  }, [hydrated, payload]);

  const flushSettings = useCallback(async () => {
    if (!hydrated) {
      throw new Error("Settings are not ready to save yet.");
    }
    await savePromiseRef.current;
    await saveAppSettings(serializeAppSettingsPayload(latestPayloadRef.current));
  }, [hydrated]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const rootStyle = document.documentElement.style;
    const themeVariables = appSettingsSelectors.themeCssVariables(payload.settings);
    for (const [variableName, variableValue] of Object.entries(themeVariables)) {
      rootStyle.setProperty(variableName, variableValue);
    }
  }, [payload.settings]);

  function setSetting<Key extends AppSettingKey>(
    key: Key,
    value: AppSettingsSchema[Key] | ((currentValue: AppSettingsSchema[Key]) => AppSettingsSchema[Key])
  ) {
    setPayload((currentPayload) => {
      const nextValue =
        typeof value === "function"
          ? (value as (currentValue: AppSettingsSchema[Key]) => AppSettingsSchema[Key])(
              currentPayload.settings[key]
            )
          : value;

      return {
        ...currentPayload,
        settings: normalizeAppSettings({
          ...currentPayload.settings,
          [key]: nextValue
        })
      };
    });
  }

  function updateSettings(
    value:
      | AppSettingsSchema
      | ((currentSettings: AppSettingsSchema) => AppSettingsSchema)
  ) {
    setPayload((currentPayload) => {
      const nextSettings =
        typeof value === "function"
          ? (value as (currentSettings: AppSettingsSchema) => AppSettingsSchema)(
              currentPayload.settings
            )
          : value;

      return {
        ...currentPayload,
        settings: normalizeAppSettings(nextSettings)
      };
    });
  }

  return {
    flushSettings,
    hydrated,
    settings: payload.settings,
    selectors: appSettingsSelectors,
    setSetting,
    updateSettings
  };
}
