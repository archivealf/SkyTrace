# SkyTrace V3.3.1 Performance RC

SkyTrace is a native-style macOS aviation intelligence app built with Electron. V3.3.1 adds a major performance pass on top of the V3.3 account, Stripe-backed permanent upgrade and Liquid Glass work.

## Install the current Performance RC

This installer deliberately targets the `v3.3-commerce` branch and refuses to install an unexpected version. It does **not** fall back to `main` or V3.2.

```bash
bash <(curl -fsSL "https://raw.githubusercontent.com/archivealf/SkyTrace/v3.3-commerce/install")
```

The installer builds the correct architecture for the current Mac, applies the public commercial-provider verification, verifies the V3.3.1 performance identity, replaces an older `~/Applications/SkyTrace.app`, and preserves the user config stored under `~/Library/Application Support/SkyTrace/`.

## Performance work

Performance Mode is enabled by default and includes adaptive aircraft rendering, a live FPS/render-count HUD, reduced live glass blur, lighter animations, debounced search/filter updates, lazy list/stat rendering, bounded trail/event memory, capped dynamic livery images and refresh throttling while the map is moving.

## Free commercial-use data stack

Public commercial V3.3.1 builds use a no-key stack selected for the release use case:

- **ADSB.lol** — primary live aircraft positions/telemetry, with a bounded stale snapshot cache for short upstream outages.
- **Mictronics aircraft database** — registration, type, model and operator reference data. The build refreshes `aircraft.csv.gz` from the tar1090-db CSV mirror.
- **VRS Standing Data via ADSB.lol** — callsign route enrichment.
- **MET Norway Locationforecast 2.0** — global general weather.
- **NASA GPM IMERG via NASA GIBS** — global satellite precipitation-rate map layer. The UI calls this **Precipitation**, not radar, because it is a satellite estimate.
- **AviationWeather.gov** — METAR, TAF, SIGMET and PIREP/AIREP products.
- **OurAirports** — airports, runways, frequencies and navaids.
- **OpenFreeMap + MapLibre** — map rendering.

OpenSky REST, ADSBDB, the Open-Meteo free endpoint and RainViewer are not included in the commercial runtime. CI scans packaged source for those restricted hosts. See `ATTRIBUTION.md` for the provider/licence record and attribution requirements.

No `.env` file is used.

## Timeline, not intercepted messages

The Messages view is a telemetry-derived Timeline. It records observable flight events such as detection, airborne/on-ground transitions, altitude thresholds, climb/descent, heading changes and squawk changes. Public PIREP/AIREP and SIGMET products are shown separately. SkyTrace does not present these as intercepted ACARS messages.

## Configuration

SkyTrace creates:

```text
~/Library/Application Support/SkyTrace/config.json
```

Older configs containing the previous OpenSky/ADSBDB/Open-Meteo/RainViewer provider switches are migrated to the current commercial-safe provider schema. The account service URL remains user-configurable for development and is injected as HTTPS in packaged releases.

## Build locally

Requires Node.js 20.18+ and macOS:

```bash
export SKYTRACE_COMMERCE_URL="https://skytrace.duckdns.org"
bash scripts/materialize-v3.3.sh
node scripts/harden-commercial-build.mjs
node scripts/verify-v3.3-release.mjs
npm install
npm run data
npm run icon:mac
npm run check
npm run package
```

The app is produced under `out/`.

## GitHub CI builds

GitHub Actions builds both Intel (`x64`) and Apple Silicon (`arm64`) ZIP/DMG artifacts. RC pull-request builds do not publish a public release.

## Security

- API configuration is outside the application bundle and blocked from HTTP serving.
- The desktop backend binds only to `127.0.0.1`.
- Electron `nodeIntegration` is disabled.
- Context isolation, renderer sandboxing and web security are enabled.
- External navigation is opened in the system browser.
- Public account/payment traffic uses the configured HTTPS SkyTrace Commerce service.
