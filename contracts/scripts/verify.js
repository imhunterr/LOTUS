const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

/**
 * Verifies every LOTUS contract on the block explorer (Polygonscan for Amoy) from
 * deployments/<network>.json. Usage: npx hardhat run scripts/verify.js --network amoy
 */
async function verify(address, constructorArguments, extra = {}) {
  try {
    await hre.run("verify:verify", { address, constructorArguments, ...extra });
  } catch (e) {
    if (/already verified/i.test(e.message)) console.log(`  already verified: ${address}`);
    else console.warn(`  could not verify ${address}: ${e.message}`);
  }
}

async function main() {
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", `${hre.network.name}.json`)));
  await verify(dep.poseidonT3, [], { contract: "poseidon-solidity/PoseidonT3.sol:PoseidonT3" });
  if (!dep.mockVerifier) await verify(dep.verifier, [], { contract: "contracts/privacy/Groth16Verifier.sol:Groth16Verifier" });
  for (const [key, c] of Object.entries(dep.contracts)) {
    console.log(`Verifying ${c.name}…`);
    const args = key === "signals" ? [...c.args.slice(0, 3), Number(c.args[3])] : c.args;
    const extra = key === "dispenses" ? { libraries: { "poseidon-solidity/PoseidonT3.sol:PoseidonT3": dep.poseidonT3 } } : {};
    await verify(c.address, args, extra);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
