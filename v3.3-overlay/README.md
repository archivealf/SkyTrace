# SkyTrace V3.4.0 RC1

SkyTrace is an aviation intelligence app with native Electron desktop builds for **macOS and Windows**, plus an installable **iPhone/iPad web app**. V3.4.0 RC1 unifies the current account/commerce system, SkyTrace Cloud, Operations, Replay+, Airport Intelligence, aircraft profiles, web access and runtime-stability work under one release identity.

## macOS

Install the current RC1 branch:

```bash
bash <(curl -fsSL "https://raw.githubusercontent.com/archivealf/SkyTrace/v3.3-commerce/install")
```

The installer detects Intel versus Apple Silicon, uses a temporary verified Node 22 runtime when the Mac's system Node is older, materializes the V3.4 release source, runs commercial-provider and runtime audits, verifies bundle identity and build marker, builds the correct architecture, and preserves user configuration under `~/Library/Application Support/SkyTrace/`.

Normal installer output is intentionally compact. Detailed build output is written to `~/Library/Logs/SkyTrace/installer.log` and is surfaced only when a step fails.

## Windows

SkyTrace now has a native Windows x64 Electron build with Windows-specific window chrome, taskbar identity, a generated multi-size `.ico`, ZIP packaging and a Squirrel `Setup.exe` installer.

The Windows GitHub Actions workflow produces:

- `SkyTrace-3.4.0-RC1-Windows-x64-Setup.exe`
- `SkyTrace-3.4.0-RC1-Windows-x64.zip`
- SHA-256 files for both artifacts

RC1 Windows builds are currently unsigned, so Windows may display its normal warning for an unknown publisher until code signing is added.

## iPhone and iPad

SkyTrace Web at `https://skytrace.duckdns.org/app` is now an installable Home Screen web app. In Safari, open SkyTrace Web, use **Share → Add to Home Screen**, then launch SkyTrace from its Home Screen icon.

The iPhone/iPad version uses the same SkyTrace account and entitlements. It includes the live map, observed aircraft, aircraft profiles, Operations and Replay+. The PWA includes safe-area handling for the notch/home indicator, 44px touch targets, portrait and landscape layouts, an Apple touch icon and a standalone manifest.

The service worker caches only the `/app` shell. Account, authentication and live `/v1` API responses are deliberately not cached.

This is a web app rather than a native App Store binary. A separate native iOS project can be considered later without coupling it to Electron.

The release-candidate branch is still named `v3.3-commerce` for continuity; the application version and packaged release identity are V3.4.0 RC1.

## SkyTrace Cloud

Signed-in accounts can sync aircraft/callsign/registration/type watchlists, Advanced Aircraft alerts, airport/aircraft/map bookmarks and saved map workspaces. Entitlements are refreshed while the app is running so external grants and revocations are reflected without relying on stale Store state.

Alerts are evaluated while SkyTrace is running; RC1 does not claim always-on push notification delivery after the desktop app is closed.

## Cloud Replay+

Replay+ / Pro accounts collect sampled public ADS-B positions into the Commerce SQLite backend while signed-in clients view live traffic. Replay supports multi-aircraft history, timeline playback, altitude/speed visualization and CSV, GeoJSON or KML export.

Coverage is explicitly labelled **community-collected**. It is not guaranteed complete global historical coverage.

## Operations and Airport Intelligence

V3.4 includes AviationWeather.gov SIGMET, G-AIRMET and PIREP products plus Airport Intelligence / Airport Ops+ with live nearby/on-ground traffic, observed Arrivals/Departures, movement estimates, runway-use estimates, traffic profiles, aircraft-type mix, OurAirports runway/frequency data and aviation weather.

Arrival/departure and runway-use values are derived estimates from observed traffic. SkyTrace does not claim licensed schedule or delay truth where no licensed schedule source is configured. NOTAMs remain unavailable unless an approved official feed is configured on the backend.

## Aircraft profiles

Advanced Aircraft / Pro accounts can open richer aircraft profiles with current state, recent observed history, summary statistics and private account notes.

## Store, codes and administration

Stripe permanent purchases remain attached to the SkyTrace username. Redeem codes are generated server-side and stored as hashes. The SQLite/WAL admin tooling supports searchable users, account disable/restore, expiring grants, revocation, code CSV export, audit events, health checks and guarded backups/restores.

## SkyTrace Web

The Commerce backend serves SkyTrace Web at `/app` using the same accounts and entitlements. It includes live traffic, map interaction, aircraft profiles, Operations and Replay+ and is the iPhone/iPad PWA surface.

## Free commercial-use data stack

Public commercial builds use ADSB.lol for live aircraft, Mictronics/tar1090 aircraft reference data, VRS Standing Data via ADSB.lol for route enrichment, MET Norway Locationforecast, NASA GPM IMERG via GIBS, AviationWeather.gov, OurAirports and OpenFreeMap + MapLibre.

OpenSky REST, ADSBDB, Open-Meteo's free hosted endpoint and RainViewer are not included in the commercial runtime. CI verifies those restricted hosts do not survive packaging. See `ATTRIBUTION.md` for provider/licence details.

## Performance and stability

Performance Mode is enabled by default and includes adaptive aircraft rendering, FPS/render telemetry, lighter glass effects, bounded trail/event memory, debounced search/filter work, capped livery caches and refresh throttling while the map moves.

RC1 additionally removes the document-wide observer loop that could freeze airport/aircraft interactions, makes aircraft-card close constant-time, renders observed airport traffic directly in the existing sidebar, asynchronously initializes the large aircraft reference database, bounds provider request timeouts and limits Replay+ redraw work.

## Build locally on macOS

Requires Node.js 22.12+:

```bash
export SKYTRACE_COMMERCE_URL="https://skytrace.duckdns.org"
bash scripts/materialize-v3.4.sh
node scripts/harden-commercial-build.mjs
node scripts/verify-v3.4-release.mjs
node scripts/verify-platform-support.mjs
node scripts/audit-runtime.mjs
npm install
npm run data
npm run icon:mac
npm run check
npm run package
```

## Build locally on Windows x64

Use Node.js 22.12+ and Git Bash for the materializer:

```bash
export SKYTRACE_COMMERCE_URL="https://skytrace.duckdns.org"
bash scripts/materialize-v3.4.sh
node scripts/harden-commercial-build.mjs
node scripts/verify-v3.4-release.mjs
node scripts/verify-platform-support.mjs
npm install --no-audit --no-fund
npm run data
npm run check
npm run make:win
```

GitHub Actions builds macOS Intel x64, macOS Apple Silicon arm64 and Windows x64 artifacts. Pull-request and development-branch builds do not publish a public release. Public release publication requires an explicit version tag.

See `CHANGELOG.md` for RC1 release notes and known limitations.
