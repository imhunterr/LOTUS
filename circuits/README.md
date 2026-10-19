# Zero-knowledge circuit

`lotus_membership.circom` lets a patient prove "one of the dispenses of lot X was mine" without
revealing which one. `AnonymousSignals.sol` uses it for:

- **Adverse-event reports** (feature A): sybil-resistant, one per patient per lot.
- **Recall acknowledgements** (feature B): one per patient per recall, which gives live recall effectiveness.

The hash (Poseidon over BN254), the tree depth (16) and the leaf formula must match
`contracts/libraries/LotTree.sol` and `sdk/src/tree.js`. The contract tests already assert that
the on-chain root equals the SDK root.

## Build (needs `circom` ≥ 2.1.6 and `snarkjs`)

```bash
npm i -D circomlib snarkjs           # from repo root
mkdir -p circuits/build && cd circuits/build
circom ../lotus_membership.circom --r1cs --wasm --sym
# Powers of tau: any public ptau with ≥ 2^13 constraints, e.g. powersOfTau28_hez_final_14.ptau
npx snarkjs groth16 setup lotus_membership.r1cs powersOfTau28_hez_final_14.ptau lotus_0000.zkey
npx snarkjs zkey contribute lotus_0000.zkey lotus_final.zkey --name="LOTUS team" -v
npx snarkjs zkey export solidityverifier lotus_final.zkey ../../contracts/contracts/privacy/Groth16Verifier.sol
```

Then deploy `Groth16Verifier` and pass its address as `VERIFIER_ADDRESS` to `npm run deploy:amoy`.
Copy `lotus_membership_js/lotus_membership.wasm` and `lotus_final.zkey` into `apps/web/public/zk/`
so the patient app can generate proofs in the browser.

Until then, local development uses `MockMembershipVerifier`, which the deploy script refuses to
put on a public network.
