# SkyTrace V3.2 Free Stack

SkyTrace is a native-style macOS aviation intelligence app built with Electron. V3.2 keeps the existing radar, airport, watchlist, replay, weather, statistics and desktop features while replacing paid-provider dependencies with free/open data sources and local processing.

## Install

```bash
bash <(curl -fsSL "https://raw.githubusercontent.com/archivealf/SkyTrace/main/install")
```

The installer detects Intel (`x64`) or Apple Silicon (`arm64`), verifies prebuilt release checksums when available, installs to `~/Applications/SkyTrace.app`, and can build locally as a fallback. It does not disable Gatekeeper.

## V3.2 data stack

- ADSB.lol: primary live aircraft positions/telemetry
- OpenSky: optional free fallback; OAuth credentials are optional
- OurAirports: airports, runways, frequencies and navaids
- tar1090/Mictronics aircraft database: local registration/type/operator lookup
- ADSBDB: free public metadata/route enrichment fallback
- AviationWeather.gov: METAR, TAF, SIGMET and PIREP/AIREP products
- Open-Meteo: general airport/weather forecasts
- RainViewer: optional radar tiles
- OpenFreeMap + MapLibre: map rendering

No SkyLink or Airframes key is required. No `.env` file is used.

## Timeline, not intercepted messages

The old Messages view is now a telemetry-derived Timeline. It records observable flight events such as detection, airborne/on-ground transitions, altitude thresholds, climb/descent, heading changes and squawk changes. Public PIREP/AIREP and SIGMET products are shown separately. SkyTrace does not pretend these are ACARS messages.

## Configuration

SkyTrace creates:

```text
~/Library/Application Support/SkyTrace/config.json
```

Default configuration:

```json
{
  "server": { "port": 3000 },
  "providers": {
    "live": "adsblol",
    "openSkyFallback": true,
    "adsbdb": true,
    "aviationWeather": true,
    "openMeteo": true,
    "rainViewer": true
  },
  "opensky": {
    "clientId": "",
    "clientSecret": ""
  }
}
```

## Build locally

Requires Node.js 20+ and macOS:

```bash
bash scripts/materialize-v3.2.sh
npm install
npm run data
npm run icon:mac
npm run check
npm run package
```

The app is produced under `out/`.

## GitHub release builds

GitHub Actions builds both:

```text
SkyTrace-mac-arm64.zip
SkyTrace-mac-arm64.dmg
SkyTrace-mac-x64.zip
SkyTrace-mac-x64.dmg
```

The source payload stored under `v3.2-bundle/` is SHA-256 verified before it is materialized for builds. Large aviation reference databases are downloaded during the build rather than committed.

## Security

- API configuration is outside the application bundle and blocked from HTTP serving.
- The desktop backend binds only to `127.0.0.1`.
- Electron `nodeIntegration` is disabled.
- Context isolation, renderer sandboxing and web security are enabled.
- External navigation is opened in the system browser.
