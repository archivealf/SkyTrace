# SkyTrace Changelog

## 3.4.0 RC1 — 2026-08-20

SkyTrace V3.4.0 RC1 is the first release candidate that combines the current desktop, Cloud, Replay, Operations and administration work under one release identity.

### Added

- Cloud Replay+ with multi-aircraft history, timeline playback and CSV/GeoJSON/KML export.
- Operations view with AviationWeather.gov SIGMET, G-AIRMET and PIREP products.
- Advanced Aircraft profiles with observed history and private account notes.
- Airport Ops+ / Airport Intelligence with observed traffic, movement estimates, runway-use estimates, runways and frequencies.
- Synced watchlists, alerts, bookmarks and workspaces.
- Browser-accessible SkyTrace Web using the same account and entitlement backend.
- SQLite WAL commerce storage, private administration, backups, restore tooling and health monitoring.
- Searchable users, account disable/restore, expiring grants, grant revocation and code CSV export.
- Full source-tree and materialized-runtime audit gates in CI.

### Fixed

- Fixed stale Store ownership state after an entitlement is revoked externally.
- Fixed Observed Traffic not rendering inside the airport detail sidebar.
- Removed a document-wide MutationObserver render loop that could freeze the app when opening airports or closing aircraft cards.
- Made aircraft-card close constant-time instead of redrawing the whole aircraft list.
- Moved first aircraft-database loading off the synchronous interaction path.
- Added bounded provider request timeouts for live aircraft, enrichment, general weather and precipitation.
- Bounded Replay+ redraw work and playback stepping.

### Release safeguards

- Public commercial runtime remains restricted to the approved provider stack documented in `ATTRIBUTION.md`.
- CI checks the packaged ASAR for release identity, core V3.4 features and restricted-provider hosts.
- Pull-request builds create Intel and Apple Silicon artifacts but do not publish a public GitHub Release.
- A public GitHub Release requires an explicit version tag; merging `main` alone does not publish one.

### Known limitations

- Replay coverage is community-collected and is not guaranteed to be globally complete.
- Arrival/departure and runway-use values are derived estimates, not licensed schedule truth.
- NOTAMs remain disabled unless an approved official NOTAM feed is configured on the backend.
- RC1 is not Apple-notarized yet.
