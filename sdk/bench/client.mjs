import { writeFileSync, mkdirSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";
import { commitmentAt, matchRecalls, newPatientSecret, proveMembership, LotMerkleTree } from "../src/index.js";

/**
 * P5 client-side benchmark: what a patient's phone pays as the public ledger grows.
 *   - matching: scan N Dispensed events for the patient's commitments
 *   - tree rebuild: Merkle tree over one lot's leaves
 *   - proof: Groth16 proof generation (Node; browsers are ~1.5–3× slower)
 */
const require = createRequire(import.meta.url);
const snarkjs = require("snarkjs");
const ZK = new URL("../../apps/web/public/zk/", import.meta.url).pathname;
const time = async (fn) => { const t = performance.now(); await fn(); return +(performance.now() - t).toFixed(1); };

const me = newPatientSecret();
const rows = [];
for (const n of [1_000, 10_000, 100_000]) {
  const events = Array.from({ length: n }, (_, i) => ({ commitment: BigInt(i + 1) * 7919n, lotKey: `0x${(i % 50).toString(16)}` }));
  events[Math.floor(n / 2)] = { commitment: commitmentAt(me, 0), lotKey: "0x7" };
  const matchMs = await time(() => matchRecalls(me, events, new Set(["0x7"])));
  const lotSize = Math.floor(Math.min(n, 65_536) / 50);
  const treeMs = await time(() => new LotMerkleTree(events.slice(0, lotSize).map((e) => e.commitment)));
  rows.push({ ledgerDispenses: n, matchMs, lotLeaves: lotSize, treeRebuildMs: treeMs });
}

const leaves = Array.from({ length: 1000 }, (_, i) => BigInt(i + 1));
leaves[500] = commitmentAt(me, 0);
const proofMs = [];
for (let i = 0; i < 3; i++) {
  proofMs.push(await time(() => proveMembership({ snarkjs, wasm: ZK + "lotus_membership.wasm", zkey: ZK + "lotus_final.zkey", secret: me, index: 0, leaves, leafIndex: 500, externalNullifier: 1n, signalHash: 2n })));
}
const result = { matching: rows, proofMsNode: proofMs, proofMsMedian: proofMs.sort((a, b) => a - b)[1] };
const out = new URL("../../pipeline/data/out/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
writeFileSync(out + "client_bench.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
process.exit(0);
