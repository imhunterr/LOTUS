const RateInterface = require("@hyperledger/caliper-core/lib/worker/rate-control/rateInterface.js");
const { setTimeout: delay } = require("node:timers/promises");
class SerialRate extends RateInterface {
  constructor(...args) {
    super(...args);
    this.issued = 0;
  }
  async applyRateControl() {
    // Gate offered operations, including the first warm-up transaction. This
    // preserves shared lot/permit state and avoids a hidden client-side queue.
    const deadline = Date.now() + 70000;
    while (this.stats.getTotalFinishedTx() < this.issued) {
      if (Date.now() > deadline)
        throw new Error("Previous Fabric transaction did not finish.");
      await delay(20);
    }
    this.issued++;
  }
  async end() {}
}
module.exports.createRateController = (...args) => new SerialRate(...args);
