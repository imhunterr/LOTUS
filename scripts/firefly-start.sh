#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME="$(realpath -m "${1:-$ROOT/.tooling/firefly/runtime}")"
case "$RUNTIME" in "$ROOT/.tooling/firefly/"*) ;; *) echo 'Runtime must stay inside this project.' >&2;exit 1;;esac
PORT="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["http"]["port"])' "$RUNTIME/firefly.json")"
BIN="$ROOT/.tooling/firefly/bin"
mkdir -p "$RUNTIME/logs" "$RUNTIME/pids"
for name in fabconnect1 fabconnect2 firefly; do
  binary=fabconnect; [ "$name" = firefly ] && binary=firefly
  if [ -f "$RUNTIME/pids/$name" ] && [ "$(readlink -f "/proc/$(cat "$RUNTIME/pids/$name")/exe" 2>/dev/null || true)" = "$BIN/$binary" ]; then continue; fi
  if [ "$name" = firefly ];then
    for port in "$((PORT+1))" "$((PORT+2))";do
      for attempt in $(seq 1 30);do curl -fsS "http://127.0.0.1:$port/eventstreams" >/dev/null 2>&1 && break; sleep 1;done
      curl -fsS "http://127.0.0.1:$port/eventstreams" >/dev/null
    done
  fi
  [ -x "$BIN/$binary" ] || { echo 'Run scripts/firefly-build.sh first.' >&2; exit 1; }
  UNIT="lotus-firefly-$name-$(printf '%s' "$RUNTIME" | sha256sum | cut -c1-12)"
  systemd-run --user --unit="$UNIT" --collect --property="WorkingDirectory=$ROOT" --property="StandardOutput=append:$RUNTIME/logs/$name.log" --property="StandardError=append:$RUNTIME/logs/$name.log" "$BIN/$binary" -f "$RUNTIME/$name.json"
  for attempt in $(seq 1 30);do
    pid="$(systemctl --user show "$UNIT" -p MainPID --value)"
    if [ "$pid" != 0 ];then printf '%s' "$pid" > "$RUNTIME/pids/$name";break;fi
    sleep .1
  done
done
for attempt in $(seq 1 30);do curl -fsS "http://127.0.0.1:$PORT/api/v1/namespaces/lotus-org1/status" >/dev/null 2>&1 && break;sleep 1;done
curl -fsS "http://127.0.0.1:$PORT/api/v1/namespaces/lotus-org1/status" >/dev/null
echo "FireFly ready on loopback port $PORT; connector ports $((PORT+1)) and $((PORT+2))."
