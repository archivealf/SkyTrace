#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

bash "$ROOT/scripts/materialize-v3.4.sh"
node "$ROOT/src/build/apply-v35.mjs" "$ROOT"

echo "Materialized SkyTrace V3.5 Mac Native (unsigned development build)."
