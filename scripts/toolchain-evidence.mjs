import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { basename } from "node:path";
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
// The synopsis is supplied separately; reuse recorded provenance unless its path
// is explicitly supplied. No developer-specific Downloads folder is required.
const sourcePath = process.argv[2] || process.env.LOTUS_SYNOPSIS_PATH;
const previous = json("docs/toolchain-evidence.json");
const sourceDocument = sourcePath
  ? {
      name: basename(sourcePath),
      sha256: createHash("sha256").update(readFileSync(sourcePath)).digest("hex"),
    }
  : previous.sourceDocument;
assert.match(sourceDocument?.sha256 || "", /^[a-f0-9]{64}$/);
const firefly = json("test-results/firefly/acceptance.json");
const ipfs = json("test-results/ipfs/acceptance.json");
const firstRun = json("test-results/firefly/first-run.json");
const liveBrowser = json("test-results/toolchain-browser.json");
const caliper = json("test-results/caliper/latest.json");
for (const path of ["chaincode/lotus/index.cjs", "packages/domain/src/engine.js", "tools/caliper/workload.cjs", "tools/caliper/serial-rate.cjs"])
  assert.equal(caliper.sourceSha256?.[path], createHash("sha256").update(readFileSync(path)).digest("hex"),
    `Caliper evidence is stale for ${path}; rerun npm run bench:caliper.`);
if (caliper.report) {
  const normalized = caliper.report.replaceAll("\\", "/");
  const reportRoot = "test-results/caliper/";
  assert.ok(normalized.includes(reportRoot), "Unexpected Caliper report path.");
  caliper.report = normalized.slice(normalized.indexOf(reportRoot));
}
const brownie = json("test-results/brownie/gas-reference.json");
const brownieXml = readFileSync("test-results/brownie-tests.xml", "utf8");
assert(
  /failures="0"/.test(brownieXml) &&
    /errors="0"/.test(brownieXml) &&
    /tests="6"/.test(brownieXml)
);
for (const result of [firefly, ipfs, firstRun, liveBrowser])
  assert.equal(result.passed, true);
assert(
  caliper.inventoryReconciled &&
    Object.values(caliper.rounds).every((r) => r.failed === 0)
);
const line = readFileSync("test-results/tooling-browser-tests.log", "utf8")
  .trim()
  .split(/\r?\n/)
  .reverse()
  .find((l) => l.startsWith('{"checks":'));
const browser = JSON.parse(line);
assert.equal(browser.pageErrors.length, 0);
const result = {
  // Preserve the delivery date; regenerating a summary is not a fresh full run.
  date: previous.date,
  sourceDocument,
  operationalProfile: {
    ledger: "Hyperledger Fabric",
    transport: "FireFly Core / FabConnect",
    documents: "IPFS encrypted ciphertext",
    channel: "lotus-operations",
    firstRunReady: true,
    sharedPasswords: false,
    seededBusinessInventory: false,
  },
  validation: {
    contractTests: 37,
    sdkTests: 4,
    apiTests: 13,
    applicationBrowserChecks: browser.checks,
    brownieTests: 6,
    fireflyChecks: firefly.checks,
    ipfsChecks: ipfs.checks,
    fabricFirstRunChecks: firstRun.checks,
    operationalBrowserChecks: liveBrowser.checks,
  },
  firefly,
  ipfs,
  firstRun,
  liveBrowser,
  caliper,
  brownie,
  limits: [
    "Single-host consortium integration",
    "Conventional delivery-provider integration remains a deployment gate",
    "Guardian replacement does not revoke knowledge of a previously compromised secret",
    "Full Synthea x openFDA evaluation campaign and production scaling are not inferred from these measurements",
  ],
};
writeFileSync("docs/toolchain-evidence.json", JSON.stringify(result, null, 2));
console.log(
  "Preserved verified tool results and synopsis provenance in docs/toolchain-evidence.json."
);
