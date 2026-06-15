import type {
  AppSettingsSchema,
  DocumentAppearanceMode
} from "../lib/app/settingsRegistry";
import { themeProfileDefinitions, type ThemeProfileKey } from "../lib/app/themeProfile";

type ToggleSettingKey =
  | "fullscreenMode"
  | "showPageNumbers"
  | "twoPageView"
  | "verticalScrolling";

type DisplaySettingsPopoverProps = {
  controlsDisabled: boolean;
  id: string;
  settings: AppSettingsSchema;
  onChangeDocumentAppearanceMode: (appearance: DocumentAppearanceMode) => void;
  onChangeDocumentPaperColor: (value: string) => void;
  onResetActiveDocumentAppearance: () => void;
  onResetAllDocumentAppearance: () => void;
  onToggleSharedDocumentPaperColor: () => void;
  onChangeThemeColor: (key: ThemeProfileKey, value: string) => void;
  onToggleSetting: (key: ToggleSettingKey) => void;
};

const toggleDefinitions: Array<{ key: ToggleSettingKey; label: string }> = [
  { key: "fullscreenMode", label: "Fullscreen Mode" },
  { key: "showPageNumbers", label: "Show Page Numbers" },
  { key: "twoPageView", label: "Two-Page View" },
  { key: "verticalScrolling", label: "Vertical Scrolling" }
];

export default function DisplaySettingsPopover({
  controlsDisabled,
  id,
  settings,
  onChangeDocumentAppearanceMode,
  onChangeDocumentPaperColor,
  onResetActiveDocumentAppearance,
  onResetAllDocumentAppearance,
  onToggleSharedDocumentPaperColor,
  onChangeThemeColor,
  onToggleSetting
}: DisplaySettingsPopoverProps) {
  const appearanceSettings = settings.documentAppearance;
  const activeAppearanceProfile =
    appearanceSettings.mode === "dark" ? appearanceSettings.dark : appearanceSettings.light;

  return (
    <div
      id={id}
      className="display-settings-popover"
      role="dialog"
      aria-label="Display settings"
      data-no-window-drag
    >
      <p className="display-settings-popover__title">Display Settings</p>

      <div className="display-settings-popover__section">
        <p className="display-settings-popover__label">Document Appearance</p>
        <div className="display-settings-popover__segment" role="group" aria-label="Document appearance">
          <button
            className={`display-settings-popover__segment-button${
              appearanceSettings.mode === "light"
                ? " display-settings-popover__segment-button--active"
                : ""
            }`}
            type="button"
            disabled={controlsDisabled}
            aria-pressed={appearanceSettings.mode === "light"}
            onClick={() => onChangeDocumentAppearanceMode("light")}
          >
            Light
          </button>
          <button
            className={`display-settings-popover__segment-button${
              appearanceSettings.mode === "dark"
                ? " display-settings-popover__segment-button--active"
                : ""
            }`}
            type="button"
            disabled={controlsDisabled}
            aria-pressed={appearanceSettings.mode === "dark"}
            onClick={() => onChangeDocumentAppearanceMode("dark")}
          >
            Dark
          </button>
        </div>

        <div className="display-settings-popover__appearance-control">
          <label className="display-settings-popover__color-row">
            <span className="display-settings-popover__color-label">Paper</span>
            <input
              className="display-settings-popover__color-input"
              type="color"
              aria-label="Paper color"
              disabled={controlsDisabled}
              value={activeAppearanceProfile.paperColor}
              onChange={(event) => onChangeDocumentPaperColor(event.target.value)}
            />
          </label>
          <p className="display-settings-popover__scope-note">
            {`Changes apply to ${appearanceSettings.mode === "dark" ? "Dark" : "Light"} appearance`}
          </p>
          <div className="display-settings-popover__toggle-row display-settings-popover__toggle-row--compact">
            <span className="display-settings-popover__toggle-label">Use one paper color for both appearances</span>
            <button
              className={`display-settings-popover__switch${
                appearanceSettings.useOnePaperColorForBoth
                  ? " display-settings-popover__switch--checked"
                  : ""
              }`}
              type="button"
              role="switch"
              aria-checked={appearanceSettings.useOnePaperColorForBoth}
              aria-label="Use one paper color for both appearances"
              disabled={controlsDisabled}
              onClick={onToggleSharedDocumentPaperColor}
            >
              <span className="display-settings-popover__switch-handle" />
            </button>
          </div>
          <div className="display-settings-popover__actions">
            <button
              className="display-settings-popover__action"
              type="button"
              disabled={controlsDisabled}
              onClick={onResetActiveDocumentAppearance}
            >
              Reset appearance
            </button>
            <button
              className="display-settings-popover__action"
              type="button"
              disabled={controlsDisabled}
              onClick={onResetAllDocumentAppearance}
            >
              Reset all document appearance settings
            </button>
          </div>
        </div>
      </div>

      <div className="display-settings-popover__section">
        <p className="display-settings-popover__label">Theme Colors</p>
        <div className="display-settings-popover__color-grid">
          {themeProfileDefinitions.map((definition) => (
            <label key={definition.key} className="display-settings-popover__color-row">
              <span className="display-settings-popover__color-label">{definition.label}</span>
              <input
                className="display-settings-popover__color-input"
                type="color"
                aria-label={`${definition.label} color`}
                value={settings.themeProfile[definition.key]}
                onChange={(event) => onChangeThemeColor(definition.key, event.target.value)}
              />
            </label>
          ))}
        </div>
      </div>

      <div className="display-settings-popover__toggles">
        {toggleDefinitions.map((definition) => {
          const checked = settings[definition.key];

          return (
            <div key={definition.key} className="display-settings-popover__toggle-row">
              <span className="display-settings-popover__toggle-label">{definition.label}</span>
              <button
                className={`display-settings-popover__switch${checked ? " display-settings-popover__switch--checked" : ""}`}
                type="button"
                role="switch"
                aria-checked={checked}
                aria-label={definition.label}
                disabled={controlsDisabled}
                onClick={() => onToggleSetting(definition.key)}
              >
                <span className="display-settings-popover__switch-handle" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
