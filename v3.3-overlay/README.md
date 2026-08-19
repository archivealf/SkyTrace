# SkyTrace V3.3.1 Performance RC

SkyTrace is a macOS aviation intelligence app built with Electron. V3.3.1 combines accounts/permanent upgrades, the free commercial-use data stack, a performance pass and the SkyTrace Cloud feature layer.

## Install the current RC

```bash
bash <(curl -fsSL "https://raw.githubusercontent.com/archivealf/SkyTrace/v3.3-commerce/install")
```

The installer deliberately targets `v3.3-commerce`, verifies V3.3.1 identity/bundle guards and preserves the user config under `~/Library/Application Support/SkyTrace/`.

## SkyTrace Cloud

Signed-in accounts can sync:

- aircraft/callsign/registration/type watchlists;
- Advanced Aircraft live alerts for targets, squawks, emergencies, altitude thresholds and a map-centred area;
- airport, aircraft and map-location bookmarks;
- saved workspaces containing the MapLibre camera plus relevant layer/filter/performance controls.

Alerts are evaluated while SkyTrace is running; they are not presented as an always-on push-notification service when the desktop app is closed.

## Cloud Replay+

Replay+ / Pro accounts collect sampled public ADS-B positions into the Commerce SQLite backend while signed-in clients view live traffic. The Cloud panel can retrieve up to 30 days of collected history, draw tracks on the existing map, show an altitude/speed profile and export CSV, GeoJSON or KML.

Coverage is explicitly labelled **community-collected**. It is not guaranteed complete global historical coverage.

## Airport Intelligence

Airport Intelligence / Pro accounts get a combined operations panel with:

- live nearby / on-ground traffic;
- inbound and outbound **estimates** based on proximity and vertical rate;
- runway-use **estimates** from nearby aircraft headings;
- observed distance/traffic profile and aircraft-type mix;
- OurAirports runway/frequency reference data;
- AviationWeather.gov weather products.

SkyTrace does not invent scheduled-flight delay data. Scheduled arrival/departure/delay truth would require a suitable licensed schedule source, so the current panel labels its derived movement/runway figures as estimates.

## Store and redeem codes

Stripe permanent purchases remain attached to the SkyTrace username. The Store also includes a redeem-code field. Codes are generated server-side, stored as hashes, can be single- or multi-use, can expire, and can be revoked.

## Free commercial-use data stack

Public commercial builds use:

- ADSB.lol — live aircraft positions/telemetry plus bounded stale cache;
- Mictronics/tar1090 aircraft data — registration/type/model/operator reference;
- VRS Standing Data via ADSB.lol — route enrichment;
- MET Norway Locationforecast — general weather;
- NASA GPM IMERG via GIBS — global satellite precipitation layer;
- AviationWeather.gov — METAR, TAF, SIGMET and PIREP/AIREP;
- OurAirports — airports, runways, frequencies and navaids;
- OpenFreeMap + MapLibre — map rendering.

OpenSky REST, ADSBDB, Open-Meteo's free hosted endpoint and RainViewer are not included in the commercial runtime. CI verifies those restricted hosts do not survive packaging. See `ATTRIBUTION.md` for provider/licence details.

## Performance

Performance Mode is enabled by default and includes adaptive aircraft rendering, FPS/render telemetry, lighter glass effects, bounded trail/event memory, debounced search/filter work, capped livery caches and refresh throttling while the map moves.

## Build locally

Requires macOS and Node.js 20.18+:

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

GitHub Actions builds Intel x64 and Apple Silicon arm64 artifacts. Pull-request builds do not publish a public release.
