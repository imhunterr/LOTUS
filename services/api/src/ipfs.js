import { createHash } from "node:crypto";
export class IPFSStore {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }
  async request(path, options = {}) {
    let r;
    try {
      r = await fetch(`${this.baseUrl}/api/v0/${path}`, {
        method: "POST",
        ...options,
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw Object.assign(
        new Error("The configured IPFS document service is unavailable."),
        { code: "IPFS_UNAVAILABLE", status: 503 }
      );
    }
    if (!r.ok)
      throw Object.assign(new Error("The IPFS document operation failed."), {
        code: "IPFS_FAILED",
        status: 503,
      });
    return r;
  }
  async put(ciphertext) {
    const form = new FormData();
    form.append("file", new Blob([ciphertext]), "encrypted-document.bin");
    const r = await this.request("add?pin=true&cid-version=1&raw-leaves=true", {
      body: form,
    });
    const result = JSON.parse((await r.text()).trim().split("\n").at(-1));
    if (!/^b[a-z2-7]{20,120}$/.test(result.Hash))
      throw new Error("Invalid CID returned by IPFS.");
    return {
      cid: result.Hash,
      ciphertextDigest: createHash("sha256").update(ciphertext).digest("hex"),
    };
  }
  async get(cid, expectedDigest) {
    if (!/^b[a-z2-7]{20,120}$/.test(cid))
      throw new Error("Invalid document CID.");
    const r = await this.request(`cat?arg=${encodeURIComponent(cid)}`);
    const bytes = Buffer.from(await r.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== expectedDigest)
      throw Object.assign(
        new Error("IPFS ciphertext integrity check failed."),
        { code: "DIGEST_MISMATCH", status: 500 }
      );
    return bytes;
  }
  async health() {
    return (await this.request("version")).json();
  }
}
