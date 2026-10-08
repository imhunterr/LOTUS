const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

/**
 * Feature G: stages real openFDA recall events on the local chain so they can be replayed live.
 * For every event with parseable lot numbers it registers those exact lots under the event's NDC,
 * plus one unaffected "control" lot of the same drug, moves stock to the pharmacies and dispenses to
 * synthetic patients. The regulator dashboard's replay panel then recalls exactly the named lots, and
 * shows how many patients drug-code matching would have alerted instead.
 *
 * REPLAY_RECALL=1 also issues the recalls here and prints the comparison (used for the report).
 * Run after deploy + seed:  npm run stage-fda -w contracts
 */
async function main() {
  const { ethers } = hre;
  const sdk = await import("@lotus/sdk");
  const root = path.join(__dirname, "..", "..");
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", `${hre.network.name}.json`)));
  const feed = JSON.parse(fs.readFileSync(path.join(root, "apps", "web", "src", "generated", "fda-replay.json")));
  const [, mfr, dist, pharmA, pharmB, pharmC, doctor, regulator] = await ethers.getSigners();
  const at = (k, s) => new ethers.Contract(dep.contracts[k].address, dep.contracts[k].abi, s);
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  const pharmacies = [pharmA, pharmB, pharmC];
  const custody = at("custody", mfr);
  const batches = at("batches", mfr);
  const rx = at("prescriptions", doctor);
  const PER_LOT = 6;

  const summary = [];
  for (const ev of feed.events.slice(0, 8)) {
    const ndc = sdk.eventNdc(ev);
    const recalled = sdk.parseLotNumbers(ev.code_info);
    if (!recalled.length) continue;
    const lots = [...recalled, `${recalled[0]}-CTRL`];
    for (const lot of lots) {
      const key = await batches.lotKeyOf(ndc, lot);
      if (await batches.exists(key)) continue;
      await (await batches.registerLot(ndc, lot, now + 400 * 86400, ethers.id(`coa:${ev.recall_number}:${lot}`), PER_LOT * 3 * 10)).wait();
      let sid = Number(await custody.shipmentCount());
      await (await custody.ship(key, dist.address, PER_LOT * 3 * 10, ethers.id(ev.recall_number))).wait();
      await (await custody.connect(dist).accept(sid++)).wait();
      for (const p of pharmacies) {
        await (await custody.connect(dist).ship(key, p.address, PER_LOT * 10, ethers.id(ev.recall_number))).wait();
        await (await custody.connect(p).accept(sid++)).wait();
      }
      for (let i = 0; i < PER_LOT; i++) {
        const { permitSecret, holderCommit } = sdk.newPermit();
        const permitId = await rx.permitCount();
        await (await rx.issue(holderCommit, ndc, 10, now + 30 * 86400)).wait();
        await (await at("dispenses", pharmacies[i % 3]).dispense({
          lotKey: key, permitId, permitSecret, qty: 10, commitment: sdk.commitmentAt(sdk.newPatientSecret(), 0), shipmentRef: ethers.ZeroHash,
        })).wait();
      }
    }
    const row = { recall: ev.recall_number, ndc, classification: ev.classification, recalledLots: recalled, controlLot: lots.at(-1) };
    if (process.env.REPLAY_RECALL) {
      const recalls = at("recalls", regulator);
      for (const lot of recalled) {
        const key = await batches.lotKeyOf(ndc, lot);
        if (!(await recalls.isRecalled(key))) await (await recalls.issueRecall(key, sdk.CLASSIFICATION[ev.classification] || 2, ethers.id(ev.recall_number), false)).wait();
      }
      row.patientsAlertedByLotus = recalled.length * PER_LOT;
      row.patientsAlertedByNdcMatching = lots.length * PER_LOT;
    }
    summary.push(row);
    console.log(`${ev.recall_number}: staged ${recalled.join(", ")} + control under ${ndc}`);
  }
  const out = path.join(root, "pipeline", "data", "out");
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "fda-replay-summary.json"), JSON.stringify({ sample: !!feed.sample, events: summary }, null, 2));
  if (feed.sample) console.log("Note: these are the illustrative sample events. Run pipeline/openfda.py for real ones.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
