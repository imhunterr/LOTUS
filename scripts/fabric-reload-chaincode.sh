#!/usr/bin/env bash
# Local integration only. Production changes require governed chaincode lifecycle approval.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PIDFILE="$ROOT/.fabric-network/pids/chaincode"
if [ -f "$PIDFILE" ]; then
  pid="$(cat "$PIDFILE")"
  if [ "$(readlink -f "/proc/$pid/exe" 2>/dev/null || true)" = "$ROOT/.fabric-runtime/node/bin/node" ];then kill "$pid"; fi
fi
UNIT="lotus-chaincode-$(printf '%s' "$ROOT" | sha256sum | cut -c1-12)"
systemctl --user stop "$UNIT" 2>/dev/null || true
for attempt in $(seq 1 30);do [ ! -e "/proc/${pid:-0}/exe" ] && break;sleep .1;done
bash "$ROOT/scripts/fabric-chaincode-start.sh"
echo 'Local chaincode service reloading; wait for port 9999 before submitting.'
