#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PIDFILE="$ROOT/.fabric-network/pids/chaincode"
NODE="$ROOT/.fabric-runtime/node/bin/node"
if [ -f "$PIDFILE" ] && [ "$(readlink -f "/proc/$(cat "$PIDFILE")/exe" 2>/dev/null || true)" = "$NODE" ];then exit 0;fi
UNIT="lotus-chaincode-$(printf '%s' "$ROOT" | sha256sum | cut -c1-12)"
systemctl --user is-system-running >/dev/null || { echo 'A user systemd manager is required. Alternatively run the chaincode node service in a separate terminal.' >&2; exit 1; }
systemd-run --user --unit="$UNIT" --collect --property="WorkingDirectory=$ROOT" --property="StandardOutput=append:$ROOT/.fabric-network/logs/chaincode.log" --property="StandardError=append:$ROOT/.fabric-network/logs/chaincode.log" "$NODE" "$ROOT/chaincode/lotus/server.cjs"
printf '%s' "$UNIT" > "$ROOT/.fabric-network/chaincode-unit"
for attempt in $(seq 1 30);do
  pid="$(systemctl --user show "$UNIT" -p MainPID --value)"
  if [ "$pid" != 0 ];then printf '%s' "$pid" > "$PIDFILE";exit 0;fi
  sleep .1
done
echo 'The chaincode service failed to start.' >&2;exit 1
