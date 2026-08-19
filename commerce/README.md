# SkyTrace Commerce

Account and purchase backend for SkyTrace V3.3.

## Current mode

- Accounts use username + password; no email sender is required.
- Passwords are never stored in plaintext. Each password is hashed with Node's `scrypt`, a unique random salt, and the server-only `security.pepper`.
- Sessions are random tokens; only token hashes are persisted.
- Permanent entitlements are stored server-side in `commerce/data/store.json`.
- Stripe Checkout Sessions are created server-side using the configured SkyTrace Price IDs.
- Redeem codes can grant the same permanent entitlements as Stripe purchases.
- Redeem codes are generated only on the server. Plaintext codes are shown once and only an HMAC hash is stored.
- Codes can be single-use or multi-use, optionally expire, and can be revoked.
- Redemption attempts are rate-limited and a code is not consumed when the account already owns the entitlement.

## Start

Use the package start command so the redeem-code hook is loaded before the commerce server:

```bash
npm start
```

The equivalent direct command is:

```bash
node --import ./redeem-hook.js server.js
```

Verify it with:

```bash
curl http://127.0.0.1:8787/health
```

`config.json` and `data/store.json` are gitignored and must remain server-side.

## Redeem-code manager

Generate five single-use SkyTrace Pro codes:

```bash
node codes.js generate pro 5
```

Generate 20 Themes codes that expire after 30 days:

```bash
node codes.js generate themes 20 --days 30 --label launch-giveaway
```

Generate one shared Pro code that can be redeemed 25 times:

```bash
node codes.js generate pro 1 --uses 25 --label event-code
```

List code records without exposing plaintext codes:

```bash
node codes.js list
```

Revoke a code using its ID or the full code:

```bash
node codes.js revoke code_xxxxxxxxx
```

Available product keys are `pro`, `airport_intelligence`, `advanced_aircraft`, `replay_plus`, and `themes`.

## Public deployment

Keep the commerce process bound to `127.0.0.1` and expose it through the existing HTTPS reverse proxy. Do not expose Stripe secrets, the server pepper, `config.json`, or `data/store.json` to the desktop app or GitHub.
