import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve, delimiter } from "node:path";
import { spawn } from "node:child_process";
const executable = resolve(
  process.platform === "win32"
    ? ".tooling/brownie/Scripts/brownie.exe"
    : ".tooling/brownie/bin/brownie"
);
if (!existsSync(executable))
  throw new Error(
    "Install the project environment first: python -m venv .tooling/brownie; its pip install -r tools/brownie/requirements.txt"
  );
mkdirSync(resolve("test-results"), { recursive: true });
const code = await new Promise((done, reject) => {
  const child = spawn(
    executable,
    [
      "test",
      "-q",
      "--network",
      "hardhat",
      `--junitxml=${resolve("test-results/brownie-tests.xml")}`,
    ],
    {
      cwd: resolve("tools/brownie"),
      stdio: "inherit",
      env: {
        ...process.env,
        PATH: resolve("node_modules/.bin") + delimiter + process.env.PATH,
      },
    }
  );
  child.on("error", reject);
  child.on("exit", done);
});
if (code !== 0) throw new Error(`Brownie test suite failed (${code}).`);
const junit = readFileSync(resolve("test-results/brownie-tests.xml"), "utf8");
if (!/failures="0"/.test(junit) || !/errors="0"/.test(junit))
  throw new Error("Brownie report contains failures.");
console.log(
  "Brownie reference tests and measured EVM gas written to test-results/brownie."
);
