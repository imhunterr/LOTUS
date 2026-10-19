#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME="$(realpath -m "${1:-$ROOT/.tooling/firefly/runtime}")"
case "$RUNTIME" in "$ROOT/.tooling/firefly/"*) ;; *) echo 'Runtime must stay inside this project.' >&2;exit 1;;esac
for name in firefly fabconnect1 fabconnect2; do
  pidFile="$RUNTIME/pids/$name"
  [ -f "$pidFile" ] || continue
  pid="$(cat "$pidFile")"; binary=fabconnect; [ "$name" = firefly ] && binary=firefly
  [ "$(readlink -f "/proc/$pid/exe" 2>/dev/null || true)" = "$ROOT/.tooling/firefly/bin/$binary" ] || continue
  kill "$pid"
done
echo 'Stopped only tracked LOTUS FireFly processes; all data retained.'
