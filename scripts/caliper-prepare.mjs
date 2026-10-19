import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { FabricLedger } from "../services/api/src/fabric.js";
import { newPermit, newPatientSecret, commitmentAt } from "../sdk/src/index.js";

const context = JSON.parse(readFileSync(".tooling/context.json", "utf8"));
const config = JSON.parse(readFileSync(context.configPath, "utf8"));
if (config.channel !== "lotus-tooling")
  throw new Error("Benchmarks require lotus-tooling.");
const count = Number(process.env.LOTUS_BENCH_TRANSACTIONS || 12);
if (!Number.isSafeInteger(count) || count < 1 || count > 100000)
  throw new Error("Choose 1–100000 transactions.");
const runId = randomUUID(),
  dir = resolve("test-results/caliper", runId);
mkdirSync(dir, { recursive: true });
const ledger = new FabricLedger({ options: {} }, context.configPath, null),
  actors = context.actors;
const run = (role, command, payload) =>
  ledger.run(actors[role], command, payload, randomUUID());
try {
  const lot = (
    await run("manufacturer", "registerLot", {
      namespace: "NDC",
      code: "CALIPER",
      name: "Isolated benchmark medicine",
      lotNumber: runId,
      quantity: String(count),
      expiry: Math.floor(Date.now() / 1000) + 86400,
    })
  ).lot;
  for (const [from, to] of [
    ["manufacturer", "distributor"],
    ["distributor", "pharmacy"],
  ]) {
    const { shipment } = await run(from, "ship", {
      lotId: lot.id,
      toOrgId: actors[to].orgId,
      quantity: String(count),
    });
    await run(to, "receive", { shipmentId: shipment.id, action: "accept" });
  }
  const credential = newPermit();
  const { permit } = await run("prescriber", "issuePermit", {
    code: lot.code,
    namespace: lot.namespace,
    quantity: String(count),
    expiry: Math.floor(Date.now() / 1000) + 86400,
    holderCommit: credential.holderCommit,
  });
  const secret = newPatientSecret();
  const commitments = Array.from({ length: count }, (_, i) =>
    commitmentAt(secret, i).toString()
  );
  const organizations = [];
  for (const msp of ["Org1MSP", "Org2MSP"]) {
    const entries = Object.values(actors).filter(
      (a) => config.identities[a.id].mspId === msp
    );
    const i = config.identities[entries[0].id];
    const profilePath = resolve(dir, `${msp}.json`);
    writeFileSync(
      profilePath,
      JSON.stringify({
        name: msp,
        version: "1.0.0",
        organizations: { [msp]: { mspid: msp, peers: [i.peerHost] } },
        peers: {
          [i.peerHost]: {
            url: `grpcs://${i.endpoint}`,
            tlsCACerts: { path: i.tlsCertificate },
            grpcOptions: {
              "ssl-target-name-override": i.peerHost,
              "grpc.ssl_target_name_override": i.peerHost,
            },
          },
        },
      })
    );
    organizations.push({
      mspid: msp,
      identities: {
        certificates: entries.map((a) => ({
          name: a.id,
          clientPrivateKey: { path: config.identities[a.id].privateKey },
          clientSignedCert: { path: config.identities[a.id].certificate },
        })),
      },
      connectionProfile: { path: profilePath },
    });
  }
  writeFileSync(
    resolve(dir, "network.json"),
    JSON.stringify(
      {
        name: "LOTUS native Fabric integration",
        version: "2.0.0",
        caliper: { blockchain: "fabric" },
        channels: [
          {
            channelName: config.channel,
            contracts: [{ id: config.chaincode }],
          },
        ],
        organizations,
      },
      null,
      2
    )
  );
  const rounds = ["public-feed", "register-lot", "dispense"].map((kind) => ({
    label: kind,
    description:
      kind === "dispense"
        ? "One committed fill at a time against shared lot/permit state"
        : "Actual LOTUS chaincode operation",
    txNumber: kind === "public-feed" ? count * 2 : count,
    rateControl:
      kind === "public-feed"
        ? { type: "fixed-rate", opts: { tps: 10 } }
        : { type: resolve("tools/caliper/serial-rate.cjs"), opts: {} },
    workload: {
      module: resolve("tools/caliper/workload.cjs"),
      arguments: { kind, fixture: resolve(dir, "fixture.json") },
    },
  }));
  writeFileSync(
    resolve(dir, "benchmark.json"),
    JSON.stringify(
      {
        test: {
          name: "LOTUS Fabric measurements",
          description:
            "Single-machine, two-organization integration measurements; not a capacity claim.",
          workers: { type: "local", number: 1 },
          rounds,
        },
      },
      null,
      2
    )
  );
  writeFileSync(
    resolve(dir, "fixture.json"),
    JSON.stringify(
      {
        runId,
        count,
        channel: config.channel,
        chaincode: config.chaincode,
        actors,
        lot,
        permitId: permit.id,
        permitSecret: credential.permitSecret,
        commitments,
      },
      null,
      2
    ),
    { mode: 0o600 }
  );
  writeFileSync(
    ".tooling/caliper-run.json",
    JSON.stringify(
      {
        dir,
        runId,
        count,
        configPath: context.configPath,
        actors,
        lotId: lot.id,
      },
      null,
      2
    )
  );
  console.log(
    `Caliper fixture ready: ${count} measured fills, ${count} registrations, ${
      count * 2
    } reads; ${dir}`
  );
} finally {
  await ledger.close();
}
