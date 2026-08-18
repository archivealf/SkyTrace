# SkyTrace Commerce

Backend for SkyTrace accounts, email OTP login, permanent entitlements and Stripe Checkout.

## Security model

- Stripe secret and webhook secret live only in `commerce/config.json` on the server.
- Brevo API credentials live only in `commerce/config.json` on the server.
- `commerce/config.json` and the local entitlement database are gitignored.
- OTP codes are stored as keyed hashes, never plaintext.
- App sessions are random tokens; only token hashes are persisted server-side.
- Stripe webhooks are signature-verified before entitlements are changed.
- Purchases are idempotent by Checkout Session ID.
- A full Stripe refund revokes the matching purchase entitlement.

## Before production

1. Copy `config.example.json` to `config.json` on the backend VM.
2. Generate `security.pepper` locally, for example with `openssl rand -hex 32`.
3. In Brevo, create an API key and verify a sender address or sending domain. Put the API key only in `mail.brevoApiKey`, set `mail.mode` to `brevo`, and set `mail.senderEmail` to the verified sender. Never commit the key.
4. Put the Stripe secret key in the server-only `config.json`. Do not commit it.
5. Point `skytrace.duckdns.org` to the backend VM and terminate HTTPS with Caddy or another reverse proxy.
6. Create a Stripe webhook for `https://skytrace.duckdns.org/stripe/webhook`, then put its `whsec_...` signing secret in the server-only config.
7. Test OTP login and a Stripe test-mode checkout before enabling live payments.
8. Set `stripe.enabled` to `true` only when you are ready to accept payments.

Brevo mail is sent with the transactional email endpoint `POST /v3/smtp/email`. The API key is sent server-to-server and is never exposed to the SkyTrace desktop app.

The backend listens on loopback by default so only the HTTPS reverse proxy should be internet-facing.
