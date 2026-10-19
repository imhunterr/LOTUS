import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Certificate } from "@fidm/x509";

/** Official FireFly Core contract API. Only server-side code can select signers. */
export class FireFlyClient {
  constructor(path, fabricConfig) {
    this.config = JSON.parse(readFileSync(path, "utf8"));
    this.fabricConfig = fabricConfig;
    if (
      this.config.channel !== fabricConfig.channel ||
      this.config.chaincode !== fabricConfig.chaincode
    )
      throw new Error(
        "FireFly and Fabric must refer to the same channel and chaincode."
      );
  }
  identity(actor) {
    const i = this.fabricConfig.identities[actor.id];
    if (!i)
      throw Object.assign(new Error("An enrolled identity is required."), {
        code: "FABRIC_IDENTITY_REQUIRED",
        status: 503,
      });
    const cert = Certificate.fromPEM(readFileSync(i.certificate));
    const dn = (x) =>
      x.attributes
        .map((a) => "/" + a.shortName + "=" + a.value.replace("/", "\\/"))
        .join("");
    return {
      namespace: this.config.namespaceByMsp[i.mspId],
      key: `${i.mspId}::x509::${dn(cert.subject)}::${dn(cert.issuer)}`,
    };
  }
  async request(namespace, path, body, timeoutMs = 70000) {
    let response;
    try {
      response = await fetch(
        `${this.config.baseUrl}/api/v1/namespaces/${encodeURIComponent(
          namespace
        )}${path}`,
        {
          method: body ? "POST" : "GET",
          headers: { "Content-Type": "application/json" },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(timeoutMs),
        }
      );
    } catch {
      throw Object.assign(
        new Error(
          "FireFly is unavailable. The operation has not been confirmed."
        ),
        { code: "FIREFLY_UNAVAILABLE", status: 503 }
      );
    }
    const result = await response.json();
    if (!response.ok)
      throw Object.assign(
        new Error(
          result.error || result.message || "FireFly rejected the request."
        ),
        {
          code: "FIREFLY_REJECTED",
          status: response.status >= 500 ? 503 : 400,
          details: result,
        }
      );
    return result;
  }
  async call(
    actor,
    method,
    input = {},
    invoke = false,
    idempotencyKey,
    timeoutMs = 70000
  ) {
    const { namespace, key } = this.identity(actor);
    const body = {
      key,
      location: {
        channel: this.config.channel,
        chaincode: this.config.chaincode,
      },
      method: {
        name: `Lotus:${method}`,
        params: Object.keys(input).map((name) => ({
          name,
          schema: { type: "string" },
        })),
        returns: [],
      },
      input,
    };
    if (idempotencyKey) body.idempotencyKey = idempotencyKey;
    return this.request(
      namespace,
      `/contracts/${invoke ? "invoke?confirm=true" : "query"}`,
      body,
      timeoutMs
    );
  }
  async health() {
    const namespace = this.config.namespaceByMsp.Org1MSP;
    const response = await fetch(
      `${this.config.baseUrl}/api/v1/namespaces/${namespace}/status`,
      { signal: AbortSignal.timeout(3000) }
    );
    if (!response.ok) throw new Error(`FireFly status ${response.status}`);
    await this.call(
      this.fabricConfig.publicReader,
      "CommandResult",
      {
        requestId: `health-${randomUUID()}`,
        expectedDigest: "0".repeat(64),
      },
      false,
      undefined,
      3000
    );
    return response.json();
  }
}
