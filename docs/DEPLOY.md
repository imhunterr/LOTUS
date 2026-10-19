# Deploying the EVM reference to Polygon Amoy

These commands retain the original Solidity deployment reference. They do not deploy or configure the Fabric web application; use [TOOLCHAIN_MIGRATION.md](TOOLCHAIN_MIGRATION.md) for that stack. Run them from the repository root.

## 1. Use the public trusted setup (once)

```bash
npm run zk:setup
```

This downloads the public Hermez Powers of Tau file, checks its official hash, and regenerates the
proving key and `Groth16Verifier.sol`. Commit the changed files (`apps/web/public/zk/*`,
`contracts/contracts/privacy/Groth16Verifier.sol`) and run `npm test` to confirm the real-proof tests pass.

## 2. Create and fund the deployer

```bash
npm run amoy:wallet -w contracts
```

This writes a fresh deployer key to `contracts/.env` (git-ignored) and prints its address. Then:

1. Fund the deployer address with test POL from https://faucet.polygon.technology (network: Amoy).
2. Create a free API key at https://polygonscan.com/myapikey and paste it into `POLYGONSCAN_API_KEY=`
   in `contracts/.env`.

## 3. Say who the real actors are

Copy `contracts/config/actors.example.json` to `contracts/config/actors.amoy.json` and put in the
MetaMask addresses of whoever plays manufacturer, distributor, pharmacy, prescriber and regulator in
the demo (team members' wallets are fine).

## 4. Deploy, verify, register

```bash
npm run amoy:all -w contracts
```

This deploys the verifier and the seven contracts (`contracts/deployments/amoy.json`), verifies every
contract's source on amoy.polygonscan.com, and registers the actors. Each step can be re-run on its own:
`deploy:amoy`, `verify:amoy`, `amoy:actors`.

## 5. Inspect the reference deployment

Addresses, constructor arguments and ABIs are written to `contracts/deployments/amoy.json`. The responsive web application uses its authenticated API and selected Fabric profile. The old MetaMask dashboards and development-key relayer have been removed.

For an isolated local EVM reference, run `npm run chain -w contracts`, then `npm run deploy:local -w contracts` in another terminal. Use `npm run test:brownie` for executable migration regressions and gas measurements; use `npm run sandbox` for the current web replay interface.
