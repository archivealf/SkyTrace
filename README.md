# SkyTrace V3.3

SkyTrace is a native-style macOS aviation intelligence app built with Electron. V3.3 adds username/password accounts, Stripe-backed permanent upgrades and a public HTTPS commerce service while retaining the radar, airport, watchlist, replay, statistics and desktop features.

## Install

Public release builds are distributed as Intel (`x64`) and Apple Silicon (`arm64`) macOS packages through GitHub Releases.

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

### Public commercial V3.3 builds

When `SKYTRACE_COMMERCE_URL` is supplied by the release workflow, the packaged app deliberately uses a stricter provider policy:

- ADSB.lol remains the live aircraft source.
- OurAirports, local aircraft reference data, AviationWeather.gov and OpenFreeMap/MapLibre remain available.
- OpenSky REST API use and fallback are disabled unless SkyTrace later obtains the required commercial agreement.
- ADSBDB hosted aircraft/route enrichment is disabled pending suitable written permission/terms for the release use case.
- The Open-Meteo free hosted API is disabled; a future build can use its commercial customer endpoint under a paid plan.
- RainViewer is disabled until commercial integration terms are in place.

These restrictions are enforced at build/runtime rather than relying only on the default config, so an older local configuration cannot silently turn the restricted hosted providers back on in a commercial package. See `ATTRIBUTION.md` for the provider/licence record.

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

Requires Node.js 20+ and macOS:

```bash
bash scripts/materialize-v3.3.sh
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

Release builds require the repository variable `SKYTRACE_COMMERCE_URL` to contain the public HTTPS commerce endpoint. Stripe secrets and webhook signing secrets remain server-side and are never embedded in the app.

## Security

- API configuration is outside the application bundle and blocked from HTTP serving.
- The desktop backend binds only to `127.0.0.1`.
- Electron `nodeIntegration` is disabled.
- Context isolation, renderer sandboxing and web security are enabled.
- External navigation is opened in the system browser.
- Public account/payment traffic uses the configured HTTPS SkyTrace Commerce service.
