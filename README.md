# Take out the Trash

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
git tag v0.1.1
git push origin v0.1.1
```

GitHub Actions builds macOS, Windows, and Linux installers and attaches them to the release. The site Download button points at the latest release.

## macOS code signing and notarization

Required so Mac users do not see the “Apple could not verify…” Gatekeeper dialog.

### 1. Create a Developer ID Application certificate

On your Mac:

1. Open **Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority…**
2. Enter your Apple ID email, choose **Saved to disk**, save the `.certSigningRequest`.
3. Go to [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/certificates/list).
4. Create a certificate → type **Developer ID Application** (not Apple Development).
5. Upload the CSR, download the `.cer`, double-click to install it into your login keychain.

### 2. Export the certificate for CI

1. In Keychain Access → **My Certificates**, find **Developer ID Application: …**
2. Expand it, right-click the private key → **Export…** → save a `.p12` with a password.
3. Convert it for GitHub:

```bash
chmod +x scripts/export-apple-certificate.sh
./scripts/export-apple-certificate.sh /path/to/certificate.p12
```

### 3. Create an app-specific password

1. Visit [appleid.apple.com](https://appleid.apple.com) → **Sign-In and Security** → **App-Specific Passwords**.
2. Generate one named e.g. `TakeOutTheTrash CI`.

### 4. Add GitHub repository secrets

In the repo: **Settings → Secrets and variables → Actions**, add:

| Secret | Value |
|---|---|
| `APPLE_CERTIFICATE` | base64 string from the export script |
| `APPLE_CERTIFICATE_PASSWORD` | password used when exporting the `.p12` |
| `KEYCHAIN_PASSWORD` | any strong random password (only used on the CI runner) |
| `APPLE_ID` | your Apple ID email |
| `APPLE_PASSWORD` | the app-specific password (not your normal Apple ID password) |
| `APPLE_TEAM_ID` | 10-character Team ID from Membership details |

### 5. Ship a signed build

```bash
git tag v0.1.1
git push origin v0.1.1
```

When the Release workflow finishes, the new `.dmg` should open without the malware warning.

## Website

Static marketing site lives in `site/`. GitHub Pages deploys it on push to `main` when files under `site/` change.

Local preview:

```bash
cd site && python3 -m http.server 4173
```

Then open http://127.0.0.1:4173
