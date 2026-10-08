import { chromium } from "playwright";
import path from "node:path";

const [, , input, output] = process.argv;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();
await page.goto("file://" + path.resolve(input));
await page.pdf({
  path: output, format: "A4", printBackground: true, preferCSSPageSize: true,
  displayHeaderFooter: true, headerTemplate: "<span></span>",
  footerTemplate: '<div style="width:100%;text-align:center;font-size:9px;color:#666;font-family:serif"><span class="pageNumber"></span></div>',
});
await browser.close();
