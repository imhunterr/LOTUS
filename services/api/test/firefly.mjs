import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes, scryptSync, randomUUID, createHash } from "node:crypto";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { createApp } from "../src/server.js";
import {
  newPermit,
  newPatientSecret,
  commitmentAt,
} from "../../../sdk/src/index.js";
import { canonical } from "../../../packages/domain/src/crypto.js";

const context = JSON.parse(readFileSync(".tooling/context.json", "utf8"));
const configPath = context.configPath,
  config = JSON.parse(readFileSync(configPath, "utf8"));
assert.equal(config.channel, "lotus-tooling");
const fireflyConfig = resolve(".tooling/firefly/runtime/client.json");
const dir = mkdtempSync(join(tmpdir(), "lotus-firefly-"));
const service = createApp({
  dataDir: dir,
  mode: "fabric",
  fabricConfig: configPath,
  fireflyConfig,
});
const server = await new Promise((done) => {
  const s = service.app.listen(0, "127.0.0.1", () => done(s));
});
const base = `http://127.0.0.1:${server.address().port}`,
  actors = context.actors;
const password = "Isolated-FireFly-test-passphrase-2026",
  salt = randomBytes(16).toString("hex");
const pwhash = `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
let checks = 0;
const check = (value, label) => {
  assert(value, label);
  checks++;
  console.log("Verified:", label);
};
const users = [config.publicReader, ...Object.values(actors)];
for (const a of users)
  service.store.db
    .prepare(
      "INSERT INTO users(id,email,name,role,orgId,password) VALUES(?,?,?,?,?,?)"
    )
    .run(
      a.id,
      `${a.id}@example.test`,
      a.name || "Tool operator",
      a.role,
      a.orgId,
      pwhash
    );
function client() {
  let cookie = "",
    csrf = "";
  return async (path, body) => {
    const r = await fetch(base + "/api" + path, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        "x-csrf-token": csrf,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.headers.get("set-cookie"))
      cookie = r.headers.get("set-cookie").split(";")[0];
    const data = await r.json();
    if (data.csrf) csrf = data.csrf;
    return { ok: r.ok, status: r.status, data };
  };
}
const clients = {};
const invoke = async (role, command, payload, requestId = randomUUID()) => {
  const r = await clients[role]("/commands", { command, payload, requestId });
  assert(r.ok, JSON.stringify(r.data));
  check(r.data.status === "committed", `${command}: confirmed Fabric commit`);
  return r.data.result;
};
try {
  for (const actor of users) {
    const call = client();
    const logged = await call("/login", {
      email: `${actor.id}@example.test`,
      password,
    });
    assert(logged.ok);
    clients[actor.role] = call;
  }
  const status = await clients.operator("/integrations");
  check(status.data.firefly.connected, "Web API uses the live FireFly gateway");
  const org = (
    await invoke("operator", "createOrganization", {
      name: `FireFly staff ${randomUUID()}`,
      type: "manufacturer",
      region: 1,
      facility: "Tool validation",
    })
  ).organization;
  const invitation = await clients.operator("/invitations", {
    email: `${randomUUID()}@example.test`,
    name: "FireFly invited staff",
    role: "manufacturer",
    orgId: org.id,
  });
  assert(invitation.ok);
  const newStaff = client();
  const joined = await newStaff("/join", {
    token: invitation.data.url.split("=")[1],
    password,
  });
  check(
    joined.ok,
    "Invitation registers staff through FireFly and enrolls a distinct Fabric certificate"
  );
  const requestId = randomUUID(),
    payload = {
      namespace: "NDC",
      code: "FF-WORKFLOW",
      name: "FireFly workflow medicine",
      lotNumber: randomUUID(),
      quantity: "60",
      expiry: Math.floor(Date.now() / 1000) + 86400,
    };
  const create = await newStaff("/commands", {
    command: "registerLot",
    payload,
    requestId,
  });
  check(
    create.ok && create.data.status === "committed",
    "Invited staff can commit a lot through FireFly"
  );
  const lot = create.data.result.lot;
  const repeated = await newStaff("/commands", {
    command: "registerLot",
    payload,
    requestId,
  });
  check(
    repeated.ok && repeated.data.result.lot.id === lot.id,
    "FireFly retry returns the same authorized committed result"
  );
  const conflict = await newStaff("/commands", {
    command: "registerLot",
    payload: { ...payload, quantity: "61" },
    requestId,
  });
  check(
    !conflict.ok && conflict.data.error?.code === "IDEMPOTENCY_CONFLICT",
    "Changed retry content is rejected"
  );
  const digest = createHash("sha256")
    .update(
      canonical({
        actor: { id: joined.data.user.id, orgId: org.id, role: "manufacturer" },
        command: "registerLot",
        payload,
      })
    )
    .digest("hex");
  await assert.rejects(
    service.ledger.firefly.call(config.publicReader, "CommandResult", {
      requestId,
      expectedDigest: digest,
    }),
    /FORBIDDEN/
  );
  checks++;
  const shipment = await newStaff("/commands", {
    command: "ship",
    payload: {
      lotId: lot.id,
      toOrgId: actors.distributor.orgId,
      quantity: "60",
    },
    requestId: randomUUID(),
  });
  assert(shipment.ok);
  await invoke("distributor", "receive", {
    shipmentId: shipment.data.result.shipment.id,
    action: "accept",
  });
  const forwarded = (
    await invoke("distributor", "ship", {
      lotId: lot.id,
      toOrgId: actors.pharmacy.orgId,
      quantity: "60",
    })
  ).shipment;
  await invoke("pharmacy", "receive", {
    shipmentId: forwarded.id,
    action: "accept",
  });
  const credential = newPermit(),
    patientSecret = newPatientSecret();
  const permit = (
    await invoke("prescriber", "issuePermit", {
      namespace: lot.namespace,
      code: lot.code,
      quantity: "30",
      expiry: Math.floor(Date.now() / 1000) + 3600,
      holderCommit: credential.holderCommit,
    })
  ).permit;
  const fill = {
    lotId: lot.id,
    permitId: permit.id,
    permitSecret: credential.permitSecret,
    quantity: "10",
    commitment: commitmentAt(patientSecret, 0).toString(),
  };
  const receipt = (await invoke("pharmacy", "dispense", fill)).receipt;
  check(
    Boolean(receipt.signature),
    "Transient-credential fill produces a signed receipt"
  );
  const snapshot = (await clients.pharmacy("/workspace")).data;
  check(
    snapshot.transport === "firefly" &&
      snapshot.stocks.find((s) => s.lotId === lot.id).available === "50",
    "FireFly workspace reconciles the Fabric-transient dispense"
  );
  check(
    snapshot.permits.find((p) => p.id === permit.id).balance === "20",
    "Partial fill balance is preserved"
  );
  const recallRequest = randomUUID();
  const recall = await invoke(
    "regulator",
    "recall",
    {
      lotId: lot.id,
      classification: 2,
      reason: "Tool acceptance recall",
      instructions: "Follow the issued pharmacy notice.",
    },
    recallRequest
  );
  const blocked = await clients.pharmacy("/commands", {
    command: "dispense",
    payload: { ...fill, commitment: commitmentAt(patientSecret, 1).toString() },
    requestId: randomUUID(),
  });
  check(
    !blocked.ok && blocked.data.error?.code === "LOT_RECALLED",
    "Recalled lot is blocked through the transient path"
  );
  const feed = await (await fetch(base + "/api/public/feed")).json();
  const publishedLot = feed.lots.find((l) => l.id === lot.id);
  check(Boolean(publishedLot?.manufacturer), "Fabric public feed resolves the manufacturer name");
  const verified = await (await fetch(base + `/api/public/verify?code=${lot.code}&lot=${lot.lotNumber}`)).json();
  for (const published of [publishedLot, verified.matches.find((l) => l.id === lot.id)])
    check(Boolean(published) && ['manufacturerId', 'quantity', 'dispensedUnits', 'dispenseRecords', 'reportCount', 'severitySum', 'safetySignal', 'currentSegment']
      .every((field) => !Object.hasOwn(published, field)), "FireFly-backed anonymous responses contain no operational lot fields");
  check(
    feed.recalls.some((r) => r.lotId === lot.id),
    "Patient broad feed reads the FireFly-backed recall"
  );
  const scoped = await newStaff("/workspace");
  check(
    !scoped.data.receipts?.length,
    "Manufacturer cannot read pharmacy receipts"
  );
  let observed = false;
  for (let i = 0; i < 20 && !observed; i++) {
    const events = await service.ledger.firefly.request(
      "lotus-org1",
      "/blockchainevents?limit=250&sort=timestamp&direction=desc"
    );
    observed = events.some(
      (e) =>
        e.output?.requestId === recallRequest ||
        e.info?.requestId === recallRequest
    );
    if (!observed) await delay(500);
  }
  check(observed, "FireFly durably indexes the committed recall event");
  const runtime = resolve(".tooling/firefly/runtime");
  for (const name of readdirSync(runtime).filter((n) =>
    /^firefly.*sqlite(?:-wal)?$/.test(n)
  ))
    check(
      !readFileSync(join(runtime, name)).includes(
        Buffer.from(credential.permitSecret)
      ),
      "Permit secret absent from FireFly operation storage"
    );
  const unauthorized = await fetch(base + "/api/integrations");
  check(
    unauthorized.status === 401,
    "Integration evidence requires staff authentication"
  );
  const result = {
    tool: "Hyperledger FireFly",
    coreVersion: "1.5.0",
    connectorVersion: "0.10.0",
    channel: config.channel,
    checks,
    checkedAt: Date.now(),
    passed: true,
    features: [
      "authenticated staff invitation",
      "two-org custody",
      "partial fill",
      "signed receipt",
      "digest-bound idempotent confirmation",
      "recall blocking",
      "durable recall event",
      "transient credential isolation",
      "scoped web interface",
    ],
  };
  mkdirSync("test-results/firefly", { recursive: true });
  writeFileSync(
    "test-results/firefly/acceptance.json",
    JSON.stringify(result, null, 2)
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await new Promise((done) => server.close(done));
  await service.close();
  assert(dir.startsWith(tmpdir()));
  rmSync(dir, { recursive: true, force: true });
}
