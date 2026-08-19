# SkyTrace Commerce

SkyTrace Commerce is the HTTPS account, entitlement, Cloud and V3.4 operations backend used by SkyTrace V3.3.1.

## Storage

The service uses **SQLite in WAL mode** as the authoritative persistent store for accounts, sessions, purchases, redeem codes, synced Cloud items, collected replay history, aircraft notes, manual grants and admin audit events. The existing `data/store.json` account store is imported automatically on first start. A timestamped `store.json.pre-sqlite-*.bak` copy is preserved during migration.

The compatibility preload keeps the proven username/password + Stripe server working while persisting its mutations into SQLite. Keep this preload in the systemd command:

```text
/usr/local/bin/node --import /home/opc/skytrace-commerce/commerce/redeem-hook.js /home/opc/skytrace-commerce/commerce/server.js
```

## Included services

- Username + password accounts using scrypt, per-user salts and a server-only pepper.
- Hashed bearer sessions, account disable/restore and session invalidation.
- Stripe Checkout permanent entitlements and webhook refund handling.
- Redeem codes: single-use by default, optional multi-use, expiry, labels and revocation.
- Synced watchlists, alerts, bookmarks and workspaces.
- Cloud Replay history collected from signed-in SkyTrace clients, retained for 30 days.
- Global/multi-aircraft Replay queries plus CSV, GeoJSON and KML exports.
- V3.4 aircraft profiles with 30-day observed history and private account notes.
- V3.4 Operations feed proxy for AviationWeather.gov SIGMET, G-AIRMET and PIREP products.
- Optional NOTAM integration only when an approved official feed is configured in `operations.notamFeedUrl`; optional credentials remain server-only.
- Browser app at `/app` using the same account and entitlements.
- Main admin dashboard at `/admin` plus V3.4 account/reliability dashboard at `/admin/v34`.
- Searchable users, disable/restore, purchase audit, expiring manual entitlements, code CSV export, SQLite backup/audit and health monitoring.

Cloud Replay is **community-collected coverage**, not a claim of complete worldwide historical coverage. It contains public flight observations submitted by signed-in SkyTrace clients as they view live traffic.

## Redeem codes

The SQLite code manager can run while the service is online:

```bash
node codes.js generate pro 5
node codes.js generate pro 1 --uses 25 --label event
node codes.js generate replay_plus 10 --days 30 --label giveaway
node codes.js list
node codes.js revoke <code-id-or-full-code>
```

Plaintext codes are displayed only when generated. SQLite stores an HMAC hash, not the plaintext code.

## Private admin dashboards

Show the server-only admin token locally on the backend host:

```bash
node admin.js show
```

Rotate the token-file version with:

```bash
node admin.js rotate
```

Restart the service after rotation. Keep the token private and do not put it in GitHub, the desktop app or chat logs. The browser dashboards retain it only in the tab's `sessionStorage`.

## Monitoring and backups

Run a SQLite integrity check, table counts and public HTTPS health check:

```bash
node monitor.js
```

Create backups from `/admin/v34`. List restore points with:

```bash
node restore.js list
```

A restore deliberately requires the commerce service to be stopped and an explicit confirmation flag:

```bash
node restore.js restore <backup-file> --confirm
```

The restore tool first makes a safety copy of the current SQLite database and performs `PRAGMA quick_check` on the selected backup and restored database.

## Optional official NOTAM feed

The example config contains empty placeholders:

```json
{
  "operations": {
    "notamFeedUrl": "",
    "notamBearerToken": ""
  }
}
```

Leave these empty until an approved official NOTAM API feed is available. Never commit API credentials.

## Validation

```bash
npm run check
npm run monitor
```

`npm run check` includes the V3.4 HTTP smoke test for account registration, SQLite status, premium gating, expiring grants, account disable and restore.

## Secrets

`config.json`, the server pepper, Stripe secret key, webhook secret, optional NOTAM credential and admin token are server-only. Do not commit or distribute them.
