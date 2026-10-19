import {
  mkdtempSync,
  rmSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, scryptSync, createHash } from "node:crypto";
import assert from "node:assert/strict";
import { createApp } from "../src/server.js";
import { IPFSStore } from "../src/ipfs.js";

const context = JSON.parse(readFileSync(".tooling/context.json", "utf8"));
const ipfsApi = "http://127.0.0.1:15001";
const directory = mkdtempSync(join(tmpdir(), "lotus-ipfs-"));
const service = createApp({
  dataDir: directory,
  mode: "fabric",
  fabricConfig: context.configPath,
  fireflyConfig: ".tooling/firefly/runtime/client.json",
  ipfsApi,
});
const actor = context.actors.manufacturer,
  password = "Isolated-IPFS-test-passphrase-2026",
  salt = randomBytes(16).toString("hex");
service.store.db
  .prepare(
    "INSERT INTO users(id,email,name,role,orgId,password) VALUES(?,?,?,?,?,?)"
  )
  .run(
    actor.id,
    "manufacturer@example.test",
    "IPFS document staff",
    actor.role,
    actor.orgId,
    `${salt}:${scryptSync(password, salt, 64).toString("hex")}`
  );
const server = await new Promise((done) => {
  const s = service.app.listen(0, "127.0.0.1", () => done(s));
});
const base = `http://127.0.0.1:${server.address().port}`;
let checks = 0;
function check(value, label) {
  assert(value, label);
  checks++;
  console.log("Verified:", label);
}
try {
  const logged = await fetch(base + "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "manufacturer@example.test", password }),
  });
  const session = await logged.json();
  assert(logged.ok);
  const cookie = logged.headers.get("set-cookie").split(";")[0];
  const bytes = Buffer.from(
    "LOTUS integration certificate: actual signed issuer evidence belongs in this document.\n"
  );
  const expected = createHash("sha256").update(bytes).digest("hex");
  const uploaded = await fetch(base + "/api/documents", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      "x-csrf-token": session.csrf,
    },
    body: JSON.stringify({
      name: "integration-certificate.txt",
      mime: "text/plain",
      public: false,
      base64: bytes.toString("base64"),
    }),
  });
  const document = await uploaded.json();
  assert(uploaded.ok, JSON.stringify(document));
  check(
    document.storage === "ipfs" && /^b[a-z2-7]+$/.test(document.cid),
    "Fabric commits the actual encrypted IPFS CID"
  );
  check(
    document.digest === expected,
    "Original certificate digest is committed"
  );
  const ciphertext = await new IPFSStore(ipfsApi).get(
    document.cid,
    document.ciphertextDigest
  );
  check(
    !ciphertext.includes(bytes),
    "IPFS stores ciphertext, without certificate plaintext"
  );
  const downloaded = await fetch(base + "/api/documents/" + document.id, {
    headers: { Cookie: cookie },
  });
  check(
    downloaded.ok && Buffer.from(await downloaded.arrayBuffer()).equals(bytes),
    "Authorized web download retrieves and decrypts real IPFS bytes"
  );
  const denied = await fetch(base + "/api/documents/" + document.id);
  check(!denied.ok, "Restricted certificate is denied to an anonymous browser");
  await assert.rejects(
    new IPFSStore(ipfsApi).get(document.cid, "0".repeat(64)),
    /integrity/
  );
  checks++;
  const pinned = await fetch(`${ipfsApi}/api/v0/pin/ls?arg=${document.cid}`, {
    method: "POST",
  });
  check(pinned.ok, "Uploaded content is pinned in Kubo");
  const result = {
    tool: "IPFS Kubo",
    version: "0.43.1",
    passed: true,
    checks,
    channel: context.channel,
    encrypted: true,
    cidCommitted: true,
    checkedAt: Date.now(),
  };
  mkdirSync("test-results/ipfs", { recursive: true });
  writeFileSync(
    "test-results/ipfs/acceptance.json",
    JSON.stringify(result, null, 2)
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await new Promise((done) => server.close(done));
  await service.close();
  assert(directory.startsWith(tmpdir()));
  rmSync(directory, { recursive: true, force: true });
}
