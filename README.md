# Swipe Clean

Desktop app for clearing disk space by reviewing files one at a time. Swipe right to keep, left to queue for trash. Nothing moves until you confirm, and confirmed files go to the OS Trash (recoverable on macOS via Put Back).

Built with Tauri 2, React 19, and Rust.

## Development

```bash
npm install
npm run tauri dev
```

## Build locally

```bash
npm run tauri build
```

Installers are written to `src-tauri/target/release/bundle/`.

## Release

1. Bump the version in `src-tauri/tauri.conf.json` and `package.json`.
2. Commit and push to `main`.
3. Tag and push:

```bash
git tag v0.1.0
git push origin v0.1.0
```

GitHub Actions builds macOS, Windows, and Linux installers and attaches them to the release. The site Download button points at the latest release.

### macOS code signing (optional)

For a smooth install without Gatekeeper warnings, add these GitHub repository secrets and rebuild:

- `APPLE_CERTIFICATE` (base64 `.p12`)
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_ID`
- `APPLE_PASSWORD` (app-specific password)
- `APPLE_TEAM_ID`

## Website

Static marketing site lives in `site/`. GitHub Pages deploys it on push to `main` when files under `site/` change.

Local preview:

```bash
cd site && python3 -m http.server 4173
```

Then open http://127.0.0.1:4173
