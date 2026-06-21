import type { ReactNode } from "react";

export function FullscreenButton({
  fullscreen,
  onToggle
}: {
  fullscreen: boolean;
  onToggle: () => void | Promise<void>;
}) {
  return (
    <button
      className={`notes-header-action notes-header-action--fullscreen${fullscreen ? " notes-header-action--active" : ""}`}
      type="button"
      aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
      aria-pressed={fullscreen}
      onClick={() => {
        void onToggle();
      }}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
        <path d="M9 5.75H5.75V9" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M15 5.75h3.25V9" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M9 18.25H5.75V15" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M15 18.25h3.25V15" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

export default function WorkspaceHeaderTools({
  commandPaletteOpen,
  registerCommandPaletteAnchor,
  onToggleCommandPalette,
  fullscreen,
  onToggleFullscreen,
  leading
}: {
  commandPaletteOpen: boolean;
  registerCommandPaletteAnchor: (node: HTMLButtonElement | null) => void;
  onToggleCommandPalette: () => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void | Promise<void>;
  leading?: ReactNode;
}) {
  return (
    <div className="notes-header-tools">
      {leading ? <div className="notes-header-tools__item">{leading}</div> : null}

      <div className="notes-header-tools__item">
        <button
          ref={registerCommandPaletteAnchor}
          className={`notes-header-action${commandPaletteOpen ? " notes-header-action--active" : ""}`}
          type="button"
          aria-label="Open command palette"
          aria-expanded={commandPaletteOpen}
          onClick={onToggleCommandPalette}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="6.5" cy="12" r="1.4" />
            <circle cx="12" cy="12" r="1.4" />
            <circle cx="17.5" cy="12" r="1.4" />
          </svg>
        </button>
      </div>

      <div className="notes-header-tools__item notes-header-tools__item--fullscreen">
        <FullscreenButton fullscreen={fullscreen} onToggle={onToggleFullscreen} />
      </div>
    </div>
  );
}
