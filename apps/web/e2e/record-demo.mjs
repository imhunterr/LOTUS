/**
 * Records a captioned walkthrough video of the whole LOTUS demo (for the submission / viva).
 *
 *   npm run demo                         # terminal 1
 *   node apps/web/e2e/record-demo.mjs    # terminal 2 → docs/demo/lotus-demo.mp4 (needs ffmpeg for mp4)
 *
 * The flow mirrors full-demo.mjs but slower, with a caption bar explaining each step.
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";

const BASE = process.env.WEB_URL || "http://localhost:5173";
const OUT = path.resolve(process.env.OUT_DIR || "docs/demo");
const TMP = path.join(OUT, ".raw");
const PIN = "2468";
const LOT = `D3${Date.now().toString().slice(-5)}`;
const LOT_LABEL = `0002-1433-80 · lot ${LOT}`;
const SIZE = { width: 1440, height: 900 };

mkdirSync(TMP, { recursive: true });
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), slowMo: 120 });
const context = await browser.newContext({ viewport: SIZE, recordVideo: { dir: TMP, size: SIZE } });
const page = await context.newPage();
page.on("dialog", (d) => d.dismiss());

let current = "";
async function caption(text) {
  current = text;
  await page.evaluate((t) => {
    let el = document.getElementById("lotus-caption");
    if (!el) {
      el = document.createElement("div");
      el.id = "lotus-caption";
      el.style.cssText = "position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:99999;max-width:1100px;padding:14px 22px;border-radius:14px;background:rgba(10,12,18,.92);border:1px solid #f472b6;color:#fff;font:600 19px/1.4 Inter,system-ui,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.5);text-align:center";
      document.body.appendChild(el);
    }
    el.textContent = t;
  }, text);
}
const pause = (ms = 2200) => page.waitForTimeout(ms);
async function go(p, text) {
  await page.goto(BASE + p);
  await page.waitForLoadState("networkidle");
  await caption(text ?? current);
}
const button = (name) => page.getByRole("button", { name, exact: false });
const see = (t, timeout = 60_000) => page.getByText(t, { exact: false }).first().waitFor({ timeout });
const unlock = async () => { await page.locator('input[type="password"]').fill(PIN); await button("Unlock").click(); };

try {
  await go("/", "LOTUS: when one batch of a medicine is recalled, alert only the patients who got that batch, privately.");
  await pause(4500);

  await go("/manufacturer", "1 · The manufacturer registers a new batch (lot) on the blockchain.");
  await page.getByLabel("Lot number").fill(LOT);
  await pause(1200);
  await button("Register lot").click();
  await see(`Lot ${LOT} registered`);
  await pause(1500);
  await go("/manufacturer", "…and ships it to the distributor. Custody only moves when the receiver accepts.");
  await page.getByRole("combobox", { name: "Lot", exact: true }).selectOption({ label: LOT_LABEL });
  await page.getByRole("combobox", { name: "Recipient", exact: true }).selectOption({ index: 1 });
  await button("Ship").click();
  await see("waiting for the recipient");
  await pause();

  await go("/distributor", "2 · The distributor accepts the shipment and forwards stock to a pharmacy.");
  await page.locator("tr", { hasText: LOT }).filter({ hasText: "Pending" }).getByRole("button", { name: "Accept" }).click();
  await pause(1500);
  await page.getByRole("combobox", { name: "Lot", exact: true }).selectOption({ label: LOT_LABEL });
  await page.getByRole("combobox", { name: "Recipient", exact: true }).selectOption({ label: "Pharmacy A · Manipal (region 1)" });
  await button("Ship").click();
  await see("waiting for the recipient");
  await pause(1500);
  await go("/pharmacy", "The pharmacy accepts. Now the chain knows exactly what stock it holds.");
  await page.locator("tr", { hasText: LOT }).filter({ hasText: "Pending" }).getByRole("button", { name: "Accept" }).click();
  await pause(2500);

  await go("/patient", "3 · The patient sets up the LOTUS app. A secret is created on the phone and encrypted with a PIN.");
  await page.locator('input[type="password"]').fill(PIN);
  await pause(1200);
  await button("Create my wallet").click();
  await see("not affected by any recall");
  await caption("Guardians: the secret is split into 3 shares. The patient picks a family member as the third guardian.");
  await button("Create guardian shares").click();
  await page.locator("select").filter({ hasText: "Prescriber" }).selectOption("Family member");
  await pause(3500);

  await go("/prescriber", "4 · The doctor issues an e-prescription. It holds no name, only a one-time secret for the patient.");
  await button("Issue permit").click();
  const code = await page.locator("[data-code]").getAttribute("data-code", { timeout: 60_000 });
  await pause(3000);

  await go("/patient", "The patient scans the prescription into the app (pasted here, since this is a desktop recording).");
  await unlock();
  await button("Add prescription").click();
  await page.getByPlaceholder("…or paste the code").fill(code);
  await button("Use").click();
  const counter = await page.locator("[data-qr]").getAttribute("data-qr", { timeout: 60_000 });
  await caption("At the counter the app shows this QR: the prescription plus a one-time code. The secret never leaves the phone.");
  await pause(4500);

  await go("/pharmacy", "5 · The pharmacy scans the patient and dispenses a box from the new lot.");
  await page.getByPlaceholder("…or paste the code").first().fill(counter);
  await button("Use").first().click();
  await page.locator("select").first().selectOption({ label: LOT_LABEL });
  await pause(1500);
  await button("Dispense (queue)").click();
  await see("Queued");
  await caption("Dispenses are queued and sent in batches, so nobody watching the counter can match a person to an on-chain record.");
  await pause(3500);
  await button("Submit batch now").click();
  await see("recorded in one transaction");
  await caption("Recorded. Closure book: a pharmacy can never dispense more of a lot than it received.");
  await pause(4000);

  await go("/regulator", "6 · The regulator recalls exactly this lot, not the whole drug.");
  await pause(2000);
  await page.locator("tr", { hasText: LOT }).getByRole("button", { name: "Recall" }).click();
  await see("Recall issued");
  await caption("The regulator sees counts per district, never names. Districts with fewer than 5 patients are hidden.");
  await page.mouse.wheel(0, 900);
  await pause(4500);

  await go("/patient", "7 · On the patient's phone: matching happens locally, and only the affected patient sees this.");
  await unlock();
  await see("has been recalled");
  await pause(3000);
  await caption("Alerts are available in English, Hindi, Kannada and Telugu.");
  await page.locator("select").first().selectOption("hi");
  await pause(3000);
  await page.locator("select").first().selectOption("en");
  await caption("The patient confirms anonymously with a zero-knowledge proof, made in the browser and sent gas-free.");
  await page.mouse.wheel(0, 900);
  await button("Send anonymous acknowledgement").click();
  await see("Submitted", 120_000);
  await pause(2000);
  await caption("And reports a side effect. Only real recipients of this lot can report, and only once.");
  await page.getByPlaceholder("e.g. rash").fill("rash and dizziness after 2 days");
  await button("Submit report").click();
  await page.getByText("Submitted").nth(1).waitFor({ timeout: 120_000 });
  await pause(3000);

  await go("/regulator", "8 · The regulator now sees how many affected patients got the message, without knowing who they are.");
  await page.mouse.wheel(0, 900);
  await pause(4500);
  await page.mouse.wheel(0, -900);
  await caption("Real FDA recall notices can be replayed: LOTUS recalls only the lots named in the notice.");
  await pause(2500);
  const replay = button("Replay this recall");
  if (await replay.count()) {
    await replay.click();
    await see("exactly");
  }
  await pause(4500);

  await go("/patient", "9 · The patient loses their phone. Two of the three Guardians can restore everything.");
  await unlock();
  await see("has been recalled");
  await button("Simulate lost phone").click();
  await pause(1500);
  await button("Lost my phone").click();
  await button("Demo: ask pharmacy and doctor").click();
  await page.locator('input[type="password"]').fill("1357");
  await pause(1500);
  await button("Recover my wallet").click();
  await see("has been recalled");
  await caption("Recovered: the whole history and the recall alert are back.");
  await pause(4000);

  await go("/verify", "10 · Anyone can check a pack. An unregistered lot is flagged as a possible counterfeit.");
  await page.getByLabel("Lot number").fill("FAKE-999");
  await button("Verify").click();
  await see("Not found on the ledger");
  await pause(3000);
  await page.getByLabel("Lot number").fill(LOT);
  await button("Verify").click();
  await caption("A genuine lot shows its full chain of custody, and its recall status.");
  await pause(4500);

  await go("/", "LOTUS: the right patients, only them, and nobody learns who they are.");
  await pause(4000);
} finally {
  await context.close();
  await browser.close();
}

const raw = readdirSync(TMP).find((f) => f.endsWith(".webm"));
const webm = path.join(OUT, "lotus-demo.webm");
renameSync(path.join(TMP, raw), webm);
rmSync(TMP, { recursive: true, force: true });
try {
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", webm, "-c:v", "libx264", "-preset", "slow", "-crf", "28", "-pix_fmt", "yuv420p", "-movflags", "+faststart", path.join(OUT, "lotus-demo.mp4")]);
  rmSync(webm);
  console.log("Saved", path.join(OUT, "lotus-demo.mp4"));
} catch {
  console.log("ffmpeg not found; saved", webm);
}
