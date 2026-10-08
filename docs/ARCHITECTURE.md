# Architecture

## Layers

1. **Smart contracts (Solidity 0.8.24, OpenZeppelin)**: the source of truth for custody, permits,
   dispenses, recalls and anonymous signals.
2. **Off-chain services**: IPFS for certificates of analysis, manifests and report text (only hashes go
   on-chain); the patient's device holds the secret (PIN-encrypted); a stateless gas relayer.
3. **Data plane**: openFDA NDC directory and enforcement events; synthetic cohorts (built-in or Synthea).
4. **Presentation**: React dashboards per role, patient PWA, public verification page.

## Core flow

```
Manufacturer ──registerLot──▶ BatchRegistry ──mint──▶ CustodyLedger (manufacturer on-hand)
Manufacturer ──ship──▶ Distributor ──accept──▶ … ──ship──▶ Pharmacy ──accept──▶ inbound += qty
Prescriber   ──issue(holderCommit, ndc, qty)──▶ PrescriptionRegistry
Patient app  ──QR {permitId, permitSecret, commitment_i}──▶ Pharmacy
Pharmacy     ──dispense──▶ DispenseLedger
                 ├─ PrescriptionRegistry.redeem      (I3)
                 ├─ CustodyLedger.recordDispense     (I1, I2)
                 ├─ commitment unique                (I4)
                 └─ insert commitment into the lot's Poseidon Merkle tree; emit Dispensed
Regulator    ──issueRecall(lot)──▶ RecallRegistry ──▶ RecallIssued; lot can no longer be dispensed
Patient app  ──reads Dispensed + RecallIssued, recomputes commitment_0..n locally──▶ "affected?"
Patient app  ──ZK proof via relayer──▶ AnonymousSignals.acknowledgeRecall / reportAdverseEvent
```

## Patient cryptography

```
patientSecret  : random field element, only on the device (+ 2-of-3 Guardian shares)
nonce_i        = Poseidon(secret, i)
commitment_i   = Poseidon(secret, nonce_i)          ← the only thing the pharmacy sees
nullifier      = Poseidon(secret, externalNullifier) ← one report per lot, one ack per recall
```

The pharmacy never sees the secret. After recovery the device re-derives every commitment by scanning
`i = 0, 1, 2, …` until 20 consecutive misses (same idea as HD-wallet address discovery).

## Zero-knowledge proof (circuits/lotus_membership.circom)

Public: `root, nullifierHash, externalNullifier, signalHash`. Private: `secret, index, depth, Merkle path`.
About 9,900 constraints; a proof takes about 1 s in Node and a few seconds on a phone.
It proves that the patient's commitment is in the lot's tree and that the nullifier is derived from the same
secret, without revealing which leaf. The contract checks the root is one of the lot's last 32 roots.

## Measured gas (Hardhat, optimizer 200 runs; `npm run bench:gas -w contracts`)

| Operation | Gas |
|---|---|
| registerLot | 224k |
| ship / accept | 177k / 88k |
| issue permit | 145k |
| **dispense** (lot growing to 1,024 dispenses) | **mean 373k** (250k–520k) |
| issueRecall | 167k |
| reportAdverseEvent / acknowledgeRecall with a real Groth16 proof | ≈ 317k / ≈ 333k |

The per-lot tree is a lean incremental Merkle tree: an insert hashes only at levels where a sibling
exists, so it costs popcount(index) Poseidon hashes instead of a fixed 16. That cut the mean dispense cost
from 933k to 373k gas. `dispenseBatch` records up to 50 dispenses in one transaction (timing privacy).

## Threat model

See [`THREAT_MODEL.md`](THREAT_MODEL.md) for adversaries, the ten attacks tested, and residual risks.
