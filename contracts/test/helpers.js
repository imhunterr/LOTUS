const { ethers } = require("hardhat");
const { deployLotus, ROLE } = require("../scripts/deploy-lib");

const DAY = 24 * 3600;
const NDC = "0002-1433-80";
const LOT = "D298765";
const ZERO32 = ethers.ZeroHash;

async function now() {
  return (await ethers.provider.getBlock("latest")).timestamp;
}

async function fixture() {
  const [admin, mfr, dist, pharmA, pharmB, pharmC, doctor, regulator, stranger, relayer] = await ethers.getSigners();
  const c = await deployLotus({ admin });
  const reg = (who, role, region) => c.roles.registerActor(who.address, ROLE[role], region);
  await reg(mfr, "MANUFACTURER", 0);
  await reg(dist, "DISTRIBUTOR", 0);
  await reg(pharmA, "PHARMACY", 1);
  await reg(pharmB, "PHARMACY", 2);
  await reg(pharmC, "PHARMACY", 2);
  await reg(doctor, "PRESCRIBER", 1);
  await reg(regulator, "REGULATOR", 0);
  return { ...c, admin, mfr, dist, pharmA, pharmB, pharmC, doctor, regulator, stranger, relayer };
}

async function registerLot(f, { ndc = NDC, lot = LOT, units = 1000 } = {}) {
  await f.batches.connect(f.mfr).registerLot(ndc, lot, (await now()) + 365 * DAY, ZERO32, units);
  return f.batches.lotKeyOf(ndc, lot);
}

/** mfr → dist → pharmacy, both legs accepted. */
async function supply(f, lotKey, pharmacy, qty) {
  let id = await f.custody.shipmentCount();
  await f.custody.connect(f.mfr).ship(lotKey, f.dist.address, qty, ZERO32);
  await f.custody.connect(f.dist).accept(id);
  id = await f.custody.shipmentCount();
  await f.custody.connect(f.dist).ship(lotKey, pharmacy.address, qty, ZERO32);
  await f.custody.connect(pharmacy).accept(id);
}

async function issuePermit(f, { ndc = NDC, qty = 30 } = {}) {
  const permitSecret = ethers.hexlify(ethers.randomBytes(32));
  const holderCommit = ethers.keccak256(permitSecret);
  const id = await f.prescriptions.permitCount();
  await f.prescriptions.connect(f.doctor).issue(holderCommit, ndc, qty, (await now()) + 30 * DAY);
  return { permitId: id, permitSecret };
}

let commitCounter = 1n;
const freshCommitment = () => commitCounter++;

function dispenseReq(lotKey, permit, qty, commitment = freshCommitment()) {
  return {
    lotKey,
    permitId: permit.permitId,
    permitSecret: permit.permitSecret,
    qty,
    commitment,
    shipmentRef: ZERO32,
  };
}

const FAKE_PROOF = { a: [1, 0], b: [[0, 0], [0, 0]], c: [0, 0] };

module.exports = { fixture, registerLot, supply, issuePermit, dispenseReq, freshCommitment, now, NDC, LOT, DAY, ZERO32, FAKE_PROOF, ROLE };
