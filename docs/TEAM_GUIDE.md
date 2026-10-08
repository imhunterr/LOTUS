# Team guide: who owns what

Everything in the synopsis is implemented. Each person should **own, understand and be able to explain**
their area in the viva. The "explain it" column is what an examiner will most likely ask you.

| Owner | Area | Files | Be ready to explain | Left to do |
|---|---|---|---|---|
| P1 Ledger Architect | Contracts and ledger semantics | `contracts/contracts/core/*`, `libraries/LotTree.sol` | Split record; two-sided custody; why the lean tree is cheaper | — |
| P2 Privacy & Key Custody | Commitments, nullifiers, circuit, Guardians | `sdk/src/*`, `circuits/*` | Why nonces are derived; what the proof proves; trusted setup | Re-run `npm run zk:setup` with the public Hermez ptau |
| P3 Rule Enforcement | Invariants I1–I5, tests, CI gate | `contracts/test/*`, `.solcover.js` | How fuzzing checks closure; what 95% branch coverage means | — |
| P4 Red Team | Attacks and mitigations | `redteam/*`, `docs/THREAT_MODEL.md` | Timing attack + batching; k-anonymity; Guardian collusion | — |
| P5 Measurement | Metrics, gas, scaling, figures | `pipeline/evaluate.py`, `pipeline/figures.py`, `contracts/scripts/bench-gas.js`, `sdk/bench` | Precision vs sensitivity; why LOTUS + channels never does worse (I6) | — |
| P6 Data Pipeline | Cohorts, openFDA, reproducibility | `pipeline/cohort.py`, `openfda.py`, `manifest.py` | How byte-identical regeneration is checked | Run `openfda.py` on an open network and commit the output |
| P7 Patient Product | Patient app and verify page | `apps/web/src/pages/Patient.jsx`, `Verify.jsx`, `lib/patientStore.js`, `lib/prover.js`, `public/sw.js` | Encrypted wallet; code rotation; in-browser proving; recovery flow | Native-speaker check of translations |
| P8 Integration | Demo, deployment, CI | `scripts/demo.sh`, `contracts/scripts/*`, `apps/relayer`, `apps/web/e2e`, `.github/workflows` | Relayer role; how CI proves it all works | Amoy deploy (`docs/DEPLOY.md`) |

## Daily commands

```bash
npm run demo            # whole system locally
npm test                # all tests
npm run test:e2e        # browser test (with the demo running)
npm run redteam && npm run eval
```

## Rules

- Changes to ledger semantics need P1's review; changes to the commitment, nullifier or tree format need
  P2's and must keep `Dispense.test.js › on-chain Poseidon tree matches the SDK tree` and
  `RealProof.test.js` green. A circuit change means re-running `npm run zk:setup`.
- Never deploy `MockMembershipVerifier` to a public network (the deploy script refuses to).
