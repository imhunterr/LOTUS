# Architecture

## Layers

1. **Smart contracts (Solidity 0.8.24, OpenZeppelin)**: the source of truth for custody, permits,
   dispenses, recalls and anonymous signals.
2. **Off-chain services**: IPFS for certificates of analysis, manifests and report text (only hashes go
   on-chain); the patient's device holds the secret; a stateless gas relayer.
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

Public: `root, nullifierHash, externalNullifier, signalHash`. Private: `secret, index, Merkle path`.
It proves that the patient's commitment is in the lot's tree and that the nullifier is derived from the same
secret, without revealing which leaf. The contract checks the root is one of the lot's last 32 roots.

## Measured gas (Hardhat, optimizer 200 runs)

| Operation | Avg gas |
|---|---|
| registerLot | ~224k |
| ship / accept | ~170k / ~77k |
| issue permit | ~134k |
| **dispense** | **~933k** (16 Poseidon hashes for the Merkle insert) |
| issueRecall | ~167k |
| reportAdverseEvent / acknowledgeRecall | ~97k / ~112k (+ ~250k for a real Groth16 verify) |

`dispense` is the optimisation target for P5: options include a Lean incremental Merkle tree,
batching inserts per block, or posting tree roots from an off-chain aggregator with fraud proofs.
On Polygon this is still a fraction of a cent per dispense.

## Threat model summary

| Adversary | Sees | Can't |
|---|---|---|
| Public chain observer | lots, pharmacy pseudonyms, regions, opaque commitments | link a commitment to a person or two dispenses to each other |
| Regulator | the above + k-anonymous regional counts, report and ack counts | learn who was affected or who reported |
| Single pharmacy | its own dispenses and the commitments it wrote | fake inbound stock, over-dispense, or learn the patient secret |
| Colluding pharmacy + prescriber | they already know identities; together they hold 2 Guardian shares | **trust boundary**: the patient can replace one with a family guardian |
| Relayer | proof payloads (no identity) | link a report to a patient, or alter it (signalHash is bound in the proof) |

Known residual leaks (documented, measured by P4): timing correlation between a counter visit and a
`Dispensed` event at a small pharmacy; rare-drug + small-region combinations (mitigated by k = 5).
