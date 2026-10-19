import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
const executable = resolve(
  process.platform === "win32"
    ? ".tooling/kubo/kubo/ipfs.exe"
    : ".tooling/kubo/kubo/ipfs"
);
if (!existsSync(executable))
  throw new Error("Install pinned Kubo 0.43.1 under .tooling/kubo/kubo first.");
const repository = resolve(".tooling/kubo/repository");
mkdirSync(repository, { recursive: true });
const env = { ...process.env, IPFS_PATH: repository };
function run(args) {
  const r = spawnSync(executable, args, { env, stdio: "inherit" });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error("Kubo configuration failed.");
}
if (!existsSync(resolve(repository, "config"))) {
  run(["init", "--profile=server"]);
  run(["config", "Addresses.API", "/ip4/127.0.0.1/tcp/15001"]);
  run(["config", "Addresses.Gateway", "/ip4/127.0.0.1/tcp/15080"]);
  run(["config", "--json", "Addresses.Swarm", "[]"]);
  run(["config", "--json", "Bootstrap", "[]"]);
}
run(["config", "--json", "AutoConf.Enabled", "false"]);
run(["config", "--json", "DNS.Resolvers", "{}"]);
run(["config", "--json", "Routing.DelegatedRouters", "[]"]);
run(["config", "--json", "Ipns.DelegatedPublishers", "[]"]);
// This acceptance node has no public peers or content announcements.
const child = spawn(executable, ["daemon", "--offline"], {
  env,
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code || 0));
child.on("error", (error) => {
  throw error;
});
process.on("SIGINT", () => child.kill());
process.on("SIGTERM", () => child.kill());
