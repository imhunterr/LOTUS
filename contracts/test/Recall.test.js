const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { fixture, registerLot, supply, issuePermit, dispenseReq, ZERO32 } = require("./helpers");

describe("RecallRegistry (I5 + k-anonymous aggregates)", () => {
  async function withDispenses() {
    const f = await loadFixture(fixture);
    const lotKey = await registerLot(f);
    await supply(f, lotKey, f.pharmA, 100);
    await supply(f, lotKey, f.pharmB, 100);
    await f.dispenses.connect(f.pharmA).dispense(dispenseReq(lotKey, await issuePermit(f), 30)); // region 1: 30 units
    await f.dispenses.connect(f.pharmB).dispense(dispenseReq(lotKey, await issuePermit(f), 3)); // region 2: 3 units
    return { f, lotKey };
  }

  it("only regulators recall, and a lot is recalled once (immutable)", async () => {
    const { f, lotKey } = await withDispenses();
    await expect(f.recalls.connect(f.pharmA).issueRecall(lotKey, 1, ZERO32, false)).to.be.revertedWithCustomError(f.recalls, "Unauthorized");
    await expect(f.recalls.connect(f.regulator).issueRecall(lotKey, 1, ZERO32, false)).to.emit(f.recalls, "RecallIssued");
    await expect(f.recalls.connect(f.regulator).issueRecall(lotKey, 2, ZERO32, false)).to.be.revertedWith("Recall: already recalled");
  });

  it("a recalled lot can no longer be dispensed", async () => {
    const { f, lotKey } = await withDispenses();
    await f.recalls.connect(f.regulator).issueRecall(lotKey, 1, ZERO32, false);
    await expect(f.dispenses.connect(f.pharmA).dispense(dispenseReq(lotKey, await issuePermit(f), 1))).to.be.revertedWith(
      "Dispense: lot recalled"
    );
  });

  it("suppresses regions below K=5 so small counts can't identify a patient", async () => {
    const { f, lotKey } = await withDispenses();
    await f.recalls.connect(f.regulator).issueRecall(lotKey, 1, ZERO32, false);
    expect(await f.recalls.affectedCount(0, 1)).to.deep.equal([30n, false]);
    expect(await f.recalls.affectedCount(0, 2)).to.deep.equal([0n, true]);
    expect(await f.recalls.totalAffected(0)).to.equal(33);
  });
});
