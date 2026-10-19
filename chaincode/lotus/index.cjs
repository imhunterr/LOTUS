const { Contract } = require("fabric-contract-api");
const {
  execute,
  projectSnapshot,
  projectPublicFeed,
  publicLot,
  DomainError,
} = require("../../packages/domain/src/engine.js");
const verificationKey = require("../../apps/web/public/zk/verification_key.json");

class FabricRepository {
  constructor(stub) {
    this.stub = stub;
  }
  async get(key) {
    const bytes = await this.stub.getState(key);
    return bytes.length ? JSON.parse(bytes.toString()) : null;
  }
  async put(key, value) {
    await this.stub.putState(key, Buffer.from(JSON.stringify(value)));
  }
  async all() {
    const iterator = this.stub.getStateByRange("", "");
    const entities = {};
    for await (const { key, value } of iterator)
      entities[key] = { ...JSON.parse(value.toString()), _key: key };
    return entities;
  }
}

class Lotus extends Contract {
  constructor() {
    super("Lotus");
  }
  async Bootstrap(ctx, network, operatorId) {
    const repo = new FabricRepository(ctx.stub);
    if (await repo.get("configuration"))
      throw new Error("Network is already bootstrapped.");
    // Development bootstrap is limited to the cryptogen admin, never an arbitrary first caller.
    if (
      ctx.clientIdentity.getMSPID() !== "Org1MSP" ||
      !ctx.clientIdentity.getID().includes("CN=Admin@org1.example.com")
    )
      throw new Error("Bootstrap requires the designated Org1 administrator.");
    await repo.put("configuration", { network, signalThreshold: 3 });
    await repo.put(
      `identity:${ctx.clientIdentity.getMSPID()}:${ctx.clientIdentity.getID()}`,
      {
        actorId: operatorId,
      }
    );
    await repo.put(`actor:${operatorId}`, {
      id: operatorId,
      role: "operator",
      orgId: null,
      name: "Consortium operator",
      active: true,
    });
    await repo.put("actor:anonymous-relay", {
      id: "anonymous-relay",
      role: "relay",
      orgId: null,
      name: "Anonymous relay",
      active: true,
    });
    return { network, operatorId };
  }
  async actor(ctx) {
    const repo = new FabricRepository(ctx.stub),
      mapping = await repo.get(
        `identity:${ctx.clientIdentity.getMSPID()}:${ctx.clientIdentity.getID()}`
      );
    if (!mapping) throw new Error("Identity is not enrolled as a LOTUS actor.");
    const actor = await repo.get(`actor:${mapping.actorId}`);
    if (!actor?.active) throw new Error("Actor is revoked.");
    return actor;
  }
  async EnrollIdentity(ctx, mspId, identityId, actorId) {
    const repo = new FabricRepository(ctx.stub),
      operator = await this.actor(ctx);
    if (operator.role !== "operator")
      throw new Error("Operator authority required.");
    if (!(await repo.get(`actor:${actorId}`)))
      throw new Error("Register the actor before enrolling its certificate.");
    const key = `identity:${mspId}:${identityId}`;
    if (await repo.get(key))
      throw new Error("Certificate is already assigned.");
    await repo.put(key, { actorId });
    return { actorId, mspId };
  }
  async Execute(ctx, requestId, command, publicJson) {
    const repo = new FabricRepository(ctx.stub),
      actor = await this.actor(ctx),
      config = await repo.get("configuration"),
      payload = JSON.parse(publicJson),
      privateJson = ctx.stub.getTransient().get("credentials");
    const credentials = privateJson ? JSON.parse(privateJson.toString()) : {};
    if (credentials.credential) payload.permitSecret = credentials.credential;
    for (let i = 0; i < (payload.items || []).length; i++)
      if (credentials[String(i)])
        payload.items[i].permitSecret = credentials[String(i)];
    const timestamp = ctx.stub.getTxTimestamp(),
      now = Number(timestamp.seconds.toString());
    let result;
    try {
      result = await execute(repo, actor, command, payload, requestId, {
        ...config,
        now,
        verificationKey,
      });
    } catch (error) {
      throw new Error(`${error.code || "REQUEST_FAILED"}: ${error.message}`);
    }
    ctx.stub.setEvent(
      "LotusCommitted",
      Buffer.from(JSON.stringify({ requestId, command, events: result.events }))
    );
    return result;
  }
  async Snapshot(ctx) {
    const actor = await this.actor(ctx),
      repo = new FabricRepository(ctx.stub);
    return projectSnapshot(await repo.all(), actor);
  }
  async CommandResult(ctx, requestId, expectedDigest) {
    const actor = await this.actor(ctx),
      repo = new FabricRepository(ctx.stub);
    const record = await repo.get(`command:${requestId}`);
    if (!record) return { found: false };
    if (record.actorId !== actor.id)
      throw new Error("FORBIDDEN: This command belongs to another actor.");
    if (record.digest !== expectedDigest)
      throw new Error(
        "IDEMPOTENCY_CONFLICT: That request ID already belongs to different content."
      );
    return { found: true, result: record.result };
  }
  async PublicFeed(ctx) {
    await this.actor(ctx);
    const repo = new FabricRepository(ctx.stub),
      entities = await repo.all();
    const config = await repo.get("configuration");
    return projectPublicFeed(entities, {
      network: config.network,
      checkedAt: Number(ctx.stub.getTxTimestamp().seconds.toString()) * 1000,
    });
  }
  async PublicObject(ctx, key) {
    const actor = await this.actor(ctx),
      repo = new FabricRepository(ctx.stub);
    if (
      !key.startsWith("lot:") &&
      !key.startsWith("org:") &&
      !key.startsWith("document:")
    )
      throw new Error("Object is not public.");
    const data = await repo.get(key);
    if (key.startsWith("lot:") && data)
      return publicLot(data, [await repo.get(`org:${data.manufacturerId}`)].filter(Boolean));
    if (
      key.startsWith("document:") &&
      data &&
      !data.public &&
      data.ownerOrgId !== actor.orgId &&
      !["regulator", "auditor"].includes(actor.role)
    )
      throw new Error("Document is restricted.");
    return data;
  }
}
module.exports.contracts = [Lotus];
