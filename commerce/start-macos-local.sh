#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20.18+ is required."
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "OpenSSL is required to generate the local server secret."
  exit 1
fi

if [[ ! -f config.json ]]; then
  cp config.example.json config.json
  PEPPER="$(openssl rand -hex 32)"
  PEPPER="$PEPPER" node - <<'NODE'
const fs = require('fs');
const file = 'config.json';
const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
cfg.security.pepper = process.env.PEPPER;
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
NODE
  chmod 600 config.json
  echo "Created private commerce/config.json with a random security pepper."
  echo "Stripe remains disabled until you add your server-only key and set stripe.enabled=true."
fi

mkdir -p data
chmod 700 data 2>/dev/null || true
chmod 600 config.json 2>/dev/null || true

node --check server.js

echo "Starting SkyTrace Commerce at http://127.0.0.1:8787"
echo "Press Ctrl+C to stop it."
exec node server.js
