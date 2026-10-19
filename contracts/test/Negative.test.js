const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { fixture, registerLot, supply, issuePermit, dispenseReq, now, NDC, DAY, ZERO32, FAKE_PROOF, ROLE } = require("./helpers");

/** Every guarded path, attempted by the wrong actor or with bad input (P3: negative tests). */
describe("Negative paths and access control", () => {
  describe("RoleRegistry / admin", () => {
    it("rejects reserved roles, non-admin registration and re-wiring", async () => {
      const f = await loadFixture(fixture);
      await expect(f.roles.registerActor(f.stranger.address, ethers.ZeroHash, 0)).to.be.revertedWith("RoleRegistry: reserved role");
      await expect(f.roles.registerActor(f.stranger.address, ethers.id("SYSTEM"), 0)).to.be.revertedWith("RoleRegistry: reserved role");
      await expect(f.roles.connect(f.stranger).registerActor(f.stranger.address, ROLE.PHARMACY, 0)).to.be.reverted;
      await expect(f.roles.connect(f.stranger).registerSystemContract(f.stranger.address)).to.be.reverted;
      await expect(f.dispenses.connect(f.stranger).setRecallRegistry(f.recalls)).to.be.revertedWithCustomError(f.dispenses, "Unauthorized");
      await expect(f.dispenses.setRecallRegistry(f.recalls)).to.be.revertedWith("Dispense: already set");
    });
  });

  describe("BatchRegistry", () => {
    it("validates lot input and exposes views", async () => {
      const f = await loadFixture(fixture);
      const exp = (await now()) + DAY;
      await expect(f.batches.connect(f.mfr).registerLot("", "L", exp, ZERO32, 1)).to.be.revertedWith("Batch: empty id");
      await expect(f.batches.connect(f.mfr).registerLot(NDC, "", exp, ZERO32, 1)).to.be.revertedWith("Batch: empty id");
      await expect(f.batches.connect(f.mfr).registerLot(NDC, "L", 1, ZERO32, 1)).to.be.revertedWith("Batch: already expired");
      await expect(f.batches.connect(f.mfr).registerLot(NDC, "L", exp, ZERO32, 0)).to.be.revertedWith("Batch: zero units");
      await expect(f.batches.getLot(ZERO32)).to.be.revertedWith("Batch: unknown lot");
      const key = await registerLot(f);
      expect(await f.batches.lotCount()).to.equal(1);
      expect(await f.batches.ndcHashOf(key)).to.equal(ethers.id(NDC));
      expect(await f.batches.isExpired(key)).to.equal(false);
    });
  });

  describe("CustodyLedger", () => {
    it("guards shipments", async () => {
      const f = await loadFixture(fixture);
      const key = await registerLot(f, { units: 50 });
      await expect(f.custody.connect(f.stranger).ship(key, f.dist.address, 1, ZERO32)).to.be.revertedWith("Custody: sender role");
      await expect(f.custody.connect(f.mfr).ship(key, f.dist.address, 0, ZERO32)).to.be.revertedWith("Custody: insufficient stock");
      await f.custody.connect(f.mfr).ship(key, f.dist.address, 10, ZERO32);
      await expect(f.custody.connect(f.pharmA).reject(0)).to.be.revertedWith("Custody: not recipient");
      await f.custody.connect(f.dist).accept(0);
      await expect(f.custody.connect(f.dist).accept(0)).to.be.revertedWith("Custody: not pending");
      await expect(f.custody.connect(f.dist).reject(0)).to.be.revertedWith("Custody: not pending");
      expect((await f.custody.getShipment(0)).status).to.equal(2);
      await expect(f.custody.connect(f.mfr).recordDispense(f.pharmA.address, key, 1)).to.be.revertedWithCustomError(f.custody, "Unauthorized");
      await expect(f.custody.connect(f.mfr).mintToManufacturer(key, f.mfr.address, 1)).to.be.revertedWithCustomError(f.custody, "Unauthorized");
    });

    it("a rejected pharmacy return gives the units back to the pharmacy's book", async () => {
      const f = await loadFixture(fixture);
      const key = await registerLot(f);
      await supply(f, key, f.pharmA, 10);
      const id = await f.custody.shipmentCount();
      await f.custody.connect(f.pharmA).returnToSupplier(key, f.dist.address, 4, ZERO32);
      await f.custody.connect(f.dist).reject(id);
      const b = await f.custody.bookOf(f.pharmA.address, key);
      expect(b.returned).to.equal(0);
      expect(await f.custody.onHand(key, f.pharmA.address)).to.equal(10);
      await expect(f.custody.connect(f.pharmA).reportShrinkage(key, 0, ZERO32)).to.be.revertedWith("Custody: closure violated");
      await expect(f.custody.connect(f.pharmA).ship(key, f.pharmB.address, 11, ZERO32)).to.be.revertedWith("Custody: insufficient stock");
    });
  });

  describe("PrescriptionRegistry", () => {
    it("validates issuing, expiry and transfers", async () => {
      const f = await loadFixture(fixture);
      const exp = (await now()) + DAY;
      const c = ethers.id("x");
      await expect(f.prescriptions.connect(f.doctor).issue(ZERO32, NDC, 1, exp)).to.be.revertedWith("Rx: empty commit");
      await expect(f.prescriptions.connect(f.doctor).issue(c, NDC, 0, exp)).to.be.revertedWith("Rx: zero qty");
      await expect(f.prescriptions.connect(f.doctor).issue(c, NDC, 1, 1)).to.be.revertedWith("Rx: expired");
      await expect(f.prescriptions.connect(f.doctor).redeem(0, 1, f.pharmA.address, ZERO32, ZERO32)).to.be.revertedWithCustomError(f.prescriptions, "Unauthorized");

      const key = await registerLot(f);
      await supply(f, key, f.pharmA, 50);
      const permit = await issuePermit(f, { qty: 2 });
      await expect(f.prescriptions.connect(f.pharmA).transferPermit(permit.permitId, f.pharmB.address)).to.be.revertedWith("Rx: not current pharmacy");
      await f.dispenses.connect(f.pharmA).dispense(dispenseReq(key, permit, 1));
      await expect(f.prescriptions.connect(f.pharmA).transferPermit(permit.permitId, f.stranger.address)).to.be.revertedWith("Rx: recipient not pharmacy");
      await f.dispenses.connect(f.pharmA).dispense(dispenseReq(key, permit, 1));
      await expect(f.prescriptions.connect(f.pharmA).transferPermit(permit.permitId, f.pharmB.address)).to.be.revertedWith("Rx: exhausted");

      const late = await issuePermit(f);
      await time.increase(31 * DAY);
      await expect(f.dispenses.connect(f.pharmA).dispense(dispenseReq(key, late, 1))).to.be.revertedWith("Rx: permit expired");
    });
  });

  describe("DispenseLedger", () => {
    it("rejects unknown, expired lots and out-of-field commitments", async () => {
      const f = await loadFixture(fixture);
      const permit = await issuePermit(f);
      await expect(f.dispenses.connect(f.pharmA).dispense(dispenseReq(ethers.id("nope"), permit, 1))).to.be.revertedWith("Dispense: unknown lot");
      const key = await registerLot(f);
      await supply(f, key, f.pharmA, 5);
      await expect(f.dispenses.connect(f.pharmA).dispense(dispenseReq(key, permit, 1, 0n))).to.be.revertedWith("Dispense: bad commitment");
      const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
      await expect(f.dispenses.connect(f.pharmA).dispense(dispenseReq(key, permit, 1, FIELD))).to.be.revertedWith("Dispense: bad commitment");
      expect(await f.dispenses.isKnownRoot(key, 0)).to.equal(false);
      await time.increase(366 * DAY);
      await expect(f.dispenses.connect(f.pharmA).dispense(dispenseReq(key, permit, 1))).to.be.revertedWith("Dispense: lot expired");
    });
  });

  describe("RecallRegistry", () => {
    it("validates recalls and views", async () => {
      const f = await loadFixture(fixture);
      await expect(f.recalls.connect(f.regulator).issueRecall(ethers.id("nope"), 1, ZERO32, false)).to.be.revertedWith("Recall: unknown lot");
      const key = await registerLot(f);
      await expect(f.recalls.connect(f.regulator).issueRecall(key, 0, ZERO32, false)).to.be.revertedWith("Recall: no class");
      await expect(f.recalls.recallIdOf(key)).to.be.revertedWith("Recall: not recalled");
      await f.recalls.connect(f.regulator).issueRecall(key, 3, ethers.id("why"), true);
      expect(await f.recalls.recallCount()).to.equal(1);
      expect(await f.recalls.recallIdOf(key)).to.equal(0);
      const r = await f.recalls.getRecall(0);
      expect([r.classification, r.fromCrowdSignal]).to.deep.equal([3n, true]);
      expect(await f.recalls.affectedCount(0, 1)).to.deep.equal([0n, false]);
    });
  });

  describe("AnonymousSignals", () => {
    it("validates severity, action and handles recalls with no dispenses", async () => {
      const f = await loadFixture(fixture);
      const key = await registerLot(f);
      await supply(f, key, f.pharmA, 5);
      await f.dispenses.connect(f.pharmA).dispense(dispenseReq(key, await issuePermit(f), 1));
      const root = await f.dispenses.currentRoot(key);
      await expect(f.signals.reportAdverseEvent(key, root, 1n, 0, ZERO32, FAKE_PROOF)).to.be.revertedWith("Signals: severity 1-5");
      await expect(f.signals.reportAdverseEvent(key, root, 1n, 6, ZERO32, FAKE_PROOF)).to.be.revertedWith("Signals: severity 1-5");
      await f.recalls.connect(f.regulator).issueRecall(key, 1, ZERO32, false);
      await expect(f.signals.acknowledgeRecall(0, root, 1n, 0, FAKE_PROOF)).to.be.revertedWith("Signals: no action");

      const empty = await registerLot(f, { lot: "EMPTY" });
      await f.recalls.connect(f.regulator).issueRecall(empty, 2, ZERO32, false);
      expect(await f.signals.recallEffectivenessBps(1)).to.equal(0);
    });

    it("raises a safety signal only once", async () => {
      const f = await loadFixture(fixture);
      const key = await registerLot(f);
      await supply(f, key, f.pharmA, 5);
      await f.dispenses.connect(f.pharmA).dispense(dispenseReq(key, await issuePermit(f), 1));
      const root = await f.dispenses.currentRoot(key);
      for (let n = 1n; n <= 3n; n++) await f.signals.reportAdverseEvent(key, root, n, 2, ZERO32, FAKE_PROOF);
      await expect(f.signals.reportAdverseEvent(key, root, 4n, 2, ZERO32, FAKE_PROOF)).to.not.emit(f.signals, "SafetySignal");
    });
  });

  describe("LotTree root history", () => {
    it("forgets roots older than 32 inserts", async () => {
      const f = await loadFixture(fixture);
      const key = await registerLot(f);
      await supply(f, key, f.pharmA, 40);
      await f.dispenses.connect(f.pharmA).dispense(dispenseReq(key, await issuePermit(f), 1));
      const first = await f.dispenses.currentRoot(key);
      for (let i = 0; i < 32; i++) await f.dispenses.connect(f.pharmA).dispense(dispenseReq(key, await issuePermit(f, { qty: 1 }), 1));
      expect(await f.dispenses.isKnownRoot(key, first)).to.equal(false);
      expect(await f.dispenses.leafCount(key)).to.equal(33);
    });
  });
});
