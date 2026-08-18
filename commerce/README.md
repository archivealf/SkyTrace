# SkyTrace Commerce

Local account and purchase backend for SkyTrace V3.3.

## Current mode

- Runs on the MacBook at `http://127.0.0.1:8787` by default.
- Accounts use username + password; no email sender is required.
- Passwords are never stored in plaintext. Each password is hashed with Node's `scrypt`, a unique random salt, and the server-only `security.pepper`.
- Sessions are random tokens; only token hashes are persisted.
- Permanent entitlements are stored server-side in `commerce/data/store.json`.
- Stripe Checkout Sessions are created server-side using the existing SkyTrace Price IDs.
- In local mode, SkyTrace can retrieve the Checkout Session from Stripe after payment and verify `payment_status` before granting the entitlement, so a public webhook is not required for development.
- A Stripe webhook is still supported and is recommended before serving customers over the internet, especially so refunds and asynchronous events can be handled automatically.

## Local Mac setup

1. Copy `config.example.json` to `config.json`.
2. Generate a server pepper with `openssl rand -hex 32` and paste it into `security.pepper`.
3. Leave `stripe.enabled` as `false` until you are ready to test Checkout.
4. When ready, put the Stripe secret key in the local `config.json`; never commit it.
5. Run `npm run check`, then `npm start` from this folder.
6. Verify the backend with `curl http://127.0.0.1:8787/health`.

`config.json` and `data/store.json` are gitignored and should remain only on the host Mac.

## Before real public distribution

A backend bound to `127.0.0.1` is reachable only from the same Mac. If other people's SkyTrace apps need to sign in and restore purchases, move this service to a public HTTPS server or deliberately expose the Mac through a secure HTTPS reverse proxy/tunnel. Do not expose the Stripe secret key in the desktop app.
