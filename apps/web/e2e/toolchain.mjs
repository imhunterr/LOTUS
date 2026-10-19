import { chromium } from "playwright";
import { createApp } from "../../../services/api/src/server.js";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
const dir = mkdtempSync(join(tmpdir(), "lotus-toolchain-ui-"));
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
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
});
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/login`);
  await page.getByLabel("Your name").fill("Temporary verification operator");
  await page
    .getByLabel("Email", { exact: true })
    .fill("verification@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Temporary-browser-passphrase-2026");
  await page.getByRole("button", { name: /Create operator account/ }).click();
  await page.getByText("Your day, at a glance", { exact: true }).waitFor();
  await page.goto(
    `http://127.0.0.1:${server.address().port}/workspace/integrations`
  );
  await page
    .getByText("Connections & measured evidence", { exact: true })
    .waitFor();
  await page.getByText("Fabric through FireFly", { exact: false }).waitFor();
  await page.getByText("IPFS", { exact: true }).waitFor();
  await page.getByText("Connected", { exact: true }).first().waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector(".workspace-sidebar").getBoundingClientRect()
        .right <= 1
  );
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  );
  assert.deepEqual(errors, []);
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/operational-integrations-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.screenshot({
    path: "test-results/operational-integrations-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  const result = {
    checks: 7,
    passed: true,
    ledger: "fabric",
    transport: "firefly",
    documents: "ipfs",
    mobileOverflow: false,
    pageErrors: errors,
    scope:
      "Temporary browser account and database; no operational ledger writes",
  };
  writeFileSync(
    "test-results/toolchain-browser.json",
    JSON.stringify(result, null, 2)
  );
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
  await service.close();
  assert(dir.startsWith(tmpdir()));
  rmSync(dir, { recursive: true, force: true });
}
