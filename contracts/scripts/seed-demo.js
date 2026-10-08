const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const { ROLE } = require("./deploy-lib");

/**
 * Seeds a running local chain (after `npm run deploy:local`) with a story you can click through:
 *   - 1 manufacturer, 1 distributor, 3 pharmacies in 2 regions, 1 prescriber, 1 regulator
 *   - two lots of the same drug (same NDC) — only one will be recalled
 *   - 12 dispenses, patient #0 is "you" in the patient app (secret written to demo-patient.json)
 */
async function main() {
  const { ethers } = hre;
  const sdk = await import("@lotus/sdk");
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", `${hre.network.name}.json`)));
  const [admin, mfr, dist, pharmA, pharmB, pharmC, doctor, regulator] = await ethers.getSigners();
  const at = (k, signer) => new ethers.Contract(dep.contracts[k].address, dep.contracts[k].abi, signer);
  const ZERO = ethers.ZeroHash;
  const now = (await ethers.provider.getBlock("latest")).timestamp;

  const roles = at("roles", admin);
  const actors = [
    [mfr, "MANUFACTURER", 0], [dist, "DISTRIBUTOR", 0], [pharmA, "PHARMACY", 1], [pharmB, "PHARMACY", 1],
    [pharmC, "PHARMACY", 2], [doctor, "PRESCRIBER", 1], [regulator, "REGULATOR", 0],
  ];
  for (const [s, r, region] of actors) await (await roles.registerActor(s.address, ROLE[r], region)).wait();

  const NDC = "0002-1433-80";
  const lots = ["D298765", "D298766"];
  const batches = at("batches", mfr);
  const custody = at("custody", mfr);
  for (const lot of lots) await (await batches.registerLot(NDC, lot, now + 400 * 86400, ethers.id(`coa:${lot}`), 500)).wait();
  const keys = await Promise.all(lots.map((l) => batches.lotKeyOf(NDC, l)));

  let sid = Number(await custody.shipmentCount());
  for (const k of keys) {
    await (await custody.ship(k, dist.address, 300, ethers.id("manifest"))).wait();
    await (await custody.connect(dist).accept(sid++)).wait();
    for (const p of [pharmA, pharmB, pharmC]) {
      await (await custody.connect(dist).ship(k, p.address, 80, ethers.id("manifest"))).wait();
      await (await custody.connect(p).accept(sid++)).wait();
    }
  }

  const rx = at("prescriptions", doctor);
  const patients = Array.from({ length: 12 }, () => sdk.newPatientSecret());
  const pharmacies = [pharmA, pharmB, pharmC];
  for (let i = 0; i < patients.length; i++) {
    const { permitSecret, holderCommit } = sdk.newPermit();
    const permitId = await rx.permitCount();
    await (await rx.issue(holderCommit, NDC, 30, now + 30 * 86400)).wait();
    const p = pharmacies[i % 3];
    await (await at("dispenses", p).dispense({
      lotKey: keys[i % 2], permitId, permitSecret, qty: 30, commitment: sdk.commitmentAt(patients[i], 0), shipmentRef: ZERO,
    })).wait();
  }

  const shares = await sdk.splitSecret(patients[0]);
  const demo = { secret: patients[0].toString(), nextIndex: 1, guardianShares: shares, recalledLotHint: lots[0] };
  fs.writeFileSync(path.join(__dirname, "..", "..", "apps", "web", "src", "generated", "demo-patient.json"), JSON.stringify(demo, null, 2));

  console.log("Seeded: 7 actors, 2 lots, 12 dispenses. Demo patient received lot", lots[0]);
  console.log("Next: open the Regulator dashboard and recall lot", lots[0]);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
