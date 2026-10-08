# Deploying to Polygon Amoy (P8)

The local demo needs nothing but Node. A public testnet deployment gives the project a citable address.

## 1. One-time setup

1. Create a fresh wallet for deployment only (never reuse a personal one) and copy its private key.
2. Get test POL from the Polygon faucet (https://faucet.polygon.technology, choose Amoy). A full
   deployment needs well under 1 POL at testnet gas prices.
3. Get a Polygonscan API key (https://polygonscan.com/myapikey) for source verification.
4. `cp contracts/.env.example contracts/.env` and fill in `AMOY_RPC_URL`, `DEPLOYER_KEY`,
   `POLYGONSCAN_API_KEY`. Load it with `set -a; source contracts/.env; set +a`.

## 2. Trusted setup (recommended before a public deployment)

Download `powersOfTau28_hez_final_14.ptau` into `circuits/build/`, then:

```bash
npm run zk:setup     # checks the file's official hash, rebuilds zkey + Groth16Verifier.sol
```

## 3. Deploy and verify

```bash
npm run deploy:amoy -w contracts     # deploys the verifier + 7 contracts, writes deployments/amoy.json
npm run verify:amoy -w contracts     # verifies every contract on amoy.polygonscan.com
```

Then register the real actors from the admin account (`RoleRegistry.registerActor(address, role, region)`)
and point the web app at Amoy:

```bash
echo "VITE_RPC_URL=https://rpc-amoy.polygon.technology" > apps/web/.env.local
VITE_USE_WALLET=1 npm run build -w apps/web     # dashboards sign with MetaMask on Amoy
```

The relayer needs `RPC_URL`, `RELAYER_KEY` (a funded Amoy key) and `DEPLOYMENT=contracts/deployments/amoy.json`.

## 4. Demo reset

`npm run demo` always starts a fresh local chain, redeploys and reseeds, so re-running it is the reset.
