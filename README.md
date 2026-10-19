# LOTUS web application

The requested FireFly, Caliper, Brownie and IPFS integrations are implemented and exercised against real local runtimes. See [toolchain migration and synopsis feature mapping](docs/TOOLCHAIN_MIGRATION.md) for their roles, setup, evidence and deployment boundaries.

LOTUS records medicine lot custody and pharmacy dispensing, then lets recipients recognize relevant recalls and respond privately. The revamped application runs entirely in a browser: a phone-oriented patient PWA, staff workspaces, public pack verification and a separate guardian share vault.

## Start

Use Node 22.13 or newer from this repository root:

```powershell
npm ci
npm run build
npm start
```

Open [LOTUS](http://127.0.0.1:8787). Staff access at `/login` provides first-run operator setup; choose your own account credentials. Approve organizations and create private staff invitations. Patients enter at `/patient` without a staff account. No business inventory or patient data is seeded into the normal profile.

`npm start` selects the **Fabric + FireFly + IPFS** operational profile. Prepare its ledger and document services using the toolchain guide before launching a fresh checkout. Runtime binaries, identities and databases are local state and are excluded from Git.

`npm run dev` runs the API and frontend development server. `npm run sandbox` starts a separate replay profile on port 8789.

## Working application features

- Authorized manufacturer, distributor, pharmacy, prescriber, regulator, operator and auditor workspaces.
- Product/lot registration, verified document bytes, pack codes, two-sided shipments, rejection, returns, quarantine and documented stock losses.
- Expiring prescription permits, partial fills, pharmacy binding/transfer, one-time patient codes and atomic single/batch dispensing.
- Committed, signed patient receipts; encrypted browser vault; local recall matching; two-of-three guardian recovery of receipts, prescriptions and allocated indices.
- Browser-generated Groth16 proofs for anonymous recall acknowledgements and encrypted side-effect reports, with real verifier and nullifier checks.
- Exact-lot recalls, safety thresholds, privacy-controlled regional records, source-preserving imports and isolated recall replay.
- Installable patient web interface, cached/offline checks with explicit freshness, camera/paste scanning and regional-language recall alerts.

## Real Hyperledger integration

The normal start command uses real Fabric chaincode, FireFly contract APIs/events and encrypted IPFS documents. `npm run start:local` is an explicit durable SQLite development mode. Both execute the same domain rules; Fabric failure never falls back to local state.

A Fabric 3.1.5 integration network is prepared with two endorsing organizations, TLS identities, an orderer and an external chaincode service. It runs directly in Ubuntu WSL without Docker or a Go installation. Its acceptance channel has passed the full custody/dispense/recall flow and real proof verification inside chaincode.

See [setup, Fabric enrollment and verification](docs/WEB_APPLICATION_GUIDE.md) before switching a profile. The local network is an integration environment, not an independently administered production consortium. The guide records remaining deployment, privacy, key-custody, scaling and notification work.

## Verification

```powershell
npm test
npm run test:browser
npm run test:fabric
```

Fabric tests require the acceptance channel and its configuration. Browser tests use isolated temporary profiles and check real proofs, encrypted report retrieval, complete guardian recovery and phone layouts. Normal profile data remains untouched.

## Source layout

| Area | Purpose |
| --- | --- |
| `apps/web/src/application` | Responsive application, stakeholder screens, browser vault and API client |
| `services/api` | Authentication, invitations, durable data, documents, anonymous relay and Fabric adapter |
| `packages/domain` | Shared transactional rules, stock/permit invariants, trees, proofs and privacy projections |
| `chaincode/lotus` | Actual Fabric contract and chaincode service |
| `infra/fabric`, `scripts/fabric-*` | Local network configuration, launch, stop and enrollment |
| `contracts`, `sdk`, `circuits` | Retained EVM/cryptographic reference and regression fixtures |
| `pipeline`, `redteam` | Retained research/source pipelines and adversary simulations |

[Migration design](docs/HYPERLEDGER_MIGRATION_PLAN.md) retains the 35-capability checklist and production architecture. The [original report](docs/REPORT.md) and [threat model](docs/THREAT_MODEL.md) preserve the earlier research baseline; their synthetic metrics are not performance measurements of this application. Report exports can be regenerated with `npm run report` (Pandoc and Playwright Chromium required).

The superseded EVM demo UI, relayer, seeding scripts, recordings and planning wireframes have been removed. EVM deployment commands live in the `contracts` workspace; they are reference tooling and do not configure the Fabric web application. Caliper dependencies remain isolated in `tools/caliper`. Generated test and red-team reports go under ignored `test-results/`.
