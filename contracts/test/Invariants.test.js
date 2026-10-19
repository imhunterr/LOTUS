const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { fixture, registerLot, issuePermit, dispenseReq, ZERO32 } = require("./helpers");

/**
 * Property test: fire a random sequence of (often hostile) operations and check after every step
 * that closure (I1) and permit non-negativity (I3) hold for every pharmacy × lot.
 * Seeded PRNG so failures are reproducible: SEED=123 npx hardhat test
 */
function prng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

describe("Invariant fuzzing (I1 closure, I3 permits)", () => {
  it("holds under 150 random operations", async function () {
    this.timeout(180_000);
    const f = await loadFixture(fixture);
    const rand = prng(Number(process.env.SEED || 42));
    const pick = (arr) => arr[Math.floor(rand() * arr.length)];
    const pharmacies = [f.pharmA, f.pharmB, f.pharmC];
    const lots = [await registerLot(f, { lot: "L1" }), await registerLot(f, { lot: "L2" })];
    for (const l of lots) await f.custody.connect(f.mfr).ship(l, f.dist.address, 1000, ZERO32);
    await f.custody.connect(f.dist).accept(0);
    await f.custody.connect(f.dist).accept(1);
    const permits = [];

    const ops = [
      async () => { // distributor ships; pharmacy accepts most of the time
        const p = pick(pharmacies);
        const id = await f.custody.shipmentCount();
        await f.custody.connect(f.dist).ship(pick(lots), p.address, 1 + Math.floor(rand() * 20), ZERO32);
        if (rand() < 0.8) await f.custody.connect(p).accept(id);
      },
      async () => permits.push(await issuePermit(f, { qty: 1 + Math.floor(rand() * 15) })),
      async () => { // dispense random qty — frequently over-asks
        if (!permits.length) return;
        await f.dispenses.connect(pick(pharmacies)).dispense(dispenseReq(pick(lots), pick(permits), 1 + Math.floor(rand() * 25)));
      },
      async () => f.custody.connect(pick(pharmacies)).reportShrinkage(pick(lots), 1 + Math.floor(rand() * 5), ZERO32),
      async () => f.custody.connect(pick(pharmacies)).returnToSupplier(pick(lots), f.dist.address, 1 + Math.floor(rand() * 5), ZERO32),
    ];

    let reverted = 0;
    for (let step = 0; step < 150; step++) {
      try { await pick(ops)(); } catch { reverted++; }
      for (const p of pharmacies) for (const l of lots) {
        const b = await f.custody.bookOf(p.address, l);
        expect(b.dispensed + b.returned + b.shrinkage).to.be.lte(b.inbound, "I1 closure");
        expect(await f.custody.onHand(l, p.address)).to.equal(b.inbound - b.dispensed - b.returned - b.shrinkage);
      }
    }
    for (const p of permits) expect((await f.prescriptions.getPermit(p.permitId)).balance).to.be.gte(0);
    expect(reverted).to.be.greaterThan(0); // hostile ops really were attempted and rejected
  });
});
