#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

for file in \
  src/build/apply-v35.mjs \
  src/build/finalize-v35.mjs \
  src/build/fix-v35-audit.mjs \
  src/build/fix-v35-server.mjs \
  src/build/fix-v35-ui.mjs \
  src/build/verify-v35.mjs \
  src/build/verify-v35-ui.mjs; do
  [[ -f "$ROOT/$file" ]] || { echo "Missing V3.5 build module: $file" >&2; exit 1; }
  node --check "$ROOT/$file"
done
bash -n "$ROOT/scripts/materialize-v3.4.sh"

echo "V3.5 build-script preflight passed."

bash "$ROOT/scripts/materialize-v3.4.sh"
node "$ROOT/src/build/apply-v35.mjs" "$ROOT"
node "$ROOT/src/build/finalize-v35.mjs" "$ROOT"
node "$ROOT/src/build/fix-v35-audit.mjs" "$ROOT"
node "$ROOT/src/build/fix-v35-server.mjs" "$ROOT"
node "$ROOT/src/build/fix-v35-ui.mjs" "$ROOT"
node "$ROOT/src/build/verify-v35.mjs" "$ROOT"
node "$ROOT/src/build/verify-v35-ui.mjs" "$ROOT"

echo "Materialized SkyTrace V3.5 Mac Native R3.5 rail-safe UI audited runtime (unsigned development build)."
