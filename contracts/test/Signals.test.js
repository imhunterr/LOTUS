const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { fixture, registerLot, supply, issuePermit, dispenseReq, ZERO32, FAKE_PROOF } = require("./helpers");

// Proof validity itself is checked by the Groth16 verifier generated from circuits/; these tests use
// the mock verifier and focus on roots, nullifiers, thresholds and effectiveness accounting.
describe("AnonymousSignals (A: adverse events, B: recall acknowledgements)", () => {
  async function ready() {
    const f = await loadFixture(fixture);
    const lotKey = await registerLot(f);
    await supply(f, lotKey, f.pharmA, 100);
    for (let i = 0; i < 4; i++) await f.dispenses.connect(f.pharmA).dispense(dispenseReq(lotKey, await issuePermit(f), 1));
    return { f, lotKey, root: await f.dispenses.currentRoot(lotKey) };
  }

  it("A: verified reports from anyone (relayer) raise a SafetySignal at the threshold", async () => {
    const { f, lotKey, root } = await ready();
    const s = f.signals.connect(f.relayer);
    await s.reportAdverseEvent(lotKey, root, 1001n, 4, ZERO32, FAKE_PROOF);
    await s.reportAdverseEvent(lotKey, root, 1002n, 5, ZERO32, FAKE_PROOF);
    await expect(s.reportAdverseEvent(lotKey, root, 1003n, 3, ZERO32, FAKE_PROOF))
      .to.emit(f.signals, "SafetySignal").withArgs(lotKey, 3, 400);
  });

  it("A: one report per patient per lot (nullifier), only against real roots, valid proofs", async () => {
    const { f, lotKey, root } = await ready();
    await f.signals.reportAdverseEvent(lotKey, root, 5n, 2, ZERO32, FAKE_PROOF);
    await expect(f.signals.reportAdverseEvent(lotKey, root, 5n, 2, ZERO32, FAKE_PROOF)).to.be.revertedWith("Signals: already used");
    await expect(f.signals.reportAdverseEvent(lotKey, 123n, 6n, 2, ZERO32, FAKE_PROOF)).to.be.revertedWith("Signals: unknown root");
    const bad = { ...FAKE_PROOF, a: [0, 0] };
    await expect(f.signals.reportAdverseEvent(lotKey, root, 7n, 2, ZERO32, bad)).to.be.revertedWith("Signals: invalid proof");
  });

  it("B: anonymous acknowledgements give live recall effectiveness", async () => {
    const { f, lotKey, root } = await ready();
    await f.recalls.connect(f.regulator).issueRecall(lotKey, 1, ZERO32, false);
    await f.signals.acknowledgeRecall(0, root, 900n, 1, FAKE_PROOF);
    await f.signals.acknowledgeRecall(0, root, 901n, 2, FAKE_PROOF);
    expect(await f.signals.recallEffectivenessBps(0)).to.equal(5000); // 2 of 4 dispenses
    expect(await f.signals.ackByAction(0, 2)).to.equal(1);
  });

  it("SDK and contract agree on external nullifiers and signal hashes", async () => {
    const sdk = await import("@lotus/sdk");
    const { f, lotKey } = await ready();
    expect(await f.signals.externalNullifierForReport(lotKey)).to.equal(sdk.externalNullifierForReport(lotKey));
    expect(await f.signals.externalNullifierForAck(7)).to.equal(sdk.externalNullifierForAck(7));
    const cid = ethers.id("report");
    expect(await f.signals.reportSignalHash(3, cid)).to.equal(sdk.reportSignalHash(3, cid));
    expect(await f.signals.ackSignalHash(2)).to.equal(sdk.ackSignalHash(2));
  });
});
