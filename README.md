# LOTUS: Lot-Oriented Traceability for Unlinkable Subjects

> When one bad batch of a medicine is recalled, only the patients who actually received **that batch**
> should be told, without anyone (not even the regulator) learning who they are.

LOTUS is a decentralised application that closes the last, unrecorded hop of the drug supply chain
(**pharmacy → patient**) on an EVM blockchain, while keeping patients off-chain.

| Today (drug-code matching) | With LOTUS (lot matching) |
|---|---|
| Everyone who took the drug is alarmed, from any batch | Only recipients of the recalled lot are notified |
| Cash sales and transferred prescriptions are missed | Every dispense is on the ledger (as an anonymous commitment) |
| Nobody can prove how many recalled units left a pharmacy | Closure accounting proves it per pharmacy per lot |
| No feedback on whether patients got the message | Anonymous acknowledgements give live recall effectiveness |
| Side effects reach regulators slowly, if at all | Verified anonymous reports raise an early safety signal |

## Repository layout

```
contracts/   Solidity contracts + Hardhat tests (unit, integration, invariant fuzzing)
sdk/         Patient-side crypto: commitments, Merkle trees, nullifiers, Guardian recovery
circuits/    Circom zero-knowledge circuit for anonymous reports / acknowledgements
apps/web/    React dashboards: manufacturer, distributor, prescriber, pharmacy, regulator,
             patient app (PWA) and the public "verify a pack" page
apps/relayer Gas-free relayer so patients never need a crypto wallet
pipeline/    openFDA fetcher, synthetic cohorts, precision/sensitivity evaluation
docs/        Architecture, improvements over the synopsis, threat model, team guide
```

## Quick start (local demo)

Requirements: Node 20+, Python 3.11+ (only for the pipeline).

```bash
npm install
npm test                 # 21 contract tests + SDK tests

npm run chain            # terminal 1: local Hardhat blockchain
npm run deploy:local     # terminal 2: deploy all contracts
npm run demo:seed        #   actors, 2 lots of the same drug, 12 private dispenses
npm run relayer          # terminal 3: gas-free relayer (optional)
npm run web              # terminal 4: http://localhost:5173
```

Demo script: **Patient app → "Load seeded demo patient"** (not affected) → **Regulator → Recall lot D298765**
→ **Patient app → Check for recalls** (now affected, while the other lot's patients are not)
→ acknowledge anonymously → see recall effectiveness rise on the Regulator page.

> Behind a firewall that blocks the Solidity compiler download? Prefix commands with `LOTUS_SOLCJS=1`
> to use the bundled solc-js compiler.

## Contracts

| Contract | Responsibility |
|---|---|
| `RoleRegistry` | RBAC for manufacturer / distributor / pharmacy / prescriber / regulator; pseudonyms and regions |
| `BatchRegistry` | Lot registration (NDC + lot number, expiry, certificate-of-analysis hash) |
| `CustodyLedger` | **Two-sided** shipments (ship → accept), pharmacy closure books, returns and shrinkage |
| `PrescriptionRegistry` | Single-use permits with quantity balance; **unlinkable** one-time holder commitments |
| `DispenseLedger` | Split-record dispensing, enforces invariants I1–I4, per-lot Poseidon Merkle tree |
| `RecallRegistry` | Regulator-only immutable recalls, **k-anonymous** regional aggregates |
| `AnonymousSignals` | Zero-knowledge **adverse-event reports** and **recall acknowledgements** |

Invariants enforced on-chain: **I1** closure (dispensed + returned + shrinkage ≤ inbound),
**I2** lot must be received, **I3** permit balances atomic and non-negative, **I4** commitments unique,
**I5** regulator-only immutable recalls. **I6** (never worse than status quo) is measured by `pipeline/evaluate.py`.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/IMPROVEMENTS.md`](docs/IMPROVEMENTS.md).

## Team

| # | Member | Role |
|---|---|---|
| P1 | Patoju Sai Avinash | Ledger Architecture |
| P2 | Adabala Venkata Abhinav | Privacy & Key Custody |
| P3 | K. Jaideep Varma | Rule Enforcement & Verification |
| P4 | Dhruti P Shetty | Red Team / Adversary Simulation |
| P5 | Ashmith C Shettigar | Measurement & Evaluation |
| P6 | P Pattabhi Ram | Data Pipeline & Reproducibility |
| P7 | Puripanda Venkata Praneeth | Patient-Side Product |
| P8 | K. Poorna Sai Praneeth | Integration & Deployment |

Manipal Institute of Technology. See [`docs/TEAM_GUIDE.md`](docs/TEAM_GUIDE.md) for who owns which folder.
