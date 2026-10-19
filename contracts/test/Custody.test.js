const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { fixture, registerLot, supply, ZERO32 } = require("./helpers");

describe("Batch + Custody (two-sided chain of custody)", () => {
  it("only manufacturers can register lots, and registration mints custody", async () => {
    const f = await loadFixture(fixture);
    await expect(f.batches.connect(f.stranger).registerLot("x", "y", 9999999999, ZERO32, 1)).to.be.revertedWithCustomError(
      f.batches, "Unauthorized"
    );
    const key = await registerLot(f, { units: 500 });
    expect(await f.custody.onHand(key, f.mfr.address)).to.equal(500);
    await expect(registerLot(f)).to.be.revertedWith("Batch: lot exists");
  });

  it("a pending shipment does not count as received until the pharmacy accepts", async () => {
    const f = await loadFixture(fixture);
    const key = await registerLot(f);
    await f.custody.connect(f.mfr).ship(key, f.pharmA.address, 100, ZERO32);
    expect(await f.custody.hasReceived(f.pharmA.address, key)).to.equal(false);
    await expect(f.custody.connect(f.stranger).accept(0)).to.be.revertedWith("Custody: not recipient");
    await f.custody.connect(f.pharmA).accept(0);
    expect((await f.custody.bookOf(f.pharmA.address, key)).inbound).to.equal(100);
  });

  it("rejecting a shipment refunds the sender", async () => {
    const f = await loadFixture(fixture);
    const key = await registerLot(f, { units: 100 });
    await f.custody.connect(f.mfr).ship(key, f.dist.address, 60, ZERO32);
    expect(await f.custody.onHand(key, f.mfr.address)).to.equal(40);
    await f.custody.connect(f.dist).reject(0);
    expect(await f.custody.onHand(key, f.mfr.address)).to.equal(100);
  });

  it("cannot ship more than on hand, to self, or to a non-supply-chain address", async () => {
    const f = await loadFixture(fixture);
    const key = await registerLot(f, { units: 10 });
    await expect(f.custody.connect(f.mfr).ship(key, f.dist.address, 11, ZERO32)).to.be.revertedWith("Custody: insufficient stock");
    await expect(f.custody.connect(f.mfr).ship(key, f.mfr.address, 1, ZERO32)).to.be.revertedWith("Custody: self shipment");
    await expect(f.custody.connect(f.mfr).ship(key, f.stranger.address, 1, ZERO32)).to.be.revertedWith("Custody: recipient role");
  });

  it("shrinkage and returns count against closure", async () => {
    const f = await loadFixture(fixture);
    const key = await registerLot(f);
    await supply(f, key, f.pharmA, 10);
    await f.custody.connect(f.pharmA).reportShrinkage(key, 4, ZERO32);
    await f.custody.connect(f.pharmA).returnToSupplier(key, f.dist.address, 6, ZERO32);
    await expect(f.custody.connect(f.pharmA).reportShrinkage(key, 1, ZERO32)).to.be.revertedWith("Custody: closure violated");
    const b = await f.custody.bookOf(f.pharmA.address, key);
    expect([b.inbound, b.shrinkage, b.returned]).to.deep.equal([10n, 4n, 6n]);
  });
});
