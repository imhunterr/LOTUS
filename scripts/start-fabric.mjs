import { resolve } from "node:path";
import { createApp } from "../services/api/src/server.js";
const service = createApp({
  dataDir: resolve(process.env.LOTUS_DATA_DIR || ".lotus-data"),
  mode: "fabric",
  fabricConfig: resolve(".fabric-network/gateway.json"),
  fireflyConfig: resolve(".tooling/firefly/operations/client.json"),
  ipfsApi: process.env.LOTUS_IPFS_API || "http://127.0.0.1:15001",
});
const port = Number(process.env.PORT || 8787),
  host = process.env.HOST || "127.0.0.1";
const server = service.app.listen(port, host, () =>
  console.log(
    `LOTUS: http://${host}:${port} | Fabric through FireFly | encrypted IPFS documents`
  )
);
server.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
const close = async () => {
  await new Promise((done) => server.close(done));
  await service.close();
  process.exit(0);
};
process.on("SIGINT", close);
process.on("SIGTERM", close);
