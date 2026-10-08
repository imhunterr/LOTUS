const fs = require("fs");
const path = require("path");
const { Wallet } = require("ethers");

/**
 * Creates a fresh deployer wallet for Polygon Amoy and writes it to contracts/.env (never committed).
 * Refuses to overwrite an existing DEPLOYER_KEY. Next: fund the printed address from the faucet.
 */
const envPath = path.join(__dirname, "..", ".env");
const env = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : fs.readFileSync(path.join(__dirname, "..", ".env.example"), "utf8");
if (/^DEPLOYER_KEY=0x[0-9a-fA-F]{64}$/m.test(env)) {
  const existing = new Wallet(env.match(/^DEPLOYER_KEY=(0x[0-9a-fA-F]{64})$/m)[1]);
  console.log(`contracts/.env already has a deployer: ${existing.address}`);
  process.exit(0);
}
const w = Wallet.createRandom();
const relayer = Wallet.createRandom();
let next = env.replace(/^DEPLOYER_KEY=.*$/m, `DEPLOYER_KEY=${w.privateKey}`);
next = /^RELAYER_KEY=/m.test(next) ? next.replace(/^RELAYER_KEY=.*$/m, `RELAYER_KEY=${relayer.privateKey}`) : `${next.trimEnd()}\nRELAYER_KEY=${relayer.privateKey}\n`;
fs.writeFileSync(envPath, next, { mode: 0o600 });
console.log("Wrote contracts/.env (keep it secret; it is git-ignored).");
console.log(`Deployer address: ${w.address}`);
console.log(`Relayer address:  ${relayer.address}`);
console.log("Fund both from https://faucet.polygon.technology (network: Amoy), then run: npm run amoy:all");
