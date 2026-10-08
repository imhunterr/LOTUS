const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { deployLotus } = require("./deploy-lib");

/**
 * Deploys LOTUS and writes addresses + ABIs to deployments/<network>.json, which the web app reads.
 * Public networks require a real Groth16 verifier: VERIFIER_ADDRESS=0x... npm run deploy:amoy
 */
async function main() {
  const { ethers, network } = hre;
  const [admin] = await ethers.getSigners();
  const isLocal = ["hardhat", "localhost"].includes(network.name);
  const verifier = process.env.VERIFIER_ADDRESS;
  if (!isLocal && !verifier) throw new Error("Refusing to deploy the mock verifier to a public network. Set VERIFIER_ADDRESS.");

  const c = await deployLotus({ admin, verifier, safetySignalThreshold: Number(process.env.SAFETY_THRESHOLD || 3) });
  const names = ["roles", "custody", "batches", "prescriptions", "dispenses", "recalls", "signals"];
  const contractNames = {
    roles: "RoleRegistry", custody: "CustodyLedger", batches: "BatchRegistry", prescriptions: "PrescriptionRegistry",
    dispenses: "DispenseLedger", recalls: "RecallRegistry", signals: "AnonymousSignals",
  };

  const out = { network: network.name, chainId: Number((await ethers.provider.getNetwork()).chainId), admin: admin.address, contracts: {} };
  for (const n of names) {
    const artifact = await hre.artifacts.readArtifact(contractNames[n]);
    out.contracts[n] = { name: contractNames[n], address: await c[n].getAddress(), abi: artifact.abi };
  }

  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${network.name}.json`), JSON.stringify(out, null, 2));
  // The web app imports this file directly.
  const webDir = path.join(__dirname, "..", "..", "apps", "web", "src", "generated");
  fs.mkdirSync(webDir, { recursive: true });
  fs.writeFileSync(path.join(webDir, "deployment.json"), JSON.stringify(out, null, 2));

  console.log(`LOTUS deployed to ${network.name}`);
  for (const n of names) console.log(`  ${contractNames[n].padEnd(22)} ${out.contracts[n].address}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
