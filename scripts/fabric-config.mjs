import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Certificate } from "@fidm/x509";
import { FabricLedger } from "../services/api/src/fabric.js";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split("=")));
const channel = args.channel || "lotus-operations";
const output = resolve(args.output || ".fabric-network/gateway.json");
const operatorId =
  args.operator ||
  (() => {
    const db = new DatabaseSync(resolve(".lotus-data/lotus.sqlite"));
    const user = db
      .prepare(
        "SELECT id FROM users WHERE role='operator' AND active=1 LIMIT 1"
      )
      .get();
    const existingBusiness = db
      .prepare(
        "SELECT COUNT(*) AS count FROM entities WHERE key LIKE 'org:%' OR key LIKE 'lot:%' OR key LIKE 'permit:%'"
      )
      .get();
    db.close();
    if (existingBusiness.count)
      throw new Error(
        "This local profile already contains business state. Use an explicit migration or a fresh profile; implicit switching to empty Fabric state is blocked."
      );
    if (!user)
      throw new Error(
        "Complete first-run operator setup in the web interface before creating its Fabric configuration."
      );
    return user.id;
  })();
const root = resolve(".fabric-network/crypto");
function identity(org, user) {
  const domain = `org${org}.example.com`,
    msp = join(
      root,
      "peerOrganizations",
      domain,
      "users",
      `${user}@${domain}`,
      "msp"
    );
  return {
    mspId: `Org${org}MSP`,
    endpoint: `localhost:${org === 1 ? 7051 : 9051}`,
    peerHost: `peer0.${domain}`,
    certificate: join(msp, "signcerts", readdirSync(join(msp, "signcerts"))[0]),
    privateKey: join(msp, "keystore", readdirSync(join(msp, "keystore"))[0]),
    tlsCertificate: join(
      root,
      "peerOrganizations",
      domain,
      "peers",
      `peer0.${domain}`,
      "tls",
      "ca.crt"
    ),
  };
}
export function certificateId(identity) {
  return identityString(identity);
}
const admin = { id: operatorId, role: "operator", orgId: null };
const config = {
  network:
    channel === "lotus-operations"
      ? "lotus-fabric-v2"
      : `lotus-fabric-${channel}`,
  channel,
  chaincode: "lotus",
  publicReader: admin,
  identities: {
    [operatorId]: identity(1, "Admin"),
    "anonymous-relay": identity(1, "User1"),
  },
  identityPool: [],
};
for (let org = 1; org <= 2; org++)
  for (let n = org === 1 ? 2 : 1; n <= 16; n++)
    config.identityPool.push(identity(org, `User${n}`));
if (existsSync(output))
  throw new Error(
    "A Fabric configuration already exists at this path. Reuse it; do not overwrite enrolled identities by re-running bootstrap."
  );
writeFileSync(output, JSON.stringify(config, null, 2));
const ledger = new FabricLedger({ options: { signalThreshold: 3 } }, output);
try {
  const contract = await ledger.contract(admin);
  await contract.submitTransaction("Bootstrap", config.network, operatorId);
  await contract.submitTransaction(
    "EnrollIdentity",
    config.identities["anonymous-relay"].mspId,
    certificateId(config.identities["anonymous-relay"]),
    "anonymous-relay"
  );
  if (!args.operator && channel === "lotus-operations")
    writeFileSync(
      resolve(".lotus-data/ledger-profile.json"),
      JSON.stringify({ mode: "fabric", network: config.network }, null, 2),
      { mode: 0o600 }
    );
  console.log(
    `Fabric ${channel} bootstrapped; configuration saved at ${output}.`
  );
} finally {
  await ledger.close();
}

function identityString(i) {
  const cert = Certificate.fromPEM(readFileSync(i.certificate));
  const format = (dn) =>
    dn.attributes
      .map((a) => "/" + a.shortName + "=" + a.value.replace("/", "\\/"))
      .join("");
  return "x509::" + format(cert.subject) + "::" + format(cert.issuer);
}
