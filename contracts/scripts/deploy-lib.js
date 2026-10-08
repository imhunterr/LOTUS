const { ethers } = require("hardhat");

const ROLE = Object.fromEntries(
  ["MANUFACTURER", "DISTRIBUTOR", "PHARMACY", "PRESCRIBER", "REGULATOR"].map((r) => [r, ethers.id(r)])
);

/**
 * Deploys and wires the full LOTUS suite. Shared by tests, the local deploy script and the demo seeder.
 * @param {{ admin: import("ethers").Signer, verifier?: string, safetySignalThreshold?: number }} opts
 */
async function deployLotus({ admin, verifier, safetySignalThreshold = 3 }) {
  const poseidon = await (await ethers.getContractFactory("PoseidonT3", admin)).deploy();
  const libs = { libraries: { "poseidon-solidity/PoseidonT3.sol:PoseidonT3": await poseidon.getAddress() } };

  const roles = await ethers.deployContract("RoleRegistry", [admin.address], admin);
  const custody = await ethers.deployContract("CustodyLedger", [roles], admin);
  const batches = await ethers.deployContract("BatchRegistry", [roles, custody], admin);
  const prescriptions = await ethers.deployContract("PrescriptionRegistry", [roles], admin);
  const dispenses = await (await ethers.getContractFactory("DispenseLedger", { signer: admin, ...libs })).deploy(
    roles, batches, custody, prescriptions
  );
  const recalls = await ethers.deployContract("RecallRegistry", [roles, batches, dispenses], admin);

  if (!verifier) verifier = await (await ethers.deployContract("MockMembershipVerifier", [], admin)).getAddress();
  const signals = await ethers.deployContract(
    "AnonymousSignals", [dispenses, recalls, verifier, safetySignalThreshold], admin
  );

  await (await dispenses.setRecallRegistry(recalls)).wait();
  for (const c of [batches, dispenses]) await (await roles.registerSystemContract(c)).wait();

  return { roles, custody, batches, prescriptions, dispenses, recalls, signals, verifier, poseidon };
}

module.exports = { deployLotus, ROLE };
