const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");
const { deployLotus, ROLE } = require("./deploy-lib");

/**
 * P5 gas benchmark: gas of every operation, and of `dispense` as a lot's tree grows to N leaves.
 * Writes pipeline/data/out/gas_dispense.csv and gas_ops.json.  N defaults to 1024 (BENCH_N).
 */
async function main() {
  const N = Number(process.env.BENCH_N || 1024);
  const [admin, mfr, pharm, doctor, regulator] = await ethers.getSigners();
  const c = await deployLotus({ admin, verifier: await (await ethers.deployContract("Groth16Verifier")).getAddress() });
  for (const [s, r] of [[mfr, "MANUFACTURER"], [pharm, "PHARMACY"], [doctor, "PRESCRIBER"], [regulator, "REGULATOR"]]) await c.roles.registerActor(s.address, ROLE[r], 1);
  const sdk = await import("@lotus/sdk");
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  const gas = async (txp) => Number((await (await txp).wait()).gasUsed);

  const ops = {};
  ops.registerLot = await gas(c.batches.connect(mfr).registerLot("0002-1433-80", "BENCH", now + 1e7, ethers.ZeroHash, N + 10));
  const lotKey = await c.batches.lotKeyOf("0002-1433-80", "BENCH");
  ops.ship = await gas(c.custody.connect(mfr).ship(lotKey, pharm.address, N + 10, ethers.ZeroHash));
  ops.accept = await gas(c.custody.connect(pharm).accept(0));

  const rows = ["leaf_index,gas"];
  for (let i = 0; i < N; i++) {
    const { permitSecret, holderCommit } = sdk.newPermit();
    const g = await gas(c.prescriptions.connect(doctor).issue(holderCommit, "0002-1433-80", 1, now + 1e6));
    if (i === 0) ops.issuePermit = g;
    const d = await gas(c.dispenses.connect(pharm).dispense({ lotKey, permitId: i, permitSecret, qty: 1, commitment: BigInt(i + 1), shipmentRef: ethers.ZeroHash }));
    rows.push(`${i},${d}`);
  }
  ops.issueRecall = await gas(c.recalls.connect(regulator).issueRecall(lotKey, 1, ethers.ZeroHash, false));
  const ds = rows.slice(1).map((r) => Number(r.split(",")[1]));
  ops.dispenseMean = Math.round(ds.reduce((a, b) => a + b, 0) / ds.length);
  ops.dispenseMax = Math.max(...ds);
  ops.dispenseMin = Math.min(...ds);

  const out = path.join(__dirname, "..", "..", "pipeline", "data", "out");
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "gas_dispense.csv"), rows.join("\n") + "\n");
  fs.writeFileSync(path.join(out, "gas_ops.json"), JSON.stringify(ops, null, 2));
  console.log(ops);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
