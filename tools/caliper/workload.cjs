const { WorkloadModuleBase } = require("@hyperledger/caliper-core");
const { readFileSync, appendFileSync } = require("node:fs");
const { dirname, join } = require("node:path");
const { performance } = require("node:perf_hooks");

class LotusWorkload extends WorkloadModuleBase {
  async initializeWorkloadModule(
    workerIndex,
    totalWorkers,
    roundIndex,
    args,
    adapter,
    context
  ) {
    await super.initializeWorkloadModule(
      workerIndex,
      totalWorkers,
      roundIndex,
      args,
      adapter,
      context
    );
    this.fixture = JSON.parse(readFileSync(args.fixture, "utf8"));
    this.index = 0;
    this.evidence = join(
      dirname(args.fixture),
      `transactions-${args.kind}-${workerIndex}.jsonl`
    );
    if (totalWorkers !== 1)
      throw new Error(
        "This fixture uses shared lot/permit state and one worker. Prepare separate state before concurrency scaling."
      );
  }
  async submitTransaction() {
    const f = this.fixture,
      kind = this.roundArguments.kind,
      index = this.index++;
    const actor =
      f.actors[kind === "register-lot" ? "manufacturer" : "pharmacy"];
    const request = {
      channel: f.channel,
      contractId: f.chaincode,
      invokerIdentity: actor.id,
      invokerMspId: kind === "register-lot" ? "Org2MSP" : "Org1MSP",
      readOnly: kind === "public-feed",
    };
    if (request.readOnly) {
      request.contractFunction = "Lotus:PublicFeed";
      request.contractArguments = [];
    } else {
      request.contractFunction = "Lotus:Execute";
      const command = kind === "register-lot" ? "registerLot" : "dispense";
      const payload =
        kind === "register-lot"
          ? {
              namespace: "NDC",
              code: "CALIPER",
              name: "Measured registration",
              lotNumber: `${f.runId}-${index}`,
              quantity: "1",
              expiry: Math.floor(Date.now() / 1000) + 86400,
            }
          : {
              lotId: f.lot.id,
              permitId: f.permitId,
              quantity: "1",
              commitment: f.commitments[index],
            };
      request.contractArguments = [
        `caliper-${f.runId}-${kind}-${index}`,
        command,
        JSON.stringify(payload),
      ];
      if (kind === "dispense")
        request.transientMap = {
          credentials: JSON.stringify({ credential: f.permitSecret }),
        };
    }
    const started = performance.now();
    const statuses = await this.sutAdapter.sendRequests(request);
    const list = Array.isArray(statuses) ? statuses : [statuses];
    const successful = list.every((s) => s && s.IsCommitted());
    appendFileSync(
      this.evidence,
      JSON.stringify({
        kind,
        index,
        latencyMs: performance.now() - started,
        successful,
        transactionIds: list.map((s) => s.GetID()),
      }) + "\n"
    );
  }
}
module.exports.createWorkloadModule = () => new LotusWorkload();
