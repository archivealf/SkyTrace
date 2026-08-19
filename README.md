# SkyTrace V3.3.1 Performance RC

SkyTrace is a native-style macOS aviation intelligence app built with Electron. V3.3.1 adds a major performance pass on top of the V3.3 account, Stripe-backed permanent upgrade and Liquid Glass work.

## Install the current Performance RC

This installer deliberately targets the `v3.3-commerce` branch and refuses to install an unexpected version. It does **not** fall back to `main` or V3.2.

```bash
bash <(curl -fsSL "https://raw.githubusercontent.com/archivealf/SkyTrace/v3.3-commerce/install")
```

The installer builds the correct architecture for the current Mac, applies the public commercial-provider hardening, verifies the V3.3.1 performance identity, replaces an older `~/Applications/SkyTrace.app`, and preserves the user config stored under `~/Library/Application Support/SkyTrace/`.

## Performance work

Performance Mode is enabled by default and includes adaptive aircraft rendering, a live FPS/render-count HUD, reduced live glass blur, lighter animations, debounced search/filter updates, lazy list/stat rendering, bounded trail/event memory, capped dynamic livery images and refresh throttling while the map is moving.

## Data stack

The local/development build can use:

- ADSB.lol: primary live aircraft positions/telemetry
- OpenSky: optional fallback for non-commercial use where its terms permit
- OurAirports: airports, runways, frequencies and navaids
- tar1090/Mictronics aircraft database: local registration/type/operator lookup
- ADSBDB: optional public metadata/route enrichment for local development where upstream terms permit
- AviationWeather.gov: METAR, TAF, SIGMET and PIREP/AIREP products
- Open-Meteo: optional general weather for non-commercial development
- RainViewer: optional radar imagery for non-commercial development
- OpenFreeMap + MapLibre: map rendering

### Public commercial V3.3.1 builds

When `SKYTRACE_COMMERCE_URL` is supplied, the packaged app uses a stricter provider policy:

- ADSB.lol remains the live aircraft source.
- OurAirports, local aircraft reference data, AviationWeather.gov and OpenFreeMap/MapLibre remain available.
- OpenSky REST API use and fallback are disabled unless SkyTrace later obtains the required commercial agreement.
- ADSBDB hosted aircraft/route enrichment is disabled pending suitable written permission/terms for the release use case.
- The Open-Meteo free hosted API is disabled; a future build can use its commercial customer endpoint under a paid plan.
- RainViewer is disabled until commercial integration terms are in place.

These restrictions are enforced at build/runtime rather than relying only on default config, so an older local configuration cannot silently turn the restricted hosted providers back on in a commercial package. See `ATTRIBUTION.md` for the provider/licence record.

No `.env` file is used.

## Timeline, not intercepted messages

The Messages view is a telemetry-derived Timeline. It records observable flight events such as detection, airborne/on-ground transitions, altitude thresholds, climb/descent, heading changes and squawk changes. Public PIREP/AIREP and SIGMET products are shown separately. SkyTrace does not present these as intercepted ACARS messages.

## Configuration

SkyTrace creates:

```text
~/Library/Application Support/SkyTrace/config.json
```

Local/development defaults include optional providers that are automatically restricted in public commercial release builds as described above.

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
