import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, join, basename, dirname } from "node:path";
import { Certificate } from "@fidm/x509";

const configPath = resolve(
  process.env.LOTUS_FABRIC_CONFIG || ".fabric-network/tooling-gateway.json"
);
const config = JSON.parse(readFileSync(configPath, "utf8"));
const dir = resolve(
  process.env.LOTUS_FIREFLY_RUNTIME || ".tooling/firefly/runtime"
);
const basePort = Number(process.env.LOTUS_FIREFLY_PORT || 5200);
if (!Number.isInteger(basePort) || basePort < 1024 || basePort > 65000)
  throw new Error("Invalid FireFly base port.");
mkdirSync(dir, { recursive: true });
const linux = (p) =>
  process.platform === "win32"
    ? "/mnt/" + p[0].toLowerCase() + p.slice(2).replaceAll("\\", "/")
    : p;
const write = (name, value) =>
  writeFileSync(join(dir, name), JSON.stringify(value, null, 2), {
    mode: 0o600,
  });
const root = resolve(".fabric-network/crypto");
const peers = {},
  organizations = {},
  orderer = "orderer.example.com";
const actorKeys = {};
function fullKey(i) {
  const c = Certificate.fromPEM(readFileSync(i.certificate));
  const dn = (x) =>
    x.attributes
      .map((a) => "/" + a.shortName + "=" + a.value.replace("/", "\\/"))
      .join("");
  return `${i.mspId}::x509::${dn(c.subject)}::${dn(c.issuer)}`;
}
for (const [id, i] of Object.entries(config.identities))
  actorKeys[id] = {
    namespace: i.mspId === "Org1MSP" ? "lotus-org1" : "lotus-org2",
    key: fullKey(i),
  };
for (const n of [1, 2]) {
  const domain = `org${n}.example.com`,
    peer = `peer0.${domain}`;
  peers[peer] = {
    url: `grpcs://localhost:${n === 1 ? 7051 : 9051}`,
    tlsCACerts: {
      path: linux(
        join(root, "peerOrganizations", domain, "peers", peer, "tls/ca.crt")
      ),
    },
    grpcOptions: { "ssl-target-name-override": peer },
  };
  const users = {};
  const folder = join(root, "peerOrganizations", domain, "users");
  for (const name of readdirSync(folder)) {
    const msp = join(folder, name, "msp");
    users[name] = {
      key: {
        path: linux(
          join(msp, "keystore", readdirSync(join(msp, "keystore"))[0])
        ),
      },
      cert: {
        path: linux(
          join(msp, "signcerts", readdirSync(join(msp, "signcerts"))[0])
        ),
      },
    };
  }
  organizations[`Org${n}MSP`] = {
    mspid: `Org${n}MSP`,
    peers: [peer],
    users,
    certificateAuthorities: [`ca${n}`],
  };
}
const plugins = {
  database: [
    {
      name: "database",
      type: "sqlite3",
      sqlite3: {
        url: linux(join(dir, "firefly.sqlite")) + "?_busy_timeout=5000",
        maxConns: 1,
        migrations: {
          auto: true,
          directory: linux(
            resolve(".tooling/firefly/firefly-1.5.0/db/migrations/sqlite")
          ),
        },
      },
    },
  ],
  blockchain: [],
};
const namespaces = [];
for (const n of [1, 2]) {
  const msp = `Org${n}MSP`,
    domain = `org${n}.example.com`;
  const credentialDir = join(dir, `wallet${n}`);
  mkdirSync(credentialDir, { recursive: true });
  const ccp = {
    name: `LOTUS ${msp}`,
    version: "1.0.0",
    client: {
      organization: msp,
      credentialStore: {
        path: linux(credentialDir),
        cryptoStore: { path: linux(credentialDir) },
      },
      BCCSP: {
        security: {
          enabled: true,
          default: { provider: "SW" },
          hashAlgorithm: "SHA2",
          level: 256,
          softVerify: true,
        },
      },
    },
    organizations,
    peers,
    orderers: {
      [orderer]: {
        url: "grpcs://localhost:7050",
        tlsCACerts: {
          path: linux(
            join(
              root,
              "ordererOrganizations/example.com/orderers",
              orderer,
              "tls/ca.crt"
            )
          ),
        },
        grpcOptions: { "ssl-target-name-override": orderer },
      },
    },
    channels: {
      [config.channel]: {
        orderers: [orderer],
        peers: Object.fromEntries(
          Object.keys(peers).map((p) => [
            p,
            {
              endorsingPeer: true,
              chaincodeQuery: true,
              ledgerQuery: true,
              eventSource: true,
            },
          ])
        ),
      },
    },
    certificateAuthorities: {},
  };
  // Imported cryptogen identities are used directly. CA URLs are configuration
  // metadata only in this integration profile; no enrollment API is exposed.
  for (const k of [1, 2])
    ccp.certificateAuthorities[`ca${k}`] = {
      url: `https://127.0.0.1:${k === 1 ? 7054 : 9054}`,
      caName: `ca.org${k}.example.com`,
      tlsCACerts: {
        path: linux(
          join(
            root,
            "peerOrganizations",
            `org${k}.example.com`,
            "ca",
            readdirSync(
              join(root, "peerOrganizations", `org${k}.example.com`, "ca")
            ).find((f) => f.endsWith(".pem"))
          )
        ),
      },
    };
  write(`ccp${n}.json`, ccp);
  write(`fabconnect${n}.json`, {
    maxInFlight: 20,
    maxTXWaitTime: 60,
    sendConcurrency: 10,
    http: { port: basePort + n, localAddr: "127.0.0.1" },
    rpc: {
      configPath: linux(join(dir, `ccp${n}.json`)),
      useGatewayClient: false,
      useGatewayServer: false,
    },
    receipts: {
      maxDocs: 10000,
      queryLimit: 100,
      retryInitialDelay: 1,
      retryTimeout: 30,
      leveldb: { path: linux(join(dir, `receipts${n}`)) },
    },
    events: { leveldb: { path: linux(join(dir, `events${n}`)) } },
  });
  const plugin = `fabric${n}`;
  plugins.blockchain.push({
    name: plugin,
    type: "fabric",
    fabric: {
      fabconnect: {
        url: `http://127.0.0.1:${basePort + n}`,
        channel: config.channel,
        signer: `Admin@${domain}`,
        topic: `lotus-org${n}`,
        batchSize: 1,
        batchTimeout: 100,
      },
    },
  });
  const any = [
    ...Object.values(config.identities),
    ...(config.identityPool || []),
  ].find((i) => i.mspId === msp);
  if (!any) throw new Error(`No configured certificate exists for ${msp}.`);
  namespaces.push({
    name: `lotus-org${n}`,
    description: `LOTUS Fabric gateway for ${msp}`,
    defaultKey: fullKey(any),
    plugins: ["database", plugin],
    multiparty: { enabled: false },
  });
}
write("firefly.json", {
  log: { level: "info" },
  http: { address: "127.0.0.1", port: basePort },
  admin: { address: "127.0.0.1", port: basePort + 3 },
  debug: { port: -1 },
  metrics: { enabled: false },
  plugins,
  namespaces: { default: "lotus-org1", predefined: namespaces },
});
write("client.json", {
  baseUrl: `http://127.0.0.1:${basePort}`,
  channel: config.channel,
  chaincode: config.chaincode,
  actors: actorKeys,
  namespaceByMsp: { Org1MSP: "lotus-org1", Org2MSP: "lotus-org2" },
});
console.log(
  `FireFly configurations generated for ${
    config.channel
  }. Client config: ${join(dir, "client.json")}`
);
