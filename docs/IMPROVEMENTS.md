# What we changed and added on top of the synopsis

## Fixes to the original design

| # | Problem in synopsis | Fix in this repo | Where |
|---|---|---|---|
| 1 | Permit stored `patientPubKey`, which links all of a patient's prescriptions | Fresh one-time `holderCommit = keccak(permitSecret)` per permit | `PrescriptionRegistry.sol` |
| 2 | Random nonces were not backed up, so losing the phone lost the history even after Guardian recovery | `nonce_i = Poseidon(secret, i)`; recovery restores everything | `sdk/src/patient.js` |
| 3 | `receiveLot` let a pharmacy self-declare inbound stock, which breaks closure | Two-sided custody: sender ships, recipient accepts | `CustodyLedger.sol` |
| 4 | Regional recall counts could single out a patient | k-anonymity (K = 5) suppression | `RecallRegistry.affectedCount` |
| 5 | Pharmacy + prescriber Guardians can collude | Patient may swap one for a personal guardian; documented trust boundary | `sdk/src/guardians.js`, UI |
| 6 | QR at the counter carried `(secret, nonce)` | QR carries only the commitment; the pharmacy never sees the secret | `counterQrPayload` |
| 7 | "Five dashboards" vs three | Manufacturer, distributor, prescriber, pharmacy, regulator + patient app + public verify | `apps/web` |
| 8 | Recalled lots could still be dispensed | Dispensing a recalled lot reverts | `DispenseLedger.dispense` |

## New features (A–G)

| | Feature | Why it matters | Where |
|---|---|---|---|
| **A** | Anonymous, verified **adverse-event reporting** | Only real recipients can report, one report each, so reports can't be faked or spammed. A threshold raises a `SafetySignal`, so a recall can start from patients before complaints pile up | `AnonymousSignals.reportAdverseEvent`, circuit |
| **B** | Anonymous **recall acknowledgements** | Regulator gets live "recall effectiveness %" without learning who | `AnonymousSignals.acknowledgeRecall` |
| **C** | **Indian context** | Contaminated cough-syrup incidents and India's QR-on-pack rules motivate the problem; region names and alert languages are local | README, `i18n.js`, regions |
| **D** | **Gas-free patient app** in regional languages | Patients never need crypto or a wallet; installable PWA; English / Hindi / Kannada / Telugu alerts | `apps/relayer`, `i18n.js`, manifest |
| **E** | **Counterfeit check** on the public verify page | Unregistered lot reads as "possible counterfeit"; shows custody path, expiry, CoA hash, recall status | `pages/Verify.jsx` |
| **F** | **Regulator heat-map** | Affected units by region with k-anonymous suppression | `pages/Regulator.jsx` |
| **G** | **Live replay of real FDA recalls** | Real openFDA enforcement events replayed as regulator transactions during the demo | `pipeline/openfda.py`, Regulator page |

## Added after the skeleton

| | What | Where |
|---|---|---|
| ZK | Circuit compiled, trusted setup, generated Groth16 verifier, real proofs in tests and in the browser | `circuits/setup.sh`, `RealProof.test.js`, `lib/prover.js` |
| Gas | Lean Merkle tree: dispense 933k → 373k mean | `LotTree.sol` |
| Privacy | `dispenseBatch` + pharmacy queue against the timing attack | `DispenseLedger.sol`, `Pharmacy.jsx` |
| Patient | PIN-encrypted wallet, camera QR scanning, one-time code rotation, Guardian handover/recovery, service worker, system alerts | `apps/web` |
| Tests | Negative-path suite; 100% lines / 95% branches; CI gate; browser e2e | `contracts/test`, `apps/web/e2e` |
| Evidence | Red-team simulations, scaling to 100k patients, figures, byte-identical dataset manifest | `redteam/`, `pipeline/` |
| Ops | One-command demo, Amoy deploy + verify scripts, three-job CI | `scripts/demo.sh`, `contracts/scripts`, `.github/workflows` |

## Final round

| What | Where |
|---|---|
| FDA replay recalls the exact lot numbers parsed from each notice, with a drug-code vs LOTUS comparison | `sdk/src/fda.js`, `contracts/scripts/stage-fda.js`, Regulator page |
| Captioned demo video recorded from the real app | `docs/demo/lotus-demo.mp4`, `apps/web/e2e/record-demo.mjs` |
| Report as PDF and Word with cover page | `docs/LOTUS_Report.pdf`, `.docx`, `npm run report` |
| Every page fits a phone screen; offline mode verified | `Layout.jsx`, `public/sw.js` |
| Amoy: key generation, actor registration, one-command deploy + verify | `contracts/scripts/new-deployer.js`, `register-actors.js`, `npm run amoy:all` |
| Trusted setup downloads and hash-checks the public ceremony automatically | `circuits/setup.sh` |

## Still open (needs your network, keys or people)

| Item | How | Owner |
|---|---|---|
| Public Hermez ceremony | `npm run zk:setup` on a normal connection, commit the regenerated files | P2 |
| Amoy deployment | `npm run amoy:wallet -w contracts`, fund, `npm run amoy:all -w contracts` (`docs/DEPLOY.md`) | P8 |
| Real openFDA events | `python pipeline/openfda.py`, then `npm run demo` | P6 |
| Native-speaker check of Hindi / Kannada / Telugu alerts | `apps/web/src/lib/i18n.js` | P7 |
