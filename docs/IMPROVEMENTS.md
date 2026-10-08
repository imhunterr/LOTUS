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

## Still to do (owner)

- Compile the circuit, generate the Groth16 verifier, wire snarkjs into the browser (P2 + P7)
- Amoy deployment + source verification (P8)
- Replace sample replay data with `openfda.py` output; Synthea cohorts at 1k → 100k (P6)
- Gas optimisation of `dispense` (P1 + P5)
- Red-team notebook: timing-correlation and small-region attacks (P4)
- Encrypted IndexedDB + biometric unlock for the patient wallet (P7)
- Check the Hindi / Kannada / Telugu alert strings with native speakers (P7)
