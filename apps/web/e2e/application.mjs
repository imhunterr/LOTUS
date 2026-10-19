import { chromium } from "playwright";
import { createApp } from "../../../services/api/src/server.js";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const dir = mkdtempSync(join(tmpdir(), "lotus-browser-"));
const service = createApp({ dataDir: dir });
const server = await new Promise((resolve) => {
  const s = service.app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
});
const errors = [];
let checks = 0;
const contexts = [];
const screenshots = resolve("test-results");
mkdirSync(screenshots, { recursive: true });
const pageFor = async () => {
  const c = await browser.newContext({
    viewport: { width: 1366, height: 900 },
  });
  contexts.push(c);
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  return p;
};
const call = async (page, path, body) => {
  const session = await (await page.request.get(base + "/api/session")).json();
  const res = await page.request.post(base + "/api" + path, {
    data: body,
    headers: { "x-csrf-token": session.csrf || "" },
  });
  const data = await res.json();
  assert.ok(res.ok(), JSON.stringify(data));
  return data;
};
const cmd = (p, command, payload) =>
  call(p, "/commands", { command, payload, requestId: crypto.randomUUID() });
const wait = async (page, text) => {
  await page
    .getByText(text, { exact: false })
    .first()
    .waitFor({ timeout: 90000 });
  checks++;
  console.log("Verified:", text);
};
const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
try {
  const operator = await pageFor();
  await operator.goto(base + "/login");
  await operator.getByLabel("Your name").fill("Test operator");
  await operator
    .getByLabel("Email", { exact: true })
    .fill("operator@example.test");
  await operator
    .getByLabel("Password", { exact: true })
    .fill("Browser-test-passphrase-123");
  await operator
    .getByRole("button", { name: /Create operator account/ })
    .click();
  await wait(operator, "Your day, at a glance");
  await operator.goto(base + "/workspace/integrations");
  await wait(operator, "Connections & measured evidence");
  await wait(operator, "Encrypted database");
  await operator.setViewportSize({ width: 390, height: 844 });
  assert(
    await operator.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  );
  await operator.screenshot({
    path: resolve(screenshots, "integrations-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  checks++;
  await operator.setViewportSize({ width: 1366, height: 900 });
  const people = {};
  for (const [key, role] of [
    ["manufacturer", "manufacturer"],
    ["distributor", "distributor"],
    ["pharmacy", "pharmacy"],
    ["prescriber", "prescriber"],
    ["regulator", "regulator"],
  ]) {
    const org = await cmd(operator, "createOrganization", {
      name: `Test ${key}`,
      type: role,
      region: 1,
      facility: "Test facility",
    });
    const invite = await call(operator, "/invitations", {
      email: `${key}@example.test`,
      name: `Test ${key}`,
      role,
      orgId: org.result.organization.id,
    });
    const page = await pageFor();
    await page.goto(base + invite.url);
    await page
      .getByLabel("Choose a password")
      .fill("Browser-test-passphrase-123");
    await page.getByRole("button", { name: /Activate my access/ }).click();
    await wait(page, "Your day, at a glance");
    people[key] = { page, orgId: org.result.organization.id };
  }
  const mfr = people.manufacturer.page;
  await mfr.goto(base + "/workspace/lots");
  await mfr.getByLabel("Medicine name").fill("Workflow test medicine");
  await mfr.getByLabel("Product code", { exact: true }).fill("0002-1433-80");
  await mfr.getByLabel("Lot number").fill("WEB-REAL-1");
  await mfr.getByLabel("Expiry date").fill(future);
  await mfr.getByLabel("Initial base units").fill("500");
  await mfr.getByRole("button", { name: /Register and issue stock/ }).click();
  await wait(mfr, "Lot registered and initial stock issued once.");
  const workspace = await (
      await mfr.request.get(base + "/api/workspace")
    ).json(),
    lot = workspace.lots[0];
  await mfr.goto(base + "/workspace/shipments");
  await mfr.getByLabel("Held stock").selectOption(lot.id);
  await mfr
    .getByLabel("Recipient", { exact: true })
    .selectOption(people.distributor.orgId);
  await mfr.getByLabel("Quantity in base units").fill("200");
  await mfr.getByRole("button", { name: /Commit outbound shipment/ }).click();
  await wait(mfr, "Shipment committed.");
  const dist = people.distributor.page;
  await dist.goto(base + "/workspace/incoming");
  await dist.getByRole("button", { name: "Accept", exact: true }).click();
  await wait(dist, "accepted");
  await dist.goto(base + "/workspace/outgoing");
  await dist.getByLabel("Held stock").selectOption(lot.id);
  await dist
    .getByLabel("Recipient", { exact: true })
    .selectOption(people.pharmacy.orgId);
  await dist.getByLabel("Quantity in base units").fill("100");
  await dist.getByRole("button", { name: /Commit outbound shipment/ }).click();
  await wait(dist, "Shipment committed.");
  const pharm = people.pharmacy.page;
  await pharm.goto(base + "/workspace/incoming");
  await pharm.getByRole("button", { name: "Accept", exact: true }).click();
  await wait(pharm, "accepted");
  const doctor = people.prescriber.page;
  await doctor.goto(base + "/workspace/issue-permit");
  await doctor.getByLabel("Product code", { exact: true }).fill(lot.code);
  await doctor.getByLabel("Authorized base units").fill("60");
  await doctor.getByLabel("Valid through").fill(future);
  await doctor.getByRole("button", { name: /Sign and issue permit/ }).click();
  await wait(doctor, "Prescription issued.");
  const prescription = await doctor
    .getByLabel("Prescription code")
    .inputValue();
  const patient = await pageFor();
  await patient.goto(base + "/patient");
  await patient
    .getByLabel("Choose a vault passphrase")
    .fill("Patient-private-passphrase-123");
  await patient.getByRole("button", { name: /Create my vault/ }).click();
  await wait(patient, "Your medicine inbox.");
  await patient
    .getByRole("link", { name: "Medicines", exact: true })
    .first()
    .click();
  await patient.getByRole("button", { name: /Add prescription/ }).click();
  await patient.getByPlaceholder("…or paste the code").fill(prescription);
  await patient.getByRole("button", { name: "Use", exact: true }).click();
  await wait(patient, "Private credential");
  await patient
    .getByRole("link", { name: "Counter code", exact: true })
    .first()
    .click();
  await patient
    .getByRole("button", { name: /Create fresh counter code/ })
    .click();
  await wait(patient, "One-time index saved securely");
  const code = await patient.getByLabel("Patient counter code").inputValue();
  await pharm.goto(base + "/workspace/counter");
  await pharm.getByPlaceholder("…or paste the code").first().fill(code);
  await pharm.getByRole("button", { name: "Use", exact: true }).first().click();
  await pharm.getByLabel("Scanned shelf lot").selectOption(lot.id);
  await pharm.getByLabel("Quantity in base units").fill("30");
  await pharm.getByRole("button", { name: /Validate and record fill/ }).click();
  await wait(pharm, "Fill committed.");
  const receipt = await pharm.getByLabel("Recorded receipt code").inputValue();
  await patient
    .getByRole("link", { name: "Home", exact: true })
    .first()
    .click();
  await patient.getByRole("button", { name: "Check now", exact: true }).click();
  await wait(patient, "1 locally matched records");
  await patient
    .getByRole("link", { name: "Medicines", exact: true })
    .first()
    .click();
  await patient
    .getByRole("button", { name: "Add the detailed pharmacy receipt" })
    .click();
  await patient.getByPlaceholder("…or paste the code").fill(receipt);
  await patient.getByRole("button", { name: "Use", exact: true }).click();
  await wait(patient, "30 units · Test pharmacy");
  const reg = people.regulator.page;
  await reg.goto(base + "/workspace/recalls");
  await reg.getByLabel("Exact lot").selectOption(lot.id);
  await reg.getByLabel("Classification", { exact: true }).selectOption("2");
  await reg
    .getByLabel("Reason", { exact: true })
    .fill("Test quality investigation");
  await reg
    .getByLabel("Approved patient instructions")
    .fill("Contact your pharmacy or prescriber for the official next steps.");
  await reg.getByRole("button", { name: /Issue authorized recall/ }).click();
  await wait(reg, "Recall committed.");
  await patient
    .getByRole("link", { name: "Home", exact: true })
    .first()
    .click();
  await patient
    .getByRole("button", { name: "Check now", exact: true })
    .count()
    .then(async (count) => {
      if (count)
        await patient
          .getByRole("button", { name: "Check now", exact: true })
          .click();
    });
  await wait(patient, "A medicine you received has been recalled");
  await patient.getByRole("link", { name: "Review recall details" }).click();
  await patient
    .getByRole("button", { name: /Send anonymous acknowledgement/ })
    .click();
  await wait(patient, "Anonymous acknowledgement accepted.");
  await patient
    .getByLabel("What happened")
    .fill("Test narrative: mild rash after two days.");
  await patient
    .getByRole("button", { name: /Encrypt, prove and submit/ })
    .click();
  await wait(
    patient,
    "Encrypted report accepted with a verified membership proof."
  );
  await reg.goto(base + "/workspace/investigations");
  await reg
    .getByRole("button", { name: "Open protected report", exact: true })
    .click();
  await wait(reg, "Test narrative: mild rash after two days.");
  await patient
    .getByRole("link", { name: "Recovery", exact: true })
    .first()
    .click();
  await patient.getByRole("button", { name: /Create guardian shares/ }).click();
  await patient.getByLabel("Guardian 1", { exact: true }).waitFor();
  checks++;
  await patient
    .getByRole("button", { name: "Show handover share", exact: true })
    .nth(0)
    .click();
  const share1 = await patient
    .getByLabel("Guardian share 1", { exact: true })
    .inputValue();
  await patient
    .getByRole("button", { name: "Show handover share", exact: true })
    .nth(1)
    .click();
  const share2 = await patient
    .getByLabel("Guardian share 2", { exact: true })
    .inputValue();
  const guardian = await pageFor();
  await guardian.goto(base + "/guardian");
  await guardian.getByPlaceholder("…or paste the code").fill(share1);
  await guardian.getByRole("button", { name: "Use", exact: true }).click();
  await guardian
    .getByLabel("Guardian vault passphrase")
    .fill("Guardian-private-passphrase-123");
  await guardian
    .getByRole("button", { name: /Accept and encrypt this share/ })
    .click();
  await wait(guardian, "One share encrypted and accepted.");
  await guardian
    .getByRole("button", { name: /Unlock stored guardian share/ })
    .click();
  await guardian.getByLabel("Unlocked recovery share").waitFor();
  checks++;
  const downloadEvent = patient.waitForEvent("download");
  await patient
    .getByRole("button", { name: /Download encrypted backup/ })
    .click();
  const downloaded = await downloadEvent;
  const backupPath = join(screenshots, "patient-backup.json");
  await downloaded.saveAs(backupPath);
  const recovered = await pageFor();
  await recovered.goto(base + "/patient");
  await recovered.getByRole("button", { name: "Recover", exact: true }).click();
  await recovered.getByLabel("Guardian share one").fill(share1);
  await recovered.getByLabel("Guardian share two").fill(share2);
  await recovered
    .getByLabel("Encrypted backup package")
    .setInputFiles(backupPath);
  await recovered
    .getByLabel("Choose a vault passphrase")
    .fill("Recovered-private-passphrase-123");
  await recovered.getByRole("button", { name: /Recover history/ }).click();
  await wait(recovered, "A medicine you received has been recalled");
  await recovered
    .getByRole("link", { name: "Medicines", exact: true })
    .first()
    .click();
  await wait(recovered, "30 units · Test pharmacy");
  await patient.setViewportSize({ width: 390, height: 844 });
  await patient.goto(base + "/patient");
  await patient
    .getByLabel("Vault passphrase", { exact: true })
    .fill("Patient-private-passphrase-123");
  await patient.getByRole("button", { name: /Unlock my vault/ }).click();
  await wait(patient, "A medicine you received has been recalled");
  assert.equal(
    await patient.evaluate(
      () => document.documentElement.scrollWidth > innerWidth
    ),
    false
  );
  await patient.screenshot({
    path: join(screenshots, "patient-mobile.png"),
    fullPage: true,
  });
  await dist.goto(base + "/workspace/overview");
  await dist.screenshot({
    path: join(screenshots, "distributor-desktop.png"),
    fullPage: true,
  });
  const publicPage = await pageFor();
  await publicPage.goto(base + "/verify");
  await publicPage.getByLabel("Product code", { exact: true }).fill(lot.code);
  await publicPage.getByLabel("Lot number").fill(lot.lotNumber);
  await publicPage.getByRole("button", { name: /Check lot status/ }).click();
  await wait(publicPage, "This lot has an official recall");
  await patient.evaluate(() => navigator.serviceWorker.ready);
  await patient.context().setOffline(true);
  await patient.reload();
  await patient
    .getByLabel("Vault passphrase", { exact: true })
    .fill("Patient-private-passphrase-123");
  await patient.getByRole("button", { name: /Unlock my vault/ }).click();
  await wait(patient, "Could not complete a fresh check.");
  await wait(patient, "A medicine you received has been recalled");
  await patient.context().setOffline(false);
  for (const role of Object.keys(people)) {
    const p = people[role].page;
    await p.setViewportSize({ width: 390, height: 844 });
    await p.goto(base + "/workspace/overview");
    await wait(p, "Your day, at a glance");
    assert.equal(
      await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
      role + " mobile overflow"
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      checks,
      roles: Object.keys(people).length + 2,
      realBrowserProofs: true,
      encryptedNarrative: true,
      fullGuardianRecovery: true,
      pageErrors: errors,
      screenshots,
    })
  );
} catch (error) {
  for (let i = 0; i < contexts.length; i++) {
    const pages = contexts[i].pages();
    if (pages.length)
      await pages[0]
        .screenshot({
          path: join(screenshots, `failed-${i}.png`),
          fullPage: true,
        })
        .catch(() => {});
  }
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await service.close();
  await globalThis.curve_bn128?.terminate();
  assert.ok(dir.startsWith(tmpdir()));
  rmSync(dir, { recursive: true, force: true });
}
