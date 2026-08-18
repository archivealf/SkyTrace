# SkyTrace Commerce

Backend for SkyTrace accounts, email OTP login, permanent entitlements and Stripe Checkout.

## Security model

- Stripe secret and webhook secret live only in `commerce/config.json` on the server.
- `commerce/config.json` and the local entitlement database are gitignored.
- OTP codes are stored as keyed hashes, never plaintext.
- App sessions are random tokens; only token hashes are persisted server-side.
- Stripe webhooks are signature-verified before entitlements are changed.
- Purchases are idempotent by Checkout Session ID.
- A full Stripe refund revokes the matching purchase entitlement.

## Before production

1. Copy `config.example.json` to `config.json` on the backend server.
2. Generate `security.pepper` locally, e.g. `openssl rand -hex 32`.
3. Configure a transactional email sender. The included implementation supports Resend; `mail.mode: console` is only for local testing.
4. Put your Stripe secret key in the server-only `config.json`. Do not commit it.
5. Point `skytrace.duckdns.org` to the backend server and terminate HTTPS with Caddy or another reverse proxy.
6. Create a Stripe webhook for `https://skytrace.duckdns.org/stripe/webhook`, then put its `whsec_...` signing secret in the server-only config.
7. Set `stripe.enabled` to `true` only when you are ready to accept payments.

The backend listens on loopback by default so only the HTTPS reverse proxy should be internet-facing.
