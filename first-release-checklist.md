# First Release Checklist

## Locked Decisions

- App display name: `Readr`
- Tauri identifier: `com.xsu.readr`
- Window title: `Readr`
- Production startup view: `collection`
- Single-instance behavior: enabled
- Production support/error logs:
  - `%TEMP%\\readr-support.log`
  - `%TEMP%\\readr-errors.log`
- User PDF library folder: `Documents\\Readr`
- Legacy section-break blocks: removed on normalization and save
- Production builds should not allow side-by-side install identity drift

## Still Open

- Production installer format:
  - Choose one primary Windows installer: `NSIS` or `MSI`
  - Recommendation: `NSIS` unless enterprise deployment specifically needs `MSI`
- Durable frontend settings migration:
  - Some durable settings are still stored in `localStorage`
  - Decide whether first release keeps that temporarily or moves them to backend app-data JSON now
- Support logging activation:
  - Environment variable only
  - Hidden UI/session toggle
  - Both
- Log retention policy:
  - Max size
  - Rotation count
  - Whether support logs are session-only or persistent until disabled
- Release channel policy:
  - Production only
  - Separate beta/dev identifier for coexistence

## Identity And Install

- Confirm `src-tauri/tauri.conf.json`:
  - `productName = Readr`
  - `identifier = com.xsu.readr`
- Confirm Rust binary/package naming:
  - executable name is `Readr`
- Confirm installer output branding uses `Readr`
- Confirm only one production installer type is shipped
- Confirm version increases monotonically
- Confirm no portable production build is distributed
- Confirm uninstall/reinstall preserves intended user data behavior

## Persistence And Data

- Confirm app-data location used for:
  - indexes
  - notes
  - reader state
  - caches
- Confirm PDF library location used for imported PDFs
- Confirm old note formats normalize safely on load/save
- Confirm removal of deprecated structures:
  - legacy section-break blocks are dropped cleanly
- Confirm app startup does not depend on stale workspace restoration for correctness
- Confirm collection view is always the startup entry point

## Logging And Support

- Confirm production default logging mode
- Confirm support logging can be enabled intentionally
- Confirm logs are sanitized:
  - no note contents by default
  - no selected text by default
  - no full user document paths unless explicitly in support mode
- Confirm support/error logs have size bounds or rotation
- Confirm frontend logging does not spam hot render/scroll paths in production

## Reader And Workspace Behavior

- Confirm fullscreen entry/exit behavior is stable
- Confirm book-only and reader workspace both handle:
  - wheel scroll
  - arrow navigation
  - page transitions
  - high zoom
- Confirm auto-max zoom does not exceed intended ceiling
- Confirm search behaviors:
  - top header search works
  - left-rail PDF-name search works
  - search popovers do not disturb layout
- Confirm collection view layout in windowed and fullscreen states

## Notes Editor Safety

- Confirm heading typing/backspace behavior
- Confirm PageLink insertion/edit/remove behavior
- Confirm topic card persistence and editing behavior
- Confirm right-click selection behavior for normal text
- Confirm clipboard actions from keyboard still work
- Confirm old structural corruption paths no longer reproduce

## Release Preflight

- Run frontend tests
- Run critical Rust tests
- Run production build
- Verify installer artifact naming
- Verify app icon and metadata
- Verify no debug-only placeholder or startup flash remains
- Verify no dev logging noise in release build

## Manual Verification

- Clean install
- First launch opens into collection view
- Import PDFs
- Open document into reader
- Open document into book workspace
- Create/edit/save note
- Reopen app and confirm expected persistence
- Test search
- Test fullscreen
- Test uninstall/reinstall expectations
- Test update install over previous production build

## Recommended Release Gate

Ship only if all are true:

- installs as `Readr`
- identifies as `com.xsu.readr`
- opens into collection view on startup
- persists notes and reader state correctly
- high-zoom navigation does not regress
- production logs are bounded and acceptable
- update path does not create duplicate installs