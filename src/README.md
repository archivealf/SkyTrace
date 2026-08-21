# SkyTrace source layout

V3.5 begins moving new development out of the historical bundle/overlay materialization layers.

- `desktop/` — Electron main-process and preload code for native desktop integration.
- `renderer/` — renderer features and desktop-specific UI surfaces.
- `renderer/settings/` — standalone Settings window.
- `renderer/detached/` — standalone aircraft and Airport Desk windows.
- `build/` — the V3.5 materialization/finalization/verification layer.

The existing V3.2/V3.3/V3.4 materializers are retained for compatibility and to avoid destabilising the proven aviation runtime. `scripts/materialize-v3.5.sh` builds that established base first, then copies the canonical V3.5 files from `src/` and applies the desktop hardening layer.

New V3.5+ Mac-native work should be added under `src/` rather than extending `v3.3-overlay` unless the change genuinely belongs to the legacy shared runtime.
