import { spawn } from "node:child_process";
const children = [
  spawn(process.execPath, ["services/api/src/server.js"], {
    stdio: "inherit",
    env: {
      ...process.env,
      LOTUS_LEDGER: "local",
      LOTUS_DATA_DIR: ".lotus-dev-data",
    },
  }),
  spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1"],
    {
      cwd: "apps/web",
      stdio: "inherit",
    }
  ),
];
const stop = () => {
  for (const child of children) child.kill();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const child of children)
  child.on("exit", (code) => {
    stop();
    process.exitCode = code || 0;
  });
