#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UNIT="lotus-chaincode-$(printf '%s' "$ROOT" | sha256sum | cut -c1-12)"
if [ -f "$ROOT/.fabric-network/chaincode-unit" ] && [ "$(cat "$ROOT/.fabric-network/chaincode-unit")" = "$UNIT" ];then
  systemctl --user stop "$UNIT" 2>/dev/null || true
fi
for name in orderer peer1 peer2 chaincode;do
  file="$ROOT/.fabric-network/pids/$name";[ -f "$file" ] || continue;pid="$(cat "$file")"
  if [[ "$pid" =~ ^[0-9]+$ ]] && [ -e "/proc/$pid/exe" ];then
    executable="$(readlink "/proc/$pid/exe")"
    case "$executable" in "$ROOT/.fabric-runtime/fabric/bin/peer"|"$ROOT/.fabric-runtime/fabric/bin/orderer"|"$ROOT/.fabric-runtime/node/bin/node") kill "$pid" ;; *) printf 'Skipped unexpected process %s\n' "$pid" ;; esac
  fi
done
