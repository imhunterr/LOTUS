import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
async function run(executable, args, options = {}) {
  const code = await new Promise((done, reject) => {
    const c = spawn(executable, args, { stdio: "inherit", ...options });
    c.on("error", reject);
    c.on("exit", done);
  });
  if (code !== 0) throw new Error(`${executable} failed (${code}).`);
}
async function officialAsset(repo, tag, name, target) {
  const meta = await fetch(
    `https://api.github.com/repos/${repo}/releases/tags/${tag}`,
    { headers: { "User-Agent": "LOTUS-tool-installer" } }
  );
  if (!meta.ok) throw new Error("Official release metadata is unavailable.");
  const asset = (await meta.json()).assets.find((a) => a.name === name);
  if (!asset?.digest?.startsWith("sha256:"))
    throw new Error("An official asset SHA-256 digest is required.");
  const r = await fetch(asset.browser_download_url);
  if (!r.ok) throw new Error("Release download failed.");
  const bytes = Buffer.from(await r.arrayBuffer());
  if (
    createHash("sha256").update(bytes).digest("hex") !== asset.digest.slice(7)
  )
    throw new Error("Release digest mismatch.");
  writeFileSync(target, bytes);
  return { repo, tag, name, sha256: asset.digest.slice(7) };
}
mkdirSync(".tooling", { recursive: true });
if (!process.env.npm_execpath)
  throw new Error(
    "Use npm run tools:install to locate the current npm runtime safely."
  );
await run(process.execPath, [
  process.env.npm_execpath,
  "ci",
  "--prefix",
  "tools/caliper",
  "--no-audit",
  "--no-fund",
]);
await run(process.env.LOTUS_PYTHON || "python", [
  "-m",
  "venv",
  ".tooling/brownie",
]);
const python = resolve(
  process.platform === "win32"
    ? ".tooling/brownie/Scripts/python.exe"
    : ".tooling/brownie/bin/python"
);
await run(python, [
  "-m",
  "pip",
  "install",
  "-r",
  "tools/brownie/requirements.txt",
]);
const kubo = resolve(".tooling/kubo");
mkdirSync(kubo, { recursive: true });
const filename =
  process.platform === "win32"
    ? "kubo_v0.43.1_windows-amd64.zip"
    : "kubo_v0.43.1_linux-amd64.tar.gz";
if (process.arch !== "x64" || !["win32", "linux"].includes(process.platform))
  throw new Error(
    "This runtime installer supports Windows/Linux x64. Install the official binary for your architecture separately."
  );
if (
  !existsSync(
    join(kubo, "kubo", process.platform === "win32" ? "ipfs.exe" : "ipfs")
  )
) {
  const archive = join(kubo, filename),
    evidence = await officialAsset("ipfs/kubo", "v0.43.1", filename, archive);
  await run("tar", ["-xf", archive, "-C", kubo]);
  writeFileSync(join(kubo, "release.json"), JSON.stringify(evidence, null, 2));
}
console.log(
  "Caliper 0.7.1, Brownie 1.22.2 and Kubo 0.43.1 installed. Build FireFly with scripts/firefly-build.sh in Ubuntu."
);
