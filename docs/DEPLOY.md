# Deploying to Polygon Amoy (P8)

The local demo (`npm run demo`) needs nothing but Node. A public testnet deployment gives the project a
citable address. Everything below runs from the repository root on a normal internet connection.

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

This writes a fresh deployer key and relayer key to `contracts/.env` (git-ignored, readable only by you)
and prints both addresses. Then:

1. Fund both addresses with test POL from https://faucet.polygon.technology (network: Amoy).
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

## 5. Point the apps at Amoy

```bash
cp contracts/deployments/amoy.json apps/web/src/generated/deployment.json
printf "VITE_RPC_URL=https://rpc-amoy.polygon.technology\nVITE_USE_WALLET=1\nVITE_RELAYER_URL=http://localhost:8787\n" > apps/web/.env.local
npm run build -w apps/web      # dashboards now sign with MetaMask on Amoy

RPC_URL=https://rpc-amoy.polygon.technology \
DEPLOYMENT=contracts/deployments/amoy.json \
RELAYER_KEY=$(grep RELAYER_KEY contracts/.env | cut -d= -f2) \
npm run relayer
```

`apps/web/dist/` is a static site; it can be hosted on GitHub Pages, Netlify or Vercel.

## Demo reset (local)

`npm run demo` always starts a fresh local chain, redeploys, reseeds and stages the FDA replay lots, so
re-running it is the reset.
