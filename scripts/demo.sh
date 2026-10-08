#!/usr/bin/env bash
# One command for the full local demo: fresh chain → deploy → seed → relayer → web.
# Ctrl+C stops everything. Re-running gives a clean, freshly seeded demo (the "demo reset").
set -euo pipefail
cd "$(dirname "$0")/.."
LOG=.demo-logs; mkdir -p "$LOG"
pids=()
cleanup() { echo; echo "Stopping…"; kill "${pids[@]}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

(cd contracts && npx hardhat node > "../$LOG/chain.log" 2>&1) & pids+=($!)
printf "Starting local chain"
until curl -s -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' http://127.0.0.1:8545 >/dev/null; do printf "."; sleep 1; done
echo " ok"

npm run deploy:local --silent
npm run demo:seed --silent
npm run demo:stage-fda --silent
(npm run relayer --silent > "$LOG/relayer.log" 2>&1) & pids+=($!)
(npm run web --silent > "$LOG/web.log" 2>&1) & pids+=($!)

echo
echo "LOTUS demo running:"
echo "  Web app   http://localhost:5173"
echo "  Chain     http://127.0.0.1:8545"
echo "  Relayer   http://127.0.0.1:8787"
echo "Logs in $LOG/. Press Ctrl+C to stop."
wait
