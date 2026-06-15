import { useEffect, useState } from "react";

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

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(APP_SETTINGS_STORAGE_KEY, serializeAppSettingsPayload(payload));
  }, [payload]);

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

  return {
    settings: payload.settings,
    selectors: appSettingsSelectors,
    setSetting
  };
}
