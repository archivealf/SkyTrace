# SkyTrace Commerce

SkyTrace Commerce is the HTTPS account, entitlement and Cloud backend used by SkyTrace V3.3.1.

## Storage

The service now uses **SQLite in WAL mode** as the authoritative persistent store for accounts, sessions, purchases, redeem codes, synced Cloud items and collected replay history. The existing `data/store.json` account store is imported automatically on the first start through the V3.3 preload. A timestamped `store.json.pre-sqlite-*.bak` copy is kept so the migration is reversible while the deployment is being verified.

The compatibility preload lets the existing proven username/password + Stripe code continue to operate while its account mutations are persisted into SQLite. Do not remove the preload from the systemd service.

Recommended service command:

```text
/usr/local/bin/node --import /home/opc/skytrace-commerce/commerce/redeem-hook.js /home/opc/skytrace-commerce/commerce/server.js
```

## Included services

- Username + password accounts using scrypt, per-user salts and the server-only pepper.
- Hashed bearer sessions.
- Stripe Checkout permanent entitlements and webhook refund handling.
- Redeem codes: single-use by default, optional multi-use, expiry, labels and revocation.
- Synced watchlists, alerts, bookmarks and workspaces.
- Cloud Replay history collected from signed-in SkyTrace clients, retained for 30 days.
- CSV, GeoJSON and KML Replay+ export.
- Private token-protected `/admin` dashboard for users, purchases, codes, manual grants and service statistics.

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

## Private admin dashboard

Show the current server-only admin token locally on the backend host:

```bash
node admin.js show
```

Rotate the token-file version with:

```bash
node admin.js rotate
```

Restart the service after rotation. Keep the token private and do not put it in GitHub, the desktop app or chat logs.

The dashboard is served at `/admin` on the configured Commerce HTTPS domain. The token is retained only in the browser tab's `sessionStorage`.

## Health check

A migrated service reports fields including:

```json
{
  "ok": true,
  "storage": "sqlite-wal",
  "redeemCodes": true,
  "cloudSync": true,
  "cloudReplay": true,
  "admin": true
}
```

## Secrets

`config.json`, the server pepper, Stripe secret key, webhook secret and admin token are server-only. Do not commit or distribute them.
