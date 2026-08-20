#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
bash "$ROOT/scripts/materialize-v3.3.sh"
node "$ROOT/scripts/optimize-desktop-navigation.mjs"
