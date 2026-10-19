const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

/**
 * Registers real actors from config/actors.<network>.json, e.g.
 *   [{ "role": "PHARMACY", "address": "0x…", "region": 1, "label": "Pharmacy A" }]
 * Skips addresses that already hold the role. Run from the admin (deployer) account.
 */
async function main() {
  const { ethers, network } = hre;
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", `${network.name}.json`)));
  const file = path.join(__dirname, "..", "config", `actors.${network.name}.json`);
  if (!fs.existsSync(file)) throw new Error(`Create ${path.relative(process.cwd(), file)} first (see config/actors.example.json)`);
  const actors = JSON.parse(fs.readFileSync(file));
  const [admin] = await ethers.getSigners();
  const roles = new ethers.Contract(dep.contracts.roles.address, dep.contracts.roles.abi, admin);
  for (const a of actors) {
    const role = ethers.id(a.role);
    if (await roles.hasRole(role, a.address)) {
      console.log(`  = ${a.role.padEnd(12)} ${a.address} ${a.label ?? ""}`);
      continue;
    }
    await (await roles.registerActor(a.address, role, a.region ?? 0)).wait();
    console.log(`  + ${a.role.padEnd(12)} ${a.address} ${a.label ?? ""}`);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
