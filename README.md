# LOTUS: Lot-Oriented Traceability for Unlinkable Subjects

> When one bad batch of a medicine is recalled, only the patients who actually received **that batch**
> should be told, without anyone (not even the regulator) learning who they are.

LOTUS records the last, unrecorded hop of the drug supply chain (**pharmacy → patient**) on an EVM
blockchain while keeping patients off-chain. Patients' phones recognise their own records, and
zero-knowledge proofs let them acknowledge recalls and report side effects anonymously.

| Today (drug-code matching) | With LOTUS (lot matching) |
|---|---|
| Precision ≈ 0.17: about 5 in 6 alerts are false alarms | Precision ≈ 0.99 |
| Sensitivity 0.85–0.88: cash sales and transfers are missed | ≥ 0.993 together with existing channels |
| Nobody can prove how many recalled units left a pharmacy | Closure accounting per pharmacy per lot |
| No feedback on whether patients got the message | Anonymous acknowledgements → live recall effectiveness |
| Side effects reach regulators slowly | Verified anonymous reports raise an early safety signal |

*(10,000–100,000-patient synthetic cohorts with injected lost phones and misrecorded lots; see `docs/REPORT.md`.)*

**Watch first:** [`docs/demo/lotus-demo.mp4`](docs/demo/lotus-demo.mp4), a 2-minute captioned walkthrough recorded from the real app.
**Read:** [`docs/LOTUS_Report.pdf`](docs/LOTUS_Report.pdf) (also `.docx`).

## Run the demo

Requirements: Node 20+ (Python 3.11+ only for the evaluation pipeline).

```bash
npm install
npm run demo          # fresh chain → deploy → seed → FDA replay lots → relayer → web app on http://localhost:5173
```

Five-minute walkthrough: **Patient app** → set a PIN → "Load seeded demo patient" →
**Regulator** → recall lot `D298765` → **Patient app** → red alert → send an anonymous acknowledgement →
**Regulator** shows effectiveness → **Patient app** → "Simulate lost phone" → recover from Guardians →
**Verify a pack** → type a fake lot → "possible counterfeit".

> Firewalled network that blocks the Solidity compiler download? Prefix with `LOTUS_SOLCJS=1`.

## Everything else

| Command | What it does |
|---|---|
| `npm test` | 37 contract tests (incl. real Groth16 proofs and invariant fuzzing) + SDK tests |
| `npm run coverage:check -w contracts` | Coverage with a 90% branch gate (currently 100% lines / 95% branches) |
| `npm run test:e2e` | Browser end-to-end test of the whole flow (needs `npm run demo` running) |
| `npm run redteam` | Six adversary simulations → `redteam/REPORT.md` |
| `npm run eval` | Precision / sensitivity / scaling evaluation + figures in `docs/figures/` |
| `python pipeline/manifest.py verify` | Checks the datasets regenerate byte for byte |
| `npm run zk:setup` | Rebuilds the circuit and verifier, using the public Hermez ceremony when it can download it |
| `npm run report` | Rebuilds `docs/LOTUS_Report.pdf` and `.docx` from `docs/REPORT.md` |
| `node apps/web/e2e/record-demo.mjs` | Re-records the captioned demo video (with the demo running) |
| `npm run amoy:wallet -w contracts` then `npm run amoy:all -w contracts` | Polygon Amoy: create keys, then deploy + verify + register actors (`docs/DEPLOY.md`) |

## Repository layout

```
contracts/    7 Solidity contracts + Groth16 verifier, tests, deploy / verify / benchmark scripts
circuits/     Circom membership circuit and trusted-setup script
sdk/          Patient-side crypto: commitments, lean Merkle tree, nullifiers, proofs, Guardians
apps/web/     Role dashboards, patient PWA, public verify page, browser e2e test
apps/relayer/ Gas-free relayer so patients never need a crypto wallet
pipeline/     openFDA fetcher, synthetic cohorts, evaluation, figures, dataset manifest
redteam/      Adversary simulations
docs/         Report (D7), threat model (D6), architecture, improvements, deployment, team guide
```

## Contracts

| Contract | Responsibility |
|---|---|
| `RoleRegistry` | RBAC for manufacturer / distributor / pharmacy / prescriber / regulator; pseudonyms and regions |
| `BatchRegistry` | Lot registration (NDC + lot number, expiry, certificate-of-analysis hash) |
| `CustodyLedger` | Two-sided shipments (ship → accept), closure books, returns and shrinkage |
| `PrescriptionRegistry` | Single-use permits with quantity balance; unlinkable one-time holder commitments |
| `DispenseLedger` | Split-record dispensing (single or batched), invariants I1–I4, per-lot lean Poseidon Merkle tree |
| `RecallRegistry` | Regulator-only immutable recalls, k-anonymous regional aggregates |
| `AnonymousSignals` | Zero-knowledge adverse-event reports and recall acknowledgements |

## Documentation

- [`docs/REPORT.md`](docs/REPORT.md): full project report with results
- [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md): adversaries, attacks, mitigations
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): how the pieces fit
- [`docs/IMPROVEMENTS.md`](docs/IMPROVEMENTS.md): what changed from the synopsis
- [`docs/DEPLOY.md`](docs/DEPLOY.md): Polygon Amoy deployment
- [`docs/TEAM_GUIDE.md`](docs/TEAM_GUIDE.md): who owns what

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

Manipal Institute of Technology.
