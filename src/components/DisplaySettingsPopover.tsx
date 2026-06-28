import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent
} from "react";

import {
  applyThemeDraft,
  createThemeDraft,
  themeSourceEditorSections,
  updateThemeDraftColor,
  updateThemeDraftDocument,
  updateThemeDraftName,
  type ReaderPreferences,
  type ThemeDefinition,
  type ThemeDraft
} from "../lib/app/settingsRegistry";
import type { UpdateState } from "../lib/app/AppUpdater";

type DisplaySettingsSection = "general" | "themes";

type DisplaySettingsPopoverProps = {
  id: string;
  activeTheme: ThemeDefinition;
  activeThemeId: string;
  automaticUpdates: boolean;
  currentVersion: string;
  readerPreferences: ReaderPreferences;
  readerPreferenceStates?: Partial<
    Record<
      keyof ReaderPreferences,
      {
        checked?: boolean;
        disabled?: boolean;
      }
    >
  >;
  themeList: ThemeDefinition[];
  onCreateTheme: () => void;
  onDeleteTheme: (themeId: string) => void;
  onDuplicateTheme: (themeId: string) => void;
  onPreviewTheme: (themeDefinition: ThemeDefinition | null) => void;
  onSaveThemeDraft: (themeId: string, themeDraft: ThemeDraft) => void;
  onSelectTheme: (themeId: string) => void;
  onToggleReaderPreference: (key: keyof ReaderPreferences) => void;
  onToggleAutomaticUpdates: () => void;
  onCheckForUpdates: () => void;
  onDownloadUpdate: () => void;
  onRestartAndUpdate: () => void;
  onDeferUpdate: () => void;
  onRecoverUpdate: () => void;
  updateState: UpdateState;
  initialSection?: DisplaySettingsSection;
};

const sectionDefinitions: Array<{ key: DisplaySettingsSection; label: string }> = [
  { key: "general", label: "General" },
  { key: "themes", label: "Themes" }
];

const readerPreferenceDefinitions: Array<{
  key: keyof ReaderPreferences;
  label: string;
}> = [
  { key: "fullscreenMode", label: "Fullscreen Mode" },
  { key: "showPageNumbers", label: "Show Page Numbers" },
  { key: "twoPageView", label: "Two-Page View" },
  { key: "verticalScrolling", label: "Vertical Scrolling" },
  { key: "autoHidePageResizer", label: "Auto-Hide Page Resizer" }
];

function ThemePresetCard({
  active,
  theme,
  onSelect
}: {
  active: boolean;
  theme: ThemeDefinition;
  onSelect: () => void;
}) {
  return (
    <button
      className={`display-settings-popover__preset${
        active ? " display-settings-popover__preset--active" : ""
      }`}
      type="button"
      aria-pressed={active}
      onClick={onSelect}
    >
      <span
        className="display-settings-popover__preset-preview"
        style={{
          ["--preset-workspace-color" as string]: theme.source.chrome,
          ["--preset-paper-color" as string]: theme.source.documentPaper,
          ["--preset-ui-text-color" as string]: theme.source.uiText,
          ["--preset-document-text-color" as string]: theme.source.documentInk,
          ["--preset-chrome-color" as string]: theme.source.chrome,
          ["--preset-interactive-color" as string]: theme.source.interactive
        }}
      >
        <span className="display-settings-popover__preset-shell">
          <span className="display-settings-popover__preset-pane display-settings-popover__preset-pane--document">
            <span className="display-settings-popover__preset-lines display-settings-popover__preset-lines--document">
              <span />
              <span />
              <span />
              <span />
            </span>
          </span>
          <span className="display-settings-popover__preset-pane display-settings-popover__preset-pane--notes">
            <span className="display-settings-popover__preset-window-chip" aria-hidden="true" />
            <span className="display-settings-popover__preset-lines display-settings-popover__preset-lines--notes">
              <span />
              <span />
              <span />
            </span>
          </span>
          <span className="display-settings-popover__preset-divider" aria-hidden="true" />
        </span>
        {active ? (
          <span className="display-settings-popover__preset-check" aria-hidden="true" />
        ) : null}
      </span>
      <span className="display-settings-popover__preset-label">{theme.name}</span>
    </button>
  );
}

function UpdateStatus({ state, currentVersion }: { state: UpdateState; currentVersion: string }) {
  let message = `Readr ${currentVersion} is up to date.`;
  if (state.status === "disabled") {
    message = state.reason === "development"
      ? "Updates are unavailable in development builds."
      : "Updates are unavailable in this build.";
  } else if (state.status === "checking") {
    message = "Checking for updates...";
  } else if (state.status === "available") {
    message = `Readr ${state.version} is available.`;
  } else if (state.status === "downloading") {
    message = state.progress === null
      ? `Downloading Readr ${state.version}...`
      : `Downloading Readr ${state.version}: ${Math.round(state.progress * 100)}%.`;
  } else if (state.status === "ready") {
    message = `Readr ${state.version} is ready to install.`;
  } else if (state.status === "installing") {
    message = `Installing Readr ${state.version}...`;
  } else if (state.status === "error") {
    message = state.message;
  }

  return (
    <div className="display-settings-popover__update-status">
      <span className={`display-settings-popover__update-dot display-settings-popover__update-dot--${state.status}`} aria-hidden="true" />
      <span>
        <strong>{message}</strong>
        <small>Current version {currentVersion}</small>
      </span>
    </div>
  );
}

export default function DisplaySettingsPopover({
  id,
  activeTheme,
  activeThemeId,
  automaticUpdates,
  currentVersion,
  readerPreferences,
  readerPreferenceStates,
  themeList,
  onCreateTheme,
  onDeleteTheme,
  onDuplicateTheme,
  onPreviewTheme,
  onSaveThemeDraft,
  onSelectTheme,
  onToggleReaderPreference,
  onToggleAutomaticUpdates,
  onCheckForUpdates,
  onDownloadUpdate,
  onRestartAndUpdate,
  onDeferUpdate,
  onRecoverUpdate,
  updateState,
  initialSection = "general"
}: DisplaySettingsPopoverProps) {
  const [selectedSection, setSelectedSection] =
    useState<DisplaySettingsSection>(initialSection);
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false);
  const [themeDraft, setThemeDraft] = useState<ThemeDraft | null>(() =>
    activeTheme.kind === "custom" ? createThemeDraft(activeTheme) : null
  );
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const scrollbarRef = useRef<HTMLDivElement | null>(null);
  const scrollbarMetricsRef = useRef({
    thumbHeight: 0,
    maxScroll: 0,
    maxThumbTop: 0
  });
  const scrollbarDragRef = useRef<{
    pointerId: number;
    startClientY: number;
    startScrollTop: number;
  } | null>(null);
  const [scrollbarState, setScrollbarState] = useState({
    thumbHeight: 0,
    thumbTop: 0,
    visible: false
  });

  useEffect(() => {
    if (activeTheme.kind === "custom") {
      setThemeDraft(createThemeDraft(activeTheme));
    } else {
      setThemeDraft(null);
    }
  }, [activeTheme]);

  useEffect(() => {
    return () => {
      onPreviewTheme(null);
    };
  }, [onPreviewTheme]);

  const previewTheme = useMemo(() => {
    if (activeTheme.kind !== "custom" || !themeDraft) {
      return null;
    }

    return applyThemeDraft(activeTheme, themeDraft);
  }, [activeTheme, themeDraft]);

  useEffect(() => {
    if (activeTheme.kind !== "custom" || !previewTheme) {
      onPreviewTheme(null);
      return;
    }

    onPreviewTheme(previewTheme);
  }, [activeTheme.kind, onPreviewTheme, previewTheme]);

  const themeDraftDirty =
    activeTheme.kind === "custom" &&
    themeDraft !== null &&
    JSON.stringify(previewTheme) !== JSON.stringify(activeTheme);

  function handleRenameFocus(event: ReactMouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    nameInputRef.current?.focus();
    nameInputRef.current?.select();
  }

  function updatePanelScrollbar() {
    const panelElement = panelRef.current;
    const scrollbarElement = scrollbarRef.current;
    if (!panelElement || !scrollbarElement) {
      return;
    }

    const trackHeight = Math.max(scrollbarElement.clientHeight, 0);
    const maxScroll = Math.max(panelElement.scrollHeight - panelElement.clientHeight, 0);

    if (trackHeight <= 0 || maxScroll <= 0) {
      scrollbarMetricsRef.current = {
        thumbHeight: 0,
        maxScroll: 0,
        maxThumbTop: 0
      };
      setScrollbarState({
        thumbHeight: 0,
        thumbTop: 0,
        visible: false
      });
      return;
    }

    const thumbHeight = Math.max(36, trackHeight * (panelElement.clientHeight / panelElement.scrollHeight));
    const maxThumbTop = Math.max(trackHeight - thumbHeight, 0);
    const thumbTop = maxScroll === 0 ? 0 : (panelElement.scrollTop / maxScroll) * maxThumbTop;

    scrollbarMetricsRef.current = {
      thumbHeight,
      maxScroll,
      maxThumbTop
    };
    setScrollbarState({
      thumbHeight,
      thumbTop,
      visible: true
    });
  }

  function scrollPanelToThumbTop(nextThumbTop: number) {
    const panelElement = panelRef.current;
    const { maxScroll, maxThumbTop } = scrollbarMetricsRef.current;
    if (!panelElement || maxScroll <= 0 || maxThumbTop <= 0) {
      return;
    }

    const clampedThumbTop = Math.max(0, Math.min(nextThumbTop, maxThumbTop));
    panelElement.scrollTop = (clampedThumbTop / maxThumbTop) * maxScroll;
  }

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      updatePanelScrollbar();
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [selectedSection, activeThemeId, themeDraft, readerPreferences, readerPreferenceStates, themeList, updateState, releaseNotesOpen]);

  useEffect(() => {
    const panelElement = panelRef.current;
    if (!panelElement) {
      return;
    }

    const handleResize = () => {
      updatePanelScrollbar();
    };

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            updatePanelScrollbar();
          });

    resizeObserver?.observe(panelElement);
    window.addEventListener("resize", handleResize);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const activeDrag = scrollbarDragRef.current;
      const panelElement = panelRef.current;
      const { maxScroll, maxThumbTop } = scrollbarMetricsRef.current;
      if (!activeDrag || !panelElement || maxScroll <= 0 || maxThumbTop <= 0) {
        return;
      }

      event.preventDefault();
      const deltaY = event.clientY - activeDrag.startClientY;
      const scrollDelta = (deltaY / maxThumbTop) * maxScroll;
      panelElement.scrollTop = activeDrag.startScrollTop + scrollDelta;
      updatePanelScrollbar();
    }

    function handlePointerUp(event: PointerEvent) {
      if (scrollbarDragRef.current?.pointerId !== event.pointerId) {
        return;
      }

      scrollbarDragRef.current = null;
    }

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, []);

  return (
    <div
      id={id}
      className="display-settings-popover"
      role="dialog"
      aria-label="Settings"
      data-no-window-drag
    >
      <div className="display-settings-popover__header">
        <p className="display-settings-popover__title">Settings</p>
      </div>

      <div className="display-settings-popover__layout">
        <div className="display-settings-popover__nav" role="tablist" aria-label="Settings sections">
          {sectionDefinitions.map((sectionDefinition) => (
            <button
              key={sectionDefinition.key}
              className={`display-settings-popover__nav-button${
                selectedSection === sectionDefinition.key
                  ? " display-settings-popover__nav-button--active"
                  : ""
              }`}
              type="button"
              role="tab"
              aria-selected={selectedSection === sectionDefinition.key}
              onClick={() => setSelectedSection(sectionDefinition.key)}
            >
              <span>{sectionDefinition.label}</span>
            </button>
          ))}
        </div>

        <div className="display-settings-popover__content">
          {selectedSection === "general" ? (
            <div className="display-settings-popover__panel-shell">
              <div
                ref={panelRef}
                className="display-settings-popover__panel"
                onScroll={() => {
                  updatePanelScrollbar();
                }}
              >
                <div className="display-settings-popover__section">
                  <p className="display-settings-popover__label">Updates</p>
                  <div className="display-settings-popover__update-card display-settings-popover__update-card--toggle">
                    <span>
                      <strong>Automatic updates</strong>
                      <small>Check for new versions automatically</small>
                    </span>
                    <button
                      className={`display-settings-popover__switch${
                        automaticUpdates ? " display-settings-popover__switch--checked" : ""
                      }`}
                      type="button"
                      role="switch"
                      aria-checked={automaticUpdates}
                      aria-label="Automatic updates"
                      onClick={onToggleAutomaticUpdates}
                    >
                      <span className="display-settings-popover__switch-handle" />
                    </button>
                  </div>

                  <div className="display-settings-popover__update-card" aria-live="polite">
                    <span className="display-settings-popover__update-card-title">Update status</span>
                    <UpdateStatus state={updateState} currentVersion={currentVersion} />
                    {("notes" in updateState && updateState.notes) ? (
                      <>
                        <button
                          className="display-settings-popover__update-link"
                          type="button"
                          aria-expanded={releaseNotesOpen}
                          onClick={() => setReleaseNotesOpen((open) => !open)}
                        >
                          {releaseNotesOpen ? "Hide changes" : "View changes"}
                        </button>
                        {releaseNotesOpen ? (
                          <p className="display-settings-popover__release-notes">
                            {updateState.notes}
                          </p>
                        ) : null}
                      </>
                    ) : null}
                    {updateState.status === "downloading" ? (
                      <progress
                        className="display-settings-popover__update-progress"
                        max={1}
                        value={updateState.progress ?? undefined}
                        aria-label="Update download progress"
                      />
                    ) : null}
                  </div>

                  <div className="display-settings-popover__actions-row display-settings-popover__actions-row--updates">
                    {updateState.status === "available" ? (
                      <button className="display-settings-popover__button display-settings-popover__button--primary" type="button" onClick={onDownloadUpdate}>
                        Download update
                      </button>
                    ) : updateState.status === "ready" ? (
                      <button className="display-settings-popover__button display-settings-popover__button--primary" type="button" onClick={onRestartAndUpdate}>
                        Restart and update
                      </button>
                    ) : updateState.status === "error" ? (
                      <button className="display-settings-popover__button display-settings-popover__button--primary" type="button" onClick={onRecoverUpdate}>
                        {updateState.phase === "check" || updateState.phase === "download"
                          ? "Try again"
                          : "Return to update"}
                      </button>
                    ) : null}
                    <button
                      className="display-settings-popover__button"
                      type="button"
                      disabled={updateState.status === "checking" || updateState.status === "downloading" || updateState.status === "installing" || updateState.status === "disabled"}
                      onClick={updateState.status === "ready" ? onDeferUpdate : onCheckForUpdates}
                    >
                      {updateState.status === "ready" ? "Later" : "Check for updates"}
                    </button>
                  </div>
                  <p className="display-settings-popover__scope-note">Updates are installed after restart.</p>
                </div>

                <div className="display-settings-popover__section">
                  <p className="display-settings-popover__label">Reader Preferences</p>
                  <div className="display-settings-popover__toggles">
                    {readerPreferenceDefinitions.map((definition) => {
                      const checked =
                        readerPreferenceStates?.[definition.key]?.checked ??
                        readerPreferences[definition.key];
                      const disabled =
                        readerPreferenceStates?.[definition.key]?.disabled ?? false;

                      return (
                        <div key={definition.key} className="display-settings-popover__toggle-row">
                          <span className="display-settings-popover__toggle-label">
                            {definition.label}
                          </span>
                          <button
                            className={`display-settings-popover__switch${
                              checked ? " display-settings-popover__switch--checked" : ""
                            }`}
                            type="button"
                            role="switch"
                            aria-checked={checked}
                            aria-label={definition.label}
                            disabled={disabled}
                            onClick={() => onToggleReaderPreference(definition.key)}
                          >
                            <span className="display-settings-popover__switch-handle" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
              <div
                ref={scrollbarRef}
                className={
                  scrollbarState.visible
                    ? "display-settings-popover__scrollbar display-settings-popover__scrollbar--visible"
                    : "display-settings-popover__scrollbar"
                }
                aria-hidden="true"
                onPointerDown={(event) => {
                  const scrollbarElement = scrollbarRef.current;
                  if (!scrollbarElement || event.target !== event.currentTarget) {
                    return;
                  }

                  event.preventDefault();
                  const trackRect = scrollbarElement.getBoundingClientRect();
                  scrollPanelToThumbTop(event.clientY - trackRect.top - scrollbarState.thumbHeight / 2);
                  updatePanelScrollbar();
                }}
              >
                <div
                  className="display-settings-popover__scrollbar-thumb"
                  style={{
                    height: `${scrollbarState.thumbHeight}px`,
                    transform: `translateY(${scrollbarState.thumbTop}px)`
                  }}
                  onPointerDown={(event) => {
                    const panelElement = panelRef.current;
                    if (!panelElement) {
                      return;
                    }

                    event.preventDefault();
                    event.stopPropagation();
                    scrollbarDragRef.current = {
                      pointerId: event.pointerId,
                      startClientY: event.clientY,
                      startScrollTop: panelElement.scrollTop
                    };
                    updatePanelScrollbar();
                  }}
                />
              </div>
            </div>
          ) : (
            <div className="display-settings-popover__panel-shell">
              <div
                ref={panelRef}
                className="display-settings-popover__panel"
                onScroll={() => {
                  updatePanelScrollbar();
                }}
              >
                <div className="display-settings-popover__section display-settings-popover__section--theme-header">
                  <p className="display-settings-popover__label">Active Theme</p>
                  <select
                    className="display-settings-popover__select"
                    aria-label="Active theme"
                    value={activeThemeId}
                    onChange={(event) => {
                      onPreviewTheme(null);
                      onSelectTheme(event.target.value);
                    }}
                  >
                    {themeList.map((themeDefinition) => (
                      <option key={themeDefinition.id} value={themeDefinition.id}>
                        {themeDefinition.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="display-settings-popover__actions-row display-settings-popover__actions-row--compact">
                  <button className="display-settings-popover__button" type="button" onClick={onCreateTheme}>
                    + New
                  </button>
                  <button
                    className="display-settings-popover__button"
                    type="button"
                    onClick={() => onDuplicateTheme(activeTheme.id)}
                  >
                    Duplicate
                  </button>
                  <button
                    className="display-settings-popover__button"
                    type="button"
                    disabled={activeTheme.kind !== "custom"}
                    onClick={handleRenameFocus}
                  >
                    Rename
                  </button>
                  <button
                    className="display-settings-popover__button display-settings-popover__button--icon"
                    type="button"
                    aria-label="Delete theme"
                    disabled={activeTheme.kind !== "custom"}
                    onClick={() => {
                      onPreviewTheme(null);
                      onDeleteTheme(activeTheme.id);
                    }}
                  >
                    Del
                  </button>
                </div>

              <div className="display-settings-popover__section">
                <p className="display-settings-popover__label">Theme Presets</p>
                <div className="display-settings-popover__preset-grid">
                  {themeList.map((themeDefinition) => (
                    <ThemePresetCard
                      key={themeDefinition.id}
                      active={themeDefinition.id === activeThemeId}
                      theme={themeDefinition}
                      onSelect={() => {
                        onPreviewTheme(null);
                        onSelectTheme(themeDefinition.id);
                      }}
                    />
                  ))}
                </div>
              </div>

              {activeTheme.kind === "custom" && themeDraft ? (
                <div className="display-settings-popover__section">
                  <p className="display-settings-popover__label">Theme Name</p>
                  <input
                    ref={nameInputRef}
                    className="display-settings-popover__text-input"
                    type="text"
                    value={themeDraft.name}
                    aria-label="Theme name"
                    onChange={(event) => {
                      setThemeDraft((currentDraft: ThemeDraft | null) =>
                        currentDraft
                          ? updateThemeDraftName(currentDraft, event.target.value)
                          : currentDraft
                      );
                    }}
                  />
                </div>
                ) : null}

                <div className="display-settings-popover__section">
                  <p className="display-settings-popover__label">Theme Colors</p>
                  {themeSourceEditorSections.map((section) => (
                    <div key={section.key} className="display-settings-popover__theme-table">
                      <div className="display-settings-popover__theme-table-header">
                        <span className="display-settings-popover__theme-table-title">
                          {section.label}
                        </span>
                        <span className="display-settings-popover__theme-table-value">Color</span>
                      </div>
                      <div className="display-settings-popover__theme-table-body">
                        {section.definitions.map((definition) => {
                          const colorValue =
                            activeTheme.kind === "custom" && themeDraft
                              ? themeDraft.source[definition.key]
                              : activeTheme.source[definition.key];

                          return (
                            <label
                              key={definition.key}
                              className="display-settings-popover__theme-table-row"
                            >
                              <span className="display-settings-popover__theme-table-label">
                                {definition.label}
                              </span>
                              <input
                                className="display-settings-popover__color-input"
                                type="color"
                                aria-label={`${definition.label} color`}
                                disabled={activeTheme.kind !== "custom"}
                                value={colorValue}
                                onChange={(event) => {
                                  setThemeDraft((currentDraft: ThemeDraft | null) =>
                                    currentDraft
                                      ? updateThemeDraftColor(
                                          currentDraft,
                                          definition.key,
                                          event.target.value
                                        )
                                      : currentDraft
                                  );
                                }}
                              />
                            </label>
                          );
                        })}
                        {section.key === "document" ? (
                          <div className="display-settings-popover__theme-table-row">
                            <span className="display-settings-popover__theme-table-label">
                              Dark document rendering
                            </span>
                            <button
                              className={`display-settings-popover__switch${
                                (themeDraft?.document.surfaceTone ??
                                  activeTheme.document.surfaceTone) === "dark"
                                  ? " display-settings-popover__switch--checked"
                                  : ""
                              }`}
                              type="button"
                              role="switch"
                              aria-checked={
                                (themeDraft?.document.surfaceTone ??
                                  activeTheme.document.surfaceTone) === "dark"
                              }
                              aria-label="Dark document rendering"
                              disabled={activeTheme.kind !== "custom"}
                              onClick={() => {
                                setThemeDraft((currentDraft: ThemeDraft | null) =>
                                  currentDraft
                                    ? updateThemeDraftDocument(currentDraft, {
                                        surfaceTone:
                                          currentDraft.document.surfaceTone === "dark"
                                            ? "light"
                                            : "dark"
                                      })
                                    : currentDraft
                                );
                              }}
                            >
                              <span className="display-settings-popover__switch-handle" />
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>

              <div className="display-settings-popover__section">
                <p className="display-settings-popover__label">Derived Preview</p>
                <div className="display-settings-popover__derived-preview">
                  <span className="display-settings-popover__derived-page-link">Page link</span>
                  <span className="display-settings-popover__derived-selection">Selected text</span>
                  <span className="display-settings-popover__derived-menu-item">Menu item</span>
                  <span className="display-settings-popover__derived-overlay">Overlay</span>
                </div>
              </div>

              {activeTheme.kind === "custom" ? (
                <div className="display-settings-popover__footer">
                  <button
                    className="display-settings-popover__button display-settings-popover__button--ghost"
                    type="button"
                    disabled={!themeDraftDirty}
                    onClick={() => {
                      setThemeDraft(createThemeDraft(activeTheme));
                      onPreviewTheme(null);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    className="display-settings-popover__button display-settings-popover__button--primary"
                    type="button"
                    disabled={!themeDraftDirty || !themeDraft}
                    onClick={() => {
                      if (!themeDraft) {
                        return;
                      }

                      onPreviewTheme(null);
                      onSaveThemeDraft(activeTheme.id, themeDraft);
                    }}
                  >
                    Save
                  </button>
                </div>
                ) : (
                  <p className="display-settings-popover__scope-note">
                    Built-in themes are read-only. Duplicate one to customize it.
                  </p>
                )}
              </div>
              <div
                ref={scrollbarRef}
                className={
                  scrollbarState.visible
                    ? "display-settings-popover__scrollbar display-settings-popover__scrollbar--visible"
                    : "display-settings-popover__scrollbar"
                }
                aria-hidden="true"
                onPointerDown={(event) => {
                  const scrollbarElement = scrollbarRef.current;
                  if (!scrollbarElement || event.target !== event.currentTarget) {
                    return;
                  }

                  event.preventDefault();
                  const trackRect = scrollbarElement.getBoundingClientRect();
                  scrollPanelToThumbTop(event.clientY - trackRect.top - scrollbarState.thumbHeight / 2);
                  updatePanelScrollbar();
                }}
              >
                <div
                  className="display-settings-popover__scrollbar-thumb"
                  style={{
                    height: `${scrollbarState.thumbHeight}px`,
                    transform: `translateY(${scrollbarState.thumbTop}px)`
                  }}
                  onPointerDown={(event) => {
                    const panelElement = panelRef.current;
                    if (!panelElement) {
                      return;
                    }

                    event.preventDefault();
                    event.stopPropagation();
                    scrollbarDragRef.current = {
                      pointerId: event.pointerId,
                      startClientY: event.clientY,
                      startScrollTop: panelElement.scrollTop
                    };
                    updatePanelScrollbar();
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
