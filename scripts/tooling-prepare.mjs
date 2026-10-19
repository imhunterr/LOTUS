import { resolve } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { FabricLedger } from "../services/api/src/fabric.js";

// Tools may never seed the operational channel. All IDs and credentials are
// scoped to the separately bootstrapped acceptance channel.
const configPath = resolve(
  process.env.LOTUS_TOOLING_CONFIG || ".fabric-network/tooling-gateway.json"
);
const config = JSON.parse(readFileSync(configPath, "utf8"));
if (!/^lotus-(tooling|benchmark|acceptance)/.test(config.channel))
  throw new Error(
    "Tool preparation requires an isolated tooling/benchmark/acceptance channel."
  );
const ledger = new FabricLedger({ options: {} }, configPath, null);
const operator = config.publicReader;
try {
  const snapshot = await ledger.snapshot(operator);
  const actors = {};
  for (const role of [
    "manufacturer",
    "distributor",
    "pharmacy",
    "prescriber",
    "regulator",
  ]) {
    let actor = snapshot.actors.find(
      (a) => a.name === `Tooling ${role}` && a.active
    );
    if (!actor) {
      const { organization } = await ledger.run(
        operator,
        "createOrganization",
        {
          name: `Tooling ${role}`,
          type: role,
          region: 1,
          facility: "Isolated tool validation",
        },
        randomUUID()
      );
      actor = {
        id: `tool-${role}`,
        role,
        name: `Tooling ${role}`,
        orgId: organization.id,
      };
      await ledger.run(operator, "registerActor", actor, randomUUID());
    }
    await ledger.assignIdentity(operator, actor);
    actors[role] = actor;
  }
  mkdirSync(resolve(".tooling"), { recursive: true });
  writeFileSync(
    resolve(".tooling/context.json"),
    JSON.stringify({ configPath, channel: config.channel, actors }, null, 2)
  );
  console.log(
    `Tool identities ready on ${config.channel}; no operational stock created.`
  );
} finally {
  await ledger.close();
}
