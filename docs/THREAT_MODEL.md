# Threat model and privacy analysis (D6)

Owners: P2 (Privacy & Key Custody) and P4 (Red Team). Every claim below is backed by a test in
`contracts/test/` or a simulation in `redteam/` (run `npm run redteam`; results in `redteam/REPORT.md`).

## 1. What we protect

| Asset | Why it matters |
|---|---|
| Which patient received which lot | Medical information: reveals conditions and treatments |
| Links between a patient's dispenses | Even pseudonymous, a linked history re-identifies people |
| The patient secret | Holding it lets anyone recompute all of a patient's commitments |
| Integrity of custody and dispense records | Recall scope and closure accounting depend on them |
| Integrity of safety signals | Fake or duplicated reports could trigger or suppress recalls |

## 2. Assumptions

- The patient's device is not compromised while unlocked (the wallet is AES-GCM encrypted under a PIN-derived key at rest).
- Poseidon is collision- and preimage-resistant; secrets are 248-bit uniform field elements.
- Groth16 soundness holds for the trusted setup used (the demo uses a local Powers of Tau ceremony; production must use the public Hermez ceremony, which `circuits/setup.sh` verifies by hash).
- At most one of any two Guardians colludes (2-of-3 threshold).
- The chain provides ordering and immutability (Polygon PoS / local Hardhat).

## 3. Adversaries

| # | Adversary | Capabilities |
|---|---|---|
| ADV-1 | Passive chain observer | Reads every event and storage slot, forever |
| ADV-2 | Regulator | ADV-1 plus the regulator dashboard (k-anonymous aggregates, signal counts) |
| ADV-3 | Dishonest pharmacy | Holds a pharmacy role; sees patients at its own counter; may collude with a prescriber |
| ADV-4 | Malicious relayer | Receives patients' proofs before submitting them |
| ADV-5 | Spammer / Sybil | Wants to flood or fake adverse-event reports or acknowledgements |

## 4. Results

| ID | Attack | Result | Evidence |
|---|---|---|---|
| A1 | ADV-1 links two dispenses of one patient | **Resisted.** Same-patient and different-patient commitment pairs are statistically indistinguishable (KS p ≈ 0.2–0.9; best classifier ≈ 51% vs 50% guessing) | `redteam/attacks.mjs › linkability` |
| A1b | ADV-1 links two prescriptions via a patient key | **Resisted.** Permits hold a fresh one-time `holderCommit`; there is no long-lived patient key (fix #1 over the synopsis) | `PrescriptionRegistry.sol` |
| A2 | ADV-3 or a bystander correlates a counter visit with the next `Dispensed` event | **Residual risk, mitigated.** With instant submission at a quiet pharmacy (4 dispenses/hour) 94% of dispenses are uniquely identifiable; hourly batching (`dispenseBatch`) brings that to 2%, and to 0% at 20+ dispenses/hour | `redteam › timing`, `DispenseLedger.dispenseBatch`, pharmacy "queue" toggle |
| A3 | ADV-2 infers a patient from a small regional count | **Mitigated.** 20.6% of region cells in the simulation would expose ≤ 2 patients; k = 5 suppression hides all of them | `redteam › smallRegion`, `RecallRegistry.affectedCount` |
| A4 | ADV-3 + prescriber pool Guardian shares | **Trust boundary.** With default guardians they can rebuild the secret; the patient can name a family member instead, after which the professionals hold one share between them and learn nothing | `redteam › guardianCollusion`, patient app |
| A5 | ADV-5 files many reports for one lot | **Resisted.** Nullifier = Poseidon(secret, topic) is identical across all of a patient's dispenses of that lot; the contract rejects reuse (tested with real Groth16 proofs) | `RealProof.test.js` |
| A6 | ADV-5 reports without having received the lot | **Resisted.** No valid witness exists, so the circuit cannot produce a proof | `RealProof.test.js › non-recipient` |
| A7 | ADV-4 alters a report or acknowledgement in transit | **Resisted.** `signalHash` is a public input bound into the proof; a changed severity or text fails verification | `RealProof.test.js › relayer` |
| A8 | ADV-2 reads patient identifiers from its view | **Resisted.** 25 exposed fields inspected; none is a patient identifier | `redteam › regulatorView` |
| A9 | ADV-3 invents stock or over-dispenses to fabricate records | **Resisted.** Two-sided custody plus closure (I1, I2) enforced on-chain; 150-step random hostile sequences never break the invariant | `Invariants.test.js`, `Custody.test.js` |
| A10 | ADV-3 sells a recalled lot | **Resisted.** `dispense` reverts for recalled lots | `Recall.test.js` |

## 5. What LOTUS does *not* protect against

- A pharmacy knows who stood at its counter and which commitment it wrote for them. It can link
  *that* dispense to *that* person (it already knows this today). It cannot link the patient's
  dispenses at other pharmacies, or later ones at its own counter, because each uses a new commitment.
- A compromised, unlocked phone reveals the secret.
- Network-level metadata (IP addresses) when the patient app reads the chain or calls the relayer;
  production should read through a public RPC over Tor or a privacy-preserving gateway.
- A lot misrecorded at the counter (wrong shelf box scanned): measured at 0.5–2% in the evaluation; the
  existing recall channels still run (I6), so the patient is never worse off than today.

## 6. Degradation invariant (I6)

LOTUS is additive: conventional recall notices continue unchanged. The evaluation shows
"LOTUS + existing channels" sensitivity ≥ 0.993 in every injected-failure setting, against 0.85–0.88 for
drug-code matching alone, so no LOTUS failure leaves a patient worse off than the status quo.
