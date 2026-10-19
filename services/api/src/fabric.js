import { readFileSync, writeFileSync } from "node:fs";
import { createPrivateKey, createHash } from "node:crypto";
import { Certificate } from "@fidm/x509";
import { FireFlyClient } from "./firefly.js";
import { canonical } from "../../../packages/domain/src/crypto.js";

// Fabric selection is explicit. A failed Fabric connection NEVER falls back to SQLite.
export class FabricLedger {
  constructor(
    store,
    configPath,
    fireflyConfig = process.env.LOTUS_FIREFLY_CONFIG
  ) {
    this.store = store;
    this.configPath = configPath;
    this.config = JSON.parse(readFileSync(configPath, "utf8"));
    this.connections = new Map();
    this.options = { ...store.options, network: this.config.network };
    this.firefly = fireflyConfig
      ? new FireFlyClient(fireflyConfig, this.config)
      : null;
    this.transport = this.firefly ? "firefly" : "fabric-gateway";
  }
  async contract(actor) {
    const identity = this.config.identities[actor.id];
    if (!identity)
      throw Object.assign(
        new Error(
          "This actor has no enrolled Fabric identity. Ask the operator to enroll it."
        ),
        { code: "FABRIC_IDENTITY_REQUIRED", status: 503 }
      );
    const key = identity.certificate;
    if (this.connections.has(key)) return this.connections.get(key).contract;
    const grpc = await import("@grpc/grpc-js");
    const { connect, signers, hash } = await import(
      "@hyperledger/fabric-gateway"
    );
    const client = new grpc.Client(
      identity.endpoint,
      grpc.credentials.createSsl(readFileSync(identity.tlsCertificate)),
      { "grpc.ssl_target_name_override": identity.peerHost }
    );
    const gateway = connect({
      client,
      identity: {
        mspId: identity.mspId,
        credentials: readFileSync(identity.certificate),
      },
      signer: signers.newPrivateKeySigner(
        createPrivateKey(readFileSync(identity.privateKey))
      ),
      hash: hash.sha256,
      evaluateOptions: () => ({ deadline: Date.now() + 15000 }),
      endorseOptions: () => ({ deadline: Date.now() + 30000 }),
      submitOptions: () => ({ deadline: Date.now() + 15000 }),
      commitStatusOptions: () => ({ deadline: Date.now() + 60000 }),
    });
    const contract = gateway
      .getNetwork(this.config.channel)
      .getContract(this.config.chaincode, "Lotus");
    this.connections.set(key, { client, gateway, contract });
    return contract;
  }
  async run(actor, command, payload, requestId) {
    const publicPayload = structuredClone(payload),
      privatePayload = {};
    for (const item of [publicPayload, ...(publicPayload.items || [])])
      if (item.permitSecret) {
        privatePayload[
          item === publicPayload
            ? "credential"
            : String(publicPayload.items.indexOf(item))
        ] = item.permitSecret;
        delete item.permitSecret;
      }
    try {
      let receipt;
      if (this.firefly && Object.keys(privatePayload).length === 0) {
        const expectedDigest = createHash("sha256")
          .update(
            canonical({
              actor: { id: actor.id, orgId: actor.orgId, role: actor.role },
              command,
              payload,
            })
          )
          .digest("hex");
        // Query includes content digest and actor authorization, so retries never
        // return a previous request's result for changed arguments.
        let committed = await this.firefly.call(actor, "CommandResult", {
          requestId,
          expectedDigest,
        });
        if (!committed.found) {
          const operation = await this.firefly.call(
            actor,
            "Execute",
            { requestId, command, publicJson: JSON.stringify(publicPayload) },
            true,
            `${requestId}-${expectedDigest.slice(0, 20)}`
          );
          if (operation.status !== "Succeeded")
            throw Object.assign(
              new Error("FireFly has not confirmed the Fabric commit."),
              { code: "COMMIT_UNKNOWN", status: 503 }
            );
          committed = await this.firefly.call(actor, "CommandResult", {
            requestId,
            expectedDigest,
          });
        }
        if (!committed.found)
          throw Object.assign(
            new Error("Fabric command result is not yet available."),
            { code: "COMMIT_UNKNOWN", status: 503 }
          );
        receipt = committed.result;
      } else {
        // Permit credentials must not be persisted in FireFly's operation store.
        // Their intentional transport is Fabric Gateway transient data.
        const contract = await this.contract(actor);
        const result = await contract.submit("Execute", {
          arguments: [requestId, command, JSON.stringify(publicPayload)],
          transientData: { credentials: JSON.stringify(privatePayload) },
        });
        receipt = JSON.parse(Buffer.from(result).toString());
      }
      this.store.db
        ?.prepare(
          "INSERT OR IGNORE INTO journal(requestId,actorId,command,result,at) VALUES(?,?,?,?,?)"
        )
        .run(
          requestId,
          actor.id,
          command,
          JSON.stringify(receipt),
          receipt.committedAt
        );
      return receipt;
    } catch (error) {
      const messages = Array.isArray(error.details)
        ? error.details.map((d) => d.message).join(" ")
        : error.message;
      const found = messages.match(/\b([A-Z][A-Z_]{3,}): ([^\n]+)/);
      if (found)
        throw Object.assign(new Error(found[2]), {
          code: found[1],
          status: found[1] === "FORBIDDEN" ? 403 : 400,
        });
      if (error.code === "FIREFLY_UNAVAILABLE") throw error;
      throw Object.assign(
        new Error(
          "Fabric confirmation is unavailable. Retry this same operation without changing its details to reconcile the original request."
        ),
        { code: "COMMIT_UNKNOWN", status: 503 }
      );
    }
  }
  async snapshot(actor) {
    if (this.firefly) return this.firefly.call(actor, "Snapshot");
    const bytes = await (
      await this.contract(actor)
    ).evaluateTransaction("Snapshot");
    return JSON.parse(Buffer.from(bytes).toString());
  }
  async assignIdentity(operator, actor) {
    this.enrollmentQueue ||= Promise.resolve();
    const task = this.enrollmentQueue.then(async () => {
      if (this.config.identities[actor.id]) return;
      const used = new Set(
        Object.values(this.config.identities).map((i) => i.certificate)
      );
      const msp = ["manufacturer", "distributor"].includes(actor.role)
        ? "Org2MSP"
        : "Org1MSP";
      const identity = this.config.identityPool?.find(
        (i) => i.mspId === msp && !used.has(i.certificate)
      );
      if (!identity)
        throw Object.assign(
          new Error(
            "No unused local enrollment certificate remains. Configure a separately enrolled identity for this actor."
          ),
          { code: "ENROLLMENT_REQUIRED", status: 503 }
        );
      const cert = Certificate.fromPEM(readFileSync(identity.certificate));
      const format = (dn) =>
        dn.attributes
          .map((a) => "/" + a.shortName + "=" + a.value.replace("/", "\\/"))
          .join("");
      await (
        await this.contract(operator)
      ).submitTransaction(
        "EnrollIdentity",
        identity.mspId,
        `x509::${format(cert.subject)}::${format(cert.issuer)}`,
        actor.id
      );
      this.config.identities[actor.id] = identity;
      writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
    });
    this.enrollmentQueue = task.catch(() => {});
    return task;
  }
  async publicFeed() {
    const actor = this.config.publicReader;
    if (this.firefly) return this.firefly.call(actor, "PublicFeed");
    const bytes = await (
      await this.contract(actor)
    ).evaluateTransaction("PublicFeed");
    return JSON.parse(Buffer.from(bytes).toString());
  }
  async get(key, actor = this.config.publicReader) {
    if (this.firefly) return this.firefly.call(actor, "PublicObject", { key });
    const bytes = await (
      await this.contract(actor)
    ).evaluateTransaction("PublicObject", key);
    return JSON.parse(Buffer.from(bytes).toString());
  }
  async close() {
    for (const c of this.connections.values()) {
      c.gateway.close();
      c.client.close();
    }
  }
}
