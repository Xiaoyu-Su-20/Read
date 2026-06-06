# Reader

A calm, command-first desktop PDF reader built with `Tauri 2`, `React`, `TypeScript`, `Vite`, and `PDF.js`.

The app is designed to keep chrome minimal, favor keyboard-driven interaction, and keep the user-facing library folder clean while app metadata stays private.

## Features

- Minimal full-screen reading shell with custom window chrome
- Filesystem-backed PDF library rooted in a fixed visible documents folder
- Command palette workflow
- Private per-document reading state and bookmarks
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

The `Reader` folder in the user's documents directory is the source of truth for PDFs and folders.

- The visible library root is `<Documents>/Reader`.
- The app creates `<Documents>/Reader/Collections` and `<Documents>/Reader/Inbox` by default.
- The library root contains only user PDFs and folders.
- Reader metadata, indexes, migrated legacy sidecars, and document state live in the app data directory.
- On startup and manual rescan, the app reconciles its private index with the current folder structure.
- Ordinary File Explorer renames and moves are preserved when possible by matching PDFs back to stored fingerprints.

On Windows, private app data typically lives under:

```text
%APPDATA%\com.openai.calmreader\
```

## Notes

- `package-lock.json` should be committed.
- `src-tauri/Cargo.lock` should be committed for this application repo.
- `node_modules/`, `dist/`, and `src-tauri/target/` should not be committed.
