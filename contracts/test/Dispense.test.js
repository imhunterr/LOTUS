const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { fixture, registerLot, supply, issuePermit, dispenseReq, NDC, ZERO32 } = require("./helpers");

describe("DispenseLedger (invariants I1–I4)", () => {
  async function ready() {
    const f = await loadFixture(fixture);
    const lotKey = await registerLot(f);
    await supply(f, lotKey, f.pharmA, 50);
    return { f, lotKey };
  }

  it("writes a split record and emits only pseudonymous data", async () => {
    const { f, lotKey } = await ready();
    const permit = await issuePermit(f, { qty: 30 });
    const pseudo = await f.roles.pseudonymOf(f.pharmA.address);
    await expect(f.dispenses.connect(f.pharmA).dispense(dispenseReq(lotKey, permit, 30, 777n)))
      .to.emit(f.dispenses, "Dispensed")
      .withArgs(lotKey, pseudo, 1, 30, 777n, 0, (r) => r > 0n, ZERO32);
    expect(await f.dispenses.verifyCommit(777n)).to.equal(true);
    expect((await f.custody.bookOf(f.pharmA.address, lotKey)).dispensed).to.equal(30);
  });

  it("on-chain Poseidon tree matches the SDK tree (patients can build proofs)", async () => {
    const { LotMerkleTree } = await import("@lotus/sdk");
    const { f, lotKey } = await ready();
    const leaves = [11n, 22n, 33n];
    for (const leaf of leaves) await f.dispenses.connect(f.pharmA).dispense(dispenseReq(lotKey, await issuePermit(f, { qty: 1 }), 1, leaf));
    const tree = new LotMerkleTree(leaves);
    expect(await f.dispenses.currentRoot(lotKey)).to.equal(tree.root);
    expect(await f.dispenses.isKnownRoot(lotKey, tree.root)).to.equal(true);
  });

  it("I1 closure: cannot dispense more than received", async () => {
    const { f, lotKey } = await ready();
    const permit = await issuePermit(f, { qty: 100 });
    await expect(f.dispenses.connect(f.pharmA).dispense(dispenseReq(lotKey, permit, 51))).to.be.revertedWith("Custody: closure violated");
  });

  it("I2 eligibility: pharmacy that never received the lot cannot dispense it", async () => {
    const { f, lotKey } = await ready();
    const permit = await issuePermit(f);
    await expect(f.dispenses.connect(f.pharmB).dispense(dispenseReq(lotKey, permit, 1))).to.be.revertedWith("Custody: lot never received");
  });

  it("I3 permits: partial fills, balance, wrong drug, pharmacy binding and transfer", async () => {
    const { f, lotKey } = await ready();
    await supply(f, lotKey, f.pharmB, 50);
    const permit = await issuePermit(f, { qty: 20 });
    await f.dispenses.connect(f.pharmA).dispense(dispenseReq(lotKey, permit, 15));
    await expect(f.dispenses.connect(f.pharmA).dispense(dispenseReq(lotKey, permit, 6))).to.be.revertedWith("Rx: insufficient balance");
    await expect(f.dispenses.connect(f.pharmB).dispense(dispenseReq(lotKey, permit, 1))).to.be.revertedWith("Rx: bound to another pharmacy");
    await f.prescriptions.connect(f.pharmA).transferPermit(permit.permitId, f.pharmB.address);
    await expect(f.dispenses.connect(f.pharmB).dispense(dispenseReq(lotKey, permit, 5)))
      .to.emit(f.prescriptions, "PermitExhausted").withArgs(permit.permitId);

    const wrong = await issuePermit(f, { ndc: "9999-9999-99" });
    await expect(f.dispenses.connect(f.pharmA).dispense(dispenseReq(lotKey, wrong, 1))).to.be.revertedWith("Rx: wrong drug");
    const bad = { ...(await issuePermit(f)), permitSecret: ZERO32 };
    await expect(f.dispenses.connect(f.pharmA).dispense(dispenseReq(lotKey, bad, 1))).to.be.revertedWith("Rx: bad permit secret");
  });

  it("I4: a commitment can never be reused", async () => {
    const { f, lotKey } = await ready();
    await f.dispenses.connect(f.pharmA).dispense(dispenseReq(lotKey, await issuePermit(f), 1, 42n));
    await expect(f.dispenses.connect(f.pharmA).dispense(dispenseReq(lotKey, await issuePermit(f), 1, 42n))).to.be.revertedWith(
      "Dispense: commitment reused"
    );
  });

  it("access control: only pharmacies dispense, only prescribers issue", async () => {
    const { f, lotKey } = await ready();
    const permit = await issuePermit(f);
    for (const who of [f.stranger, f.doctor, f.regulator, f.mfr]) {
      await expect(f.dispenses.connect(who).dispense(dispenseReq(lotKey, permit, 1))).to.be.revertedWithCustomError(f.dispenses, "Unauthorized");
    }
    await expect(f.prescriptions.connect(f.pharmA).issue(ZERO32.replace(/0$/, "1"), NDC, 1, 9999999999)).to.be.revertedWithCustomError(
      f.prescriptions, "Unauthorized"
    );
  });
});

describe("DispenseLedger batching (timing-attack mitigation)", () => {
  it("records a whole batch in one transaction, atomically", async () => {
    const f = await loadFixture(fixture);
    const lotKey = await registerLot(f);
    await supply(f, lotKey, f.pharmA, 50);
    const reqs = [];
    for (let i = 0; i < 5; i++) reqs.push(dispenseReq(lotKey, await issuePermit(f, { qty: 2 }), 2));
    const tx = await f.dispenses.connect(f.pharmA).dispenseBatch(reqs);
    const r = await tx.wait();
    expect(r.logs.filter((l) => l.fragment?.name === "Dispensed")).to.have.length(5);
    expect(await f.dispenses.leafCount(lotKey)).to.equal(5);

    const bad = [dispenseReq(lotKey, await issuePermit(f), 1), dispenseReq(lotKey, await issuePermit(f), 1, reqs[0].commitment)];
    await expect(f.dispenses.connect(f.pharmA).dispenseBatch(bad)).to.be.revertedWith("Dispense: commitment reused");
    expect(await f.dispenses.leafCount(lotKey)).to.equal(5); // nothing from the failed batch landed
    await expect(f.dispenses.connect(f.pharmA).dispenseBatch([])).to.be.revertedWith("Dispense: batch size");
    await expect(f.dispenses.connect(f.stranger).dispenseBatch(reqs)).to.be.revertedWithCustomError(f.dispenses, "Unauthorized");
  });
});
