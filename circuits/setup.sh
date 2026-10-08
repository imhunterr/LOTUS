#!/usr/bin/env bash
# Builds the LOTUS membership circuit end to end:
#   circuit → r1cs/wasm → Powers of Tau → Groth16 zkey → Solidity verifier → browser assets.
#
# Powers of Tau: the public Hermez file is downloaded automatically (or place it at
# circuits/build/powersOfTau28_hez_final_14.ptau yourself); its official blake2b hash is checked.
# If it can't be fetched, a local ceremony is generated, which is fine for demos only.
# Note: a previously generated circuits/build/pot14_final.ptau is replaced only when the Hermez file is present.
set -euo pipefail
cd "$(dirname "$0")/.."
B=circuits/build
SNARKJS="npx snarkjs"
mkdir -p "$B"

npx circom2 circuits/lotus_membership.circom --r1cs --wasm --sym -l node_modules -o "$B"

HEZ_FILE="$B/powersOfTau28_hez_final_14.ptau"
if [ ! -f "$HEZ_FILE" ] && [ -z "${LOTUS_LOCAL_PTAU:-}" ]; then
  echo "Downloading the public Hermez Powers of Tau (18 MB)…"
  for url in https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_14.ptau \
             https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_14.ptau; do
    curl -fsSL -o "$HEZ_FILE.part" "$url" && mv "$HEZ_FILE.part" "$HEZ_FILE" && break
  done
  rm -f "$HEZ_FILE.part"
  [ -f "$HEZ_FILE" ] || echo "Download failed; falling back to a local ceremony (fine for demos only)."
fi

HEZ_B2="eeefbcf7c3803b523c94112023c7ff89558f9b8e0cf5d6cdcba3ade60f168af4a181c9c21774b94fbae6c90411995f7d854d02ebd93fb66043dbb06f17a831c1"
if [ -f "$HEZ_FILE" ]; then
  echo "$HEZ_B2  $HEZ_FILE" | b2sum -c - || { echo "Hermez ptau hash mismatch"; exit 1; }
  cp "$HEZ_FILE" "$B/pot14_final.ptau"
  echo "Using the public Hermez ceremony."
fi

if [ ! -f "$B/pot14_final.ptau" ]; then
  echo "Generating local Powers of Tau (2^14)…"
  $SNARKJS powersoftau new bn128 14 "$B/pot14_0.ptau"
  $SNARKJS powersoftau contribute "$B/pot14_0.ptau" "$B/pot14_1.ptau" --name="LOTUS local" -e="$(head -c 64 /dev/urandom | base64)"
  $SNARKJS powersoftau prepare phase2 "$B/pot14_1.ptau" "$B/pot14_final.ptau"
  rm -f "$B/pot14_0.ptau" "$B/pot14_1.ptau"
fi

$SNARKJS groth16 setup "$B/lotus_membership.r1cs" "$B/pot14_final.ptau" "$B/lotus_0000.zkey"
$SNARKJS zkey contribute "$B/lotus_0000.zkey" "$B/lotus_final.zkey" --name="LOTUS team" -e="$(head -c 64 /dev/urandom | base64)"
$SNARKJS zkey export verificationkey "$B/lotus_final.zkey" "$B/verification_key.json"
$SNARKJS zkey export solidityverifier "$B/lotus_final.zkey" contracts/contracts/privacy/Groth16Verifier.sol
rm -f "$B/lotus_0000.zkey"

# Browser + test assets
mkdir -p apps/web/public/zk
cp "$B/lotus_membership_js/lotus_membership.wasm" "$B/lotus_final.zkey" apps/web/public/zk/
cp "$B/verification_key.json" apps/web/public/zk/
echo "Done. Verifier: contracts/contracts/privacy/Groth16Verifier.sol"
