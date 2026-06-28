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
- Primary Windows installer format: `NSIS`
- Support logging activation: both
  - Environment variable support retained
  - Hidden in-app session toggle supported
  - Do not expose as a prominent normal user setting in first release
- Support log retention policy:
  - Persistent while support logging is enabled
  - Max size: `5 MB` per file
  - Rotation count: `5` files
- Release channel policy: separate `rc` and `stable` updater feeds

## Still Open

- Frontend-only persistence cleanup:
  - Core app settings already persist through backend app-data JSON
  - `workspace-session` localStorage is now mainly a low-value restore hint because startup always enters collection view
  - Recommendation: do not block first release on migrating debug/session toggles; optionally remove `workspace-session` persistence if we want less misleading frontend state

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

- App-data location confirmed:
  - library index: `app_dir/library-index.json`
  - notes: `app_dir/notes/*.json` and `app_dir/notes/index.json`
  - reader state: `app_dir/document-states/*.json`
  - caches: `app_dir/rendered-pages` and `app_dir/page-normalization`
- PDF library location confirmed:
  - imported PDFs live under the resolved library root
  - default root: `Documents\\Readr`
  - configurable root persisted in `app_dir/library-root.json`
- Old note formats normalize safely on both load and save
- Deprecated structures removed cleanly:
  - legacy section-break blocks are dropped during normalization/save
  - legacy note spans migrate into inline children
- App startup correctness does not depend on stale workspace restoration
- Collection view is always the startup entry point

## Logging And Support

- Production default logging mode confirmed:
  - production defaults to `errors-only`
  - verbose tracing is default only in dev builds
- Support logging can be enabled intentionally:
  - environment variable: `READR_SUPPORT_LOG=1`
  - hidden in-app session toggle / logging bridge
- Logs are sanitized by default:
  - note contents are redacted by key-based sanitization
  - selected text / selection payloads are redacted by key-based sanitization
  - caution: full user document paths are redacted for `*path*` fields, but error strings may still include paths unless we harden error-message sanitization further
- Support/error logs have size bounds:
  - support log: `5 MB` with rotation count `5`
  - error log: `256 KB` truncate-on-bound
- Frontend logging does not spam hot render/scroll paths in default production mode:
  - trace/debug events are gated behind verbose policy
  - production `errors-only` mode suppresses normal render/scroll tracing unless support logging is intentionally enabled

## In-App Auto-Update

- Current status:
  - updater service and Settings UI are implemented
  - automatic checks default on; download, install, and restart remain user-confirmed
- Plugin wiring:
  - `tauri-plugin-updater` and `tauri-plugin-process` are registered
  - updater artifacts and stable/RC endpoints are configured
- Release infrastructure:
  - GitHub Releases hosts signed NSIS updater artifacts
  - GitHub Pages hosts stable and RC manifests
  - replace the bootstrap public key before RC and configure the matching private key in Actions secrets
- App UX:
  - `Settings → General` exposes automatic and manual checks
  - available version, release notes, download progress, and recoverable errors are shown
  - download and restart/install remain explicit user actions
- First implementation behavior:
  - automatic check after settings hydration and every 24 hours
  - manual checks remain available when automatic checks are disabled
  - no automatic download, install, or restart
- Verification:
  - automated updater, migration, Settings UI, frontend, and Rust tests pass
  - production frontend build and Tauri configuration audit pass
  - signed end-to-end verification remains blocked until the production public key, Actions secrets, and GitHub Pages source are configured
  - verify newer installer is detected from the running app
  - verify install applies over the existing app identity
  - verify notes, indexes, reader state, settings, and library-root config survive update
  - verify downgrade remains blocked

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
