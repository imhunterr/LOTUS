import { createApp } from "../src/server.js";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
const dir = mkdtempSync(join(tmpdir(), "lotus-first-fabric-"));
const config = JSON.parse(readFileSync(".fabric-network/gateway.json", "utf8"));
const service = createApp({
  dataDir: dir,
  mode: "fabric",
  fabricConfig: resolve(".fabric-network/gateway.json"),
  fireflyConfig: resolve(".tooling/firefly/operations/client.json"),
  ipfsApi: "http://127.0.0.1:15001",
});
const server = await new Promise((done) => {
  const s = service.app.listen(0, "127.0.0.1", () => done(s));
});
const base = `http://127.0.0.1:${server.address().port}`;
try {
  const initial = await (await fetch(base + "/api/session")).json();
  assert(initial.setupRequired);
  assert.throws(
    () => createApp({ dataDir: dir, mode: "local" }),
    /different ledger profile/
  );
  const setup = await fetch(base + "/api/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Temporary setup verification",
      email: "setup@example.test",
      password: "Temporary-setup-passphrase-2026",
      id: "untrusted-user-selected-id",
      role: "regulator",
    }),
  });
  const data = await setup.json();
  assert(setup.ok, JSON.stringify(data));
  assert.equal(data.user.id, config.publicReader.id);
  assert.equal(data.user.role, "operator");
  const cookie = setup.headers.get("set-cookie").split(";")[0];
  const workspace = await (
    await fetch(base + "/api/workspace", { headers: { Cookie: cookie } })
  ).json();
  assert.equal(workspace.ledger, "fabric");
  assert.equal(workspace.transport, "firefly");
  assert.equal(workspace.lots.length, 0);
  assert.equal(workspace.organizations.length, 0);
  const health = await (
    await fetch(base + "/api/integrations", { headers: { Cookie: cookie } })
  ).json();
  assert(health.firefly.connected);
  assert(health.documentStorage.connected);
  assert.equal(health.documentStorage.type, "ipfs");
  const second = await fetch(base + "/api/setup", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      "x-csrf-token": data.csrf,
    },
    body: JSON.stringify({
      email: "second@example.test",
      password: "Temporary-second-passphrase-2026",
    }),
  });
  assert.equal(second.status, 409);
  const result = {
    passed: true,
    checks: 9,
    channel: config.channel,
    ledger: "fabric",
    transport: "firefly",
    documents: "ipfs",
    businessStateEmpty: true,
    scope:
      "Temporary authentication database; only read-only Fabric queries; no operational stock or staff seeded.",
    checkedAt: Date.now(),
  };
  mkdirSync("test-results/firefly", { recursive: true });
  writeFileSync(
    "test-results/firefly/first-run.json",
    JSON.stringify(result, null, 2)
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await new Promise((done) => server.close(done));
  await service.close();
  assert(dir.startsWith(tmpdir()));
  rmSync(dir, { recursive: true, force: true });
}
