const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { fixture, registerLot, supply, issuePermit, ZERO32 } = require("./helpers");

describe("End to end: prescribe → ship → dispense → recall → patient self-identifies", () => {
  it("only the patient who received the recalled lot is notified, and Guardians restore that", async () => {
    const sdk = await import("@lotus/sdk");
    const f = await loadFixture(fixture);
    const badLot = await registerLot(f, { lot: "BAD-01" });
    const goodLot = await registerLot(f, { lot: "GOOD-02" });
    await supply(f, badLot, f.pharmA, 10);
    await supply(f, goodLot, f.pharmA, 10);

    const alice = sdk.newPatientSecret();
    const bob = sdk.newPatientSecret();
    const give = async (secret, index, lotKey) => {
      const permit = await issuePermit(f, { qty: 1 });
      const commitment = sdk.commitmentAt(secret, index); // what the counter QR carries
      await f.dispenses.connect(f.pharmA).dispense({ lotKey, ...permit, qty: 1, commitment, shipmentRef: ZERO32 });
    };
    await give(alice, 0, badLot);
    await give(bob, 0, goodLot); // same drug (NDC), different lot → NDC matching would flag Bob too

    await f.recalls.connect(f.regulator).issueRecall(badLot, 1, ZERO32, false);

    const events = (await f.dispenses.queryFilter(f.dispenses.filters.Dispensed())).map((e) => ({
      lotKey: e.args.lotKey, commitment: e.args.commitment, leafIndex: Number(e.args.leafIndex),
    }));
    const recalled = new Set([badLot]);
    expect(sdk.matchRecalls(alice, events, recalled).affected).to.have.length(1);
    expect(sdk.matchRecalls(bob, events, recalled).affected).to.have.length(0); // no false positive

    // Alice loses her phone: pharmacy + prescriber shares recover full matching ability.
    const [, pharmacyShare, prescriberShare] = await sdk.splitSecret(alice);
    const recovered = await sdk.recoverSecret([pharmacyShare, prescriberShare]);
    expect(sdk.matchRecalls(recovered, events, recalled).affected).to.have.length(1);
  });
});
