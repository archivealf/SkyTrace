# SkyTrace Desktop

SkyTrace is a macOS aviation-intelligence app built with Electron. It wraps the SkyTrace V3 flight radar in a native `.app`, automatically starts its private loopback backend, and stores API configuration outside the application bundle.

## One-line install

```bash
bash <(curl -fsSL "https://raw.githubusercontent.com/archivealf/SkyTrace/main/install")
```

The installer:

- detects Apple Silicon (`arm64`) or Intel (`x64`)
- downloads the matching latest GitHub Release
- verifies the SHA-256 checksum
- installs `SkyTrace.app` to `~/Applications`
- opens the app

It does **not** disable Gatekeeper or change macOS security settings.

## Configuration

On first launch SkyTrace creates:

```text
~/Library/Application Support/SkyTrace/config.json
```

Open it from the native menu with **SkyTrace → Open config.json** (`⌘,`).

Example:

```json
{
  "server": {
    "port": 3000
  },
  "opensky": {
    "clientId": "",
    "clientSecret": ""
  },
  "skylink": {
    "apiKey": ""
  },
  "airframes": {
    "apiKey": "",
    "enabled": true,
    "redactSensitive": true
  }
}
```

No `.env` file is used.

## Development

Requirements:

- Node.js 22+
- macOS for building `.app` / `.dmg`

```bash
npm install
npm run data
npm start
```

## Build a local `.app`

```bash
npm run data
npm run icon:mac
npm run package
```

The `.app` appears under `out/`.

## Build a DMG

```bash
npm run make
```

## GitHub releases

The workflow at `.github/workflows/release-macos.yml` builds:

- `SkyTrace-mac-arm64.zip`
- `SkyTrace-mac-arm64.dmg`
- `SkyTrace-mac-x64.zip`
- `SkyTrace-mac-x64.dmg`

Push a tag such as:

```bash
git tag v3.1.0
git push origin v3.1.0
```

GitHub Actions creates/uploads the release assets automatically.

## Signing

Unsigned builds work for local development but macOS can warn when an app was downloaded from the internet. For public distribution, sign and notarize the app with an Apple Developer identity rather than instructing users to bypass Gatekeeper.

## Data

Large OurAirports reference files are intentionally not committed. `npm run data` downloads current public airport, runway, radio-frequency and navaid data during development/builds.

## Security

- `config.json` is stored outside the app and is not served over HTTP.
- The desktop backend binds only to `127.0.0.1`.
- Electron renderer `nodeIntegration` is disabled.
- Context isolation and renderer sandboxing are enabled.
- External navigation is blocked from the app window and HTTPS links open in the default browser.
