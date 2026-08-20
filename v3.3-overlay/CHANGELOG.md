# SkyTrace Changelog

## 3.4.0 RC1 — 2026-08-20

SkyTrace V3.4.0 RC1 is the first release candidate that combines the current desktop, Cloud, Replay, Operations, administration and multi-platform work under one release identity.

### Added

- Native Windows x64 desktop packaging with Windows window chrome, taskbar identity, multi-size SkyTrace icon, ZIP artifact and Squirrel `Setup.exe` installer.
- Cross-platform desktop syntax verification that runs identically on macOS and Windows.
- Installable iPhone/iPad SkyTrace Web PWA with standalone manifest, Apple Home Screen icon, safe-area support and touch-first responsive layout.
- PWA service worker that caches only the `/app` shell and deliberately excludes authentication/live `/v1` API traffic.
- Cloud Replay+ with multi-aircraft history, timeline playback and CSV/GeoJSON/KML export.
- Operations view with AviationWeather.gov SIGMET, G-AIRMET and PIREP products.
- Advanced Aircraft profiles with observed history and private account notes.
- Airport Ops+ / Airport Intelligence with observed traffic, movement estimates, runway-use estimates, runways and frequencies.
- Synced watchlists, alerts, bookmarks and workspaces.
- Browser-accessible SkyTrace Web using the same account and entitlement backend.
- SQLite WAL commerce storage, private administration, backups, restore tooling and health monitoring.
- Searchable users, account disable/restore, expiring grants, grant revocation and code CSV export.
- Full source-tree, materialized-runtime and platform-support audit gates in CI.

### Fixed

- Fixed stale Store ownership state after an entitlement is revoked externally.
- Fixed Observed Traffic not rendering inside the airport detail sidebar.
- Removed a document-wide MutationObserver render loop that could freeze the app when opening airports or closing aircraft cards.
- Made aircraft-card close constant-time instead of redrawing the whole aircraft list.
- Moved first aircraft-database loading off the synchronous interaction path.
- Added bounded provider request timeouts for live aircraft, enrichment, general weather and precipitation.
- Bounded Replay+ redraw work and playback stepping.
- Removed Unix-only syntax from the desktop runtime check and base-bundle checksum path so Windows CI can use the same release materializer.
- Reworked SkyTrace Web proportions across iPhone portrait, short/narrow iPhones, iPhone landscape and iPad instead of relying on one fixed mobile sheet size.
- Added VisualViewport and measured-panel sizing so the iOS keyboard, rotation, Safari chrome and MapLibre controls remain aligned with the visible app area.
- Corrected the Apple Home Screen icon to a full-bleed 180×180 asset and hardened CI against transparent/inset icon regressions.
- Cached the dedicated iPhone/iPad proportion stylesheet in the PWA app shell so installed/offline launches retain the mobile layout.

### Release safeguards

- Public commercial runtime remains restricted to the approved provider stack documented in `ATTRIBUTION.md`.
- CI checks packaged desktop payloads for release identity, core V3.4 features and restricted-provider hosts.
- Development and pull-request builds create test artifacts but do not publish a public GitHub Release.
- A public GitHub Release requires an explicit version tag; merging `main` alone does not publish one.
- The iOS/PWA service worker never caches account, authentication or live aviation API responses.

### Known limitations

- Replay coverage is community-collected and is not guaranteed to be globally complete.
- Arrival/departure and runway-use values are derived estimates, not licensed schedule truth.
- NOTAMs remain disabled unless an approved official NOTAM feed is configured on the backend.
- RC1 macOS builds are not Apple-notarized yet.
- RC1 Windows installers are not code-signed yet and may show an unknown-publisher warning.
- iPhone/iPad support is a Home Screen PWA, not a native App Store binary.
