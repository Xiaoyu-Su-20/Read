# Reader

A calm, command-first desktop PDF reader built with `Tauri 2`, `React`, `TypeScript`, `Vite`, and `PDF.js`.

The app is designed to keep chrome minimal, favor keyboard-driven interaction, and store imported PDFs in an app-managed local library with per-document sidecar metadata.

## Features

- Minimal full-screen reading shell with custom window chrome
- App-managed local PDF library
- Command palette workflow
- Per-document reading state and bookmarks
- Single-document reading flow
- Local-only, offline-first storage

## Stack

- Frontend: `React`, `TypeScript`, `Vite`
- Desktop shell: `Tauri 2`
- PDF rendering: `pdfjs-dist`
- Backend/storage: `Rust`
- Tests: `Vitest` and Rust unit tests

## Project Structure

```text
.
|-- src/              # React UI, reader shell, command palette, viewer
|-- src-tauri/        # Tauri app, Rust document store, window config
|-- package.json      # Frontend scripts and dependencies
|-- vite.config.ts    # Vite + Vitest config
|-- tsconfig*.json    # TypeScript config
```

## Prerequisites

Windows is the primary target right now.

Install:

- Node.js + npm
- Rust toolchain (`rustup`, `cargo`, `rustc`)
- Visual Studio C++ Build Tools
- Microsoft Edge WebView2 Runtime

## Development

Install dependencies:

```powershell
npm install
```

Run the desktop app in development:

```powershell
npm run tauri:dev
```

Run frontend tests:

```powershell
npm test
```

Run Rust tests:

```powershell
cargo test --manifest-path .\src-tauri\Cargo.toml
```

## Build

Build the desktop app:

```powershell
npm run tauri:build
```

Typical outputs are generated under:

```text
src-tauri/target/release/
src-tauri/target/release/bundle/
```

## Current Interaction Defaults

- `Tab` opens the command palette
- `Left` / `Up` moves to the previous page
- `Right` / `Down` moves to the next page
- Mouse wheel changes pages
- `Ctrl + mouse wheel` zooms

## Storage Model

Imported PDFs are copied into the app data directory and tracked through a local library index plus per-file sidecar state.

On Windows, the library typically lives under:

```text
%APPDATA%\com.openai.calmreader\
```

## Notes

- `package-lock.json` should be committed.
- `src-tauri/Cargo.lock` should be committed for this application repo.
- `node_modules/`, `dist/`, and `src-tauri/target/` should not be committed.
