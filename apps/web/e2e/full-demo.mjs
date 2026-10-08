/**
 * Full LOTUS demo, driven in a real browser with real zero-knowledge proofs:
 *   prescriber → patient scans prescription → pharmacy scans patient → dispense → recall →
 *   patient alerted → anonymous acknowledgement + report (Groth16) → regulator sees effectiveness →
 *   phone lost → Guardian recovery → alert restored.
 *
 * Prerequisites (see README): chain running, deploy:local, demo:seed, relayer, web dev server.
 * Run: node apps/web/e2e/full-demo.mjs [--shots dir]
 */
import { chromium } from "playwright";

const BASE = process.env.WEB_URL || "http://localhost:5173";
const shotsDir = process.argv.includes("--shots") ? process.argv[process.argv.indexOf("--shots") + 1] : null;
const PIN = "2468";

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => { errors.push(`dialog: ${d.message()}`); d.dismiss(); });

const step = (msg) => console.log(`• ${msg}`);
const shot = async (name) => shotsDir && page.screenshot({ path: `${shotsDir}/${name}.png`, fullPage: true });
const go = async (path) => { await page.goto(BASE + path); await page.waitForLoadState("networkidle"); };
const button = (name) => page.getByRole("button", { name, exact: false });
async function expectText(text, timeout = 30_000) { await page.getByText(text, { exact: false }).first().waitFor({ timeout }); }

const LOT = `E2E-${Date.now().toString(36).toUpperCase()}`;
const LOT_LABEL = `0002-1433-80 · lot ${LOT}`;

try {
  step(`Manufacturer registers lot ${LOT} and ships it to the distributor`);
  await go("/manufacturer");
  await page.getByLabel("Lot number").fill(LOT);
  await button("Register lot").click();
  await expectText(`Lot ${LOT} registered`);
  await page.waitForTimeout(500);
  await go("/manufacturer");
  await page.getByRole("combobox", { name: "Lot", exact: true }).selectOption({ label: LOT_LABEL });
  await page.getByRole("combobox", { name: "Recipient", exact: true }).selectOption({ index: 1 });
  await button("Ship").click();
  await expectText("waiting for the recipient to accept");

  step("Distributor accepts and forwards to Pharmacy A; pharmacy accepts");
  await go("/distributor");
  await page.locator("tr", { hasText: LOT }).filter({ hasText: "Pending" }).getByRole("button", { name: "Accept" }).click();
  await expectText("Accepted");
  await page.getByRole("combobox", { name: "Lot", exact: true }).selectOption({ label: LOT_LABEL });
  await page.getByRole("combobox", { name: "Recipient", exact: true }).selectOption({ label: "Pharmacy A · Manipal (region 1)" });
  await button("Ship").click();
  await expectText("waiting for the recipient to accept");
  await go("/pharmacy");
  await page.locator("tr", { hasText: LOT }).filter({ hasText: "Pending" }).getByRole("button", { name: "Accept" }).click();
  await page.waitForTimeout(1500);

  step("Patient creates an encrypted wallet");
  await go("/patient");
  await page.locator('input[type="password"]').fill(PIN);
  await button("Create my wallet").click();
  await expectText("not affected by any recall");
  await button("Create guardian shares").click();
  await page.locator("select").filter({ hasText: "Prescriber" }).selectOption("Family member");

  step("Prescriber issues a permit");
  await go("/prescriber");
  await button("Issue permit").click();
  const code = await page.locator("[data-code]").getAttribute("data-code", { timeout: 30_000 });

  step("Patient scans the prescription");
  await go("/patient");
  await page.locator('input[type="password"]').fill(PIN);
  await button("Unlock").click();
  await button("Add prescription").click();
  await page.getByPlaceholder("…or paste the code").fill(code);
  await button("Use").click();
  const counter = await page.locator("[data-qr]").getAttribute("data-qr", { timeout: 30_000 });
  await shot("1-patient-ready");

  step(`Pharmacy scans the patient and dispenses lot ${LOT}`);
  await go("/pharmacy");
  await page.getByPlaceholder("…or paste the code").first().fill(counter);
  await button("Use").first().click();
  await page.locator("select").first().selectOption({ label: LOT_LABEL });
  await button("Dispense (queue)").click();
  await expectText("Queued (1 waiting)");
  await button("Submit batch now").click();
  await expectText("recorded in one transaction");

  step("Regulator recalls exactly that lot");
  await go("/regulator");
  const row = page.locator("tr", { hasText: LOT });
  await row.getByRole("button", { name: "Recall" }).click();
  await expectText("Recall issued");

  step("Patient is alerted and acknowledges anonymously (real proof)");
  await go("/patient");
  await page.locator('input[type="password"]').fill(PIN);
  await button("Unlock").click();
  await expectText("has been recalled");
  await button("Send anonymous acknowledgement").click();
  await expectText("Submitted", 90_000);
  await button("Submit report").click();
  await page.getByText("Submitted").nth(1).waitFor({ timeout: 90_000 });
  const codeLabel = await page.getByText("One-time code #").first().textContent();
  if (codeLabel.includes("#0 ")) throw new Error("Used one-time code was not rotated");
  await shot("2-patient-alerted");

  step("Regulator sees the acknowledgement");
  await go("/regulator");
  await expectText("patients confirmed");
  await shot("3-regulator");

  step("Phone lost → recover from Guardians → alert restored");
  await go("/patient");
  await page.locator('input[type="password"]').fill(PIN);
  await button("Unlock").click();
  await expectText("has been recalled");
  await button("Simulate lost phone").click();
  await button("Lost my phone").click();
  await button("Demo: ask pharmacy and doctor").click();
  await page.locator('input[type="password"]').fill("1357");
  await button("Recover my wallet").click();
  await expectText("has been recalled");
  await shot("4-recovered");

  step("Public verify page flags an unregistered lot");
  await go("/verify");
  await page.getByLabel("Lot number").fill("FAKE-999");
  await button("Verify").click();
  await expectText("Not found on the ledger");

  if (errors.length) throw new Error("Browser errors:\n" + errors.join("\n"));
  console.log("\nE2E PASSED");
} catch (e) {
  await shot("failure");
  console.error("\nE2E FAILED:", e.message, errors);
  process.exitCode = 1;
} finally {
  await browser.close();
}
