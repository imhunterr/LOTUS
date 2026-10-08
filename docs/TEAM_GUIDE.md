# Team guide: who owns what

| Owner | Folder / file | First tasks |
|---|---|---|
| P1 Ledger Architect | `contracts/contracts/core/*` | Review the custody + dispense semantics; reduce `dispense` gas |
| P2 Privacy & Key Custody | `sdk/`, `circuits/` | Compile the circuit, export the verifier, write the unlinkability argument |
| P3 Rule Enforcement | `contracts/test/*` | Raise branch coverage above 90%; add more invariant ops (transfers, rejects) |
| P4 Red Team | `docs/ARCHITECTURE.md` threat model, new `redteam/` | Timing-correlation and small-region attacks; colluding-pharmacy walkthrough |
| P5 Measurement | `pipeline/evaluate.py` | Fix metric definitions, gas plots, 1k → 100k scaling |
| P6 Data Pipeline | `pipeline/openfda.py`, `pipeline/cohort.py` | Real openFDA pull, Synthea integration, dataset versioning |
| P7 Patient Product | `apps/web/src/pages/Patient.jsx`, `lib/patientStore.js`, `lib/prover.js` | Camera QR scan, encrypted storage, real proofs in browser, translations |
| P8 Integration | `contracts/scripts/*`, `apps/relayer`, CI | Amoy deploy, demo reset script, final video |

## Daily commands

```bash
npm test                              # all tests
npx hardhat coverage --config contracts/hardhat.config.js
npm run chain && npm run deploy:local && npm run demo:seed && npm run web
python pipeline/evaluate.py
```

## Rules

- Any change to ledger semantics needs P1's review; any change to commitment, nullifier or tree format needs
  P2's, and must keep `test/Dispense.test.js › on-chain Poseidon tree matches the SDK tree` green.
- Never deploy `MockMembershipVerifier` to a public network (the deploy script refuses to).
