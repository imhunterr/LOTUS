import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { FabricLedger } from "../services/api/src/fabric.js";

const info = JSON.parse(readFileSync(".tooling/caliper-run.json", "utf8"));
const sourcePaths = [
  "chaincode/lotus/index.cjs", "packages/domain/src/engine.js",
  "tools/caliper/workload.cjs", "tools/caliper/serial-rate.cjs",
];
const sourceHashes = () => Object.fromEntries(sourcePaths.map((path) => [path,
  createHash("sha256").update(readFileSync(path)).digest("hex"),
]));
const sourceSha256 = sourceHashes();
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
assert.equal(execFileSync("git", ["status", "--porcelain", "--", ...sourcePaths], { encoding: "utf8" }).trim(), "",
  "Commit measured sources before benchmarking so evidence identifies an exact revision.");
const args = [
  resolve("tools/caliper/node_modules/@hyperledger/caliper-cli/caliper.js"),
  "launch",
  "manager",
  "--caliper-workspace",
  resolve("tools/caliper"),
  "--caliper-networkconfig",
  join(info.dir, "network.json"),
  "--caliper-benchconfig",
  join(info.dir, "benchmark.json"),
  "--caliper-flow-only-test",
  "--caliper-report-path",
  join(info.dir, "report.html"),
];
const code = await new Promise((resolveResult, reject) => {
  const child = spawn(process.execPath, args, {
    stdio: "inherit",
    cwd: resolve("tools/caliper"),
  });
  child.on("error", reject);
  child.on("exit", resolveResult);
});
if (code !== 0) throw new Error(`Caliper failed (${code}).`);
const rows = readdirSync(info.dir)
  .filter((x) => x.endsWith(".jsonl"))
  .flatMap((x) =>
    readFileSync(join(info.dir, x), "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse)
  );
const rounds = {};
for (const kind of ["public-feed", "register-lot", "dispense"]) {
  const values = rows.filter((r) => r.kind === kind);
  assert.equal(values.length, info.count * (kind === "public-feed" ? 2 : 1));
  assert(values.every((r) => r.successful));
  const times = values.map((v) => v.latencyMs).sort((a, b) => a - b);
  rounds[kind] = {
    successful: values.length,
    failed: 0,
    meanLatencyMs: times.reduce((a, b) => a + b, 0) / times.length,
    p50LatencyMs: times[Math.ceil(times.length * 0.5) - 1],
    p95LatencyMs: times[Math.ceil(times.length * 0.95) - 1],
  };
}
const ledger = new FabricLedger({ options: {} }, info.configPath, null);
try {
  const state = await ledger.snapshot(info.actors.pharmacy);
  const stock = state.stocks.find((s) => s.lotId === info.lotId);
  assert.equal(stock.dispensed, String(info.count));
  assert.equal(stock.available, "0");
} finally {
  await ledger.close();
}
assert.deepEqual(sourceHashes(), sourceSha256, "Measured source changed during the run.");
const result = {
  tool: "Hyperledger Caliper",
  version: "0.7.1",
  runId: info.runId,
  channel: "lotus-tooling",
  workers: 1,
  writeConcurrency: 1,
  rounds,
  inventoryReconciled: true,
  sourceSha256,
  sourceCommit,
  checkedAt: new Date().toISOString(),
  scope:
    "Single-host integration run. Reads are evaluated; writes include valid commit. No Fabric gas metric.",
  report: join(info.dir, "report.html"),
};
writeFileSync(join(info.dir, "summary.json"), JSON.stringify(result, null, 2));
writeFileSync(
  "test-results/caliper/latest.json",
  JSON.stringify(result, null, 2)
);
console.log(JSON.stringify(result, null, 2));
