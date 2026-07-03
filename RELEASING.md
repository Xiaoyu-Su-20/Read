# Readr Release Workflow

## Prepare An RC

Commit all product changes on the matching release branch first. The branch for the `0.9.0` line is `release-0.9.0`.

Preview the next release without changing anything:

```powershell
npm run release:prepare:rc:dry
```

Prepare the next RC:

```powershell
npm run release:prepare:rc
```

The command requires a clean matching release branch, increments the RC number, synchronizes npm/Tauri/Cargo versions, runs frontend tests, the production build, Rust tests, and diff checks, then creates a local release commit and annotated tag. It never pushes.

If a check fails, inspect and correct the failure before publishing. The version files remain changed so the failed state is visible.

## Publish

Review the release commit and tag, then preview the pushes:

```powershell
npm run release:publish:dry
```

Publish deliberately:

```powershell
npm run release:publish
```

The command requires a clean worktree, synchronized versions, the matching release branch, and a `v<version>` tag resolving exactly to `HEAD`. It pushes the branch first and the tag second. The tag starts `.github/workflows/release.yml`.

The release workflow:

1. Tests and builds the signed NSIS installer and updater signature.
2. Creates or updates the GitHub Release.
3. Publishes the appropriate GitHub Pages updater manifest.
4. Verifies the manifest version, Windows updater URL, signature, and downloadable asset.
5. Opens or reuses a pull request from the release branch to `main`.

## Recover Publication

If signing succeeded but release or Pages publication failed, run **Republish Existing Signed Release** from GitHub Actions. Supply:

- `tag`: the existing tag, such as `v0.9.0-rc.4`.
- `source_run_id`: the failed Release Readr workflow run containing `signed-nsis-<run-id>`.

Recovery reuses the signed artifact and does not rebuild binaries. It validates the tag, artifact version, installer, and signature before updating the GitHub Release and updater feed, then runs the same feed verification.

## Final Check

After Actions succeeds, launch the previously installed RC and confirm it detects, installs, and relaunches into the new version without losing notes, library data, settings, or reader state.
