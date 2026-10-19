import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { FireFlyClient } from "../services/api/src/firefly.js";
const config = JSON.parse(
  readFileSync(
    process.env.LOTUS_FABRIC_CONFIG || ".fabric-network/tooling-gateway.json",
    "utf8"
  )
);
const client = new FireFlyClient(
  process.env.LOTUS_FIREFLY_CONFIG || ".tooling/firefly/runtime/client.json",
  config
);
for (const namespace of Object.values(client.config.namespaceByMsp)) {
  const existing = await client.request(
    namespace,
    "/contracts/listeners?limit=100"
  );
  let listener = existing.find((l) => l.name === "lotus-commits");
  if (!listener)
    listener = await client.request(namespace, "/contracts/listeners", {
      name: "lotus-commits",
      topic: "lotus-commits",
      location: { channel: config.channel, chaincode: config.chaincode },
      event: {
        name: "LotusCommitted",
        params: [
          { name: "requestId", schema: { type: "string" } },
          { name: "command", schema: { type: "string" } },
          {
            name: "events",
            schema: { type: "array", items: { type: "object" } },
          },
        ],
      },
      options: { firstEvent: "0" },
    });
  console.log(
    `Durable LOTUS event listener active in ${namespace}: ${listener.id}`
  );
}
