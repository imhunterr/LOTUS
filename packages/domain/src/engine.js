import { createHash, timingSafeEqual } from "node:crypto";
import { poseidon2 } from "poseidon-lite";
import { keccak256 } from "ethers";
import * as snarkjs from "snarkjs";
import { FIELD, topic, signal, canonical } from "./crypto.js";

export const ROLES = [
  "manufacturer",
  "distributor",
  "pharmacy",
  "prescriber",
  "regulator",
  "operator",
  "auditor",
];
export class DomainError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
const fail = (ok, code, message, status) => {
  if (!ok) throw new DomainError(code, message, status);
};
const hash = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : canonical(value))
    .digest("hex");
const text = (value, name, max = 180) => {
  fail(
    typeof value === "string" && value.trim().length > 0 && value.length <= max,
    "INVALID_INPUT",
    `${name} is required (maximum ${max} characters).`
  );
  return value.trim();
};
const quantity = (value) => {
  fail(
    /^[1-9][0-9]{0,17}$/.test(String(value)),
    "INVALID_QUANTITY",
    "Enter a positive whole quantity in base units."
  );
  return BigInt(value);
};
const number = (value) => {
  const n = Number(value);
  fail(Number.isSafeInteger(n), "INVALID_INPUT", "Invalid whole number.");
  return n;
};
const requireRole = (actor, ...roles) =>
  fail(
    roles.includes(actor.role),
    "FORBIDDEN",
    "Your workspace does not allow this operation.",
    403
  );
const stockKey = (lot, org) => `stock:${lot}:${org}`;
const blankStock = (lotId, orgId) => ({
  lotId,
  orgId,
  available: "0",
  quarantine: "0",
  inTransit: "0",
  inbound: "0",
  dispensed: "0",
  returned: "0",
  shrinkage: "0",
});
const adjust = (stock, field, change) => {
  const value = BigInt(stock[field]) + change;
  fail(
    value >= 0n,
    "INSUFFICIENT_STOCK",
    "This quantity exceeds eligible stock."
  );
  stock[field] = value.toString();
};

// Transaction-local working state is essential: Fabric reads don't see earlier writes in a proposal.
export class WorkingState {
  constructor(repo) {
    this.repo = repo;
    this.cache = new Map();
    this.writes = new Map();
    this.events = [];
  }
  async get(key) {
    if (!this.cache.has(key)) this.cache.set(key, await this.repo.get(key));
    return structuredClone(this.cache.get(key));
  }
  put(key, value) {
    this.cache.set(key, structuredClone(value));
    this.writes.set(key, structuredClone(value));
  }
  event(type, data) {
    this.events.push({ type, ...data });
  }
  async flush() {
    for (const [key, value] of this.writes) await this.repo.put(key, value);
  }
}

export async function execute(
  repo,
  actor,
  command,
  payload,
  requestId,
  options
) {
  fail(
    /^[a-zA-Z0-9_-]{8,100}$/.test(requestId),
    "INVALID_REQUEST_ID",
    "A unique request ID is required."
  );
  const tx = new WorkingState(repo);
  const digest = hash({
    actor: { id: actor.id, orgId: actor.orgId, role: actor.role },
    command,
    payload,
  });
  const old = await tx.get(`command:${requestId}`);
  if (old) {
    fail(
      old.digest === digest,
      "IDEMPOTENCY_CONFLICT",
      "That request ID already belongs to different content.",
      409
    );
    return old.result;
  }
  const registered = await tx.get(`actor:${actor.id}`);
  fail(
    registered?.active &&
      registered.role === actor.role &&
      registered.orgId === actor.orgId,
    "FORBIDDEN",
    "This actor is not active.",
    403
  );
  if (actor.orgId)
    fail(
      (await tx.get(`org:${actor.orgId}`))?.active,
      "FORBIDDEN",
      "This organization is not active.",
      403
    );
  const now = options.now;
  const ctx = { tx, actor, payload, requestId, now, options };
  fail(
    Object.hasOwn(handlers, command),
    "UNKNOWN_COMMAND",
    "Unknown operation."
  );
  const result = await handlers[command](ctx);
  const receipt = { ...result, requestId, committedAt: now, events: tx.events };
  tx.put(`command:${requestId}`, {
    digest,
    actorId: actor.id,
    result: receipt,
  });
  await tx.flush();
  return receipt;
}

async function lot(tx, id) {
  const l = await tx.get(`lot:${id}`);
  fail(l, "LOT_NOT_FOUND", "This lot is not registered.", 404);
  return l;
}
async function stock(tx, lotId, orgId) {
  return (await tx.get(stockKey(lotId, orgId))) || blankStock(lotId, orgId);
}
async function checkDocument(tx, id, actor) {
  if (!id) return null;
  const d = await tx.get(`document:${id}`);
  fail(
    d && d.ownerOrgId === actor.orgId,
    "DOCUMENT_NOT_FOUND",
    "Upload a document belonging to your organization."
  );
  return d;
}
async function liveLot(tx, id, now) {
  const l = await lot(tx, id);
  fail(
    !l.recallId,
    "LOT_RECALLED",
    "This lot has been recalled. Dispensing is blocked."
  );
  fail(l.expiry > now, "LOT_EXPIRED", "This lot has expired.");
  return l;
}
const handlers = {
  async createOrganization({ tx, actor, payload: p, requestId }) {
    requireRole(actor, "operator");
    const type = text(p.type, "Organization type");
    fail(
      ROLES.includes(type) && type !== "operator",
      "INVALID_ROLE",
      "Choose a business organization type."
    );
    const org = {
      id: requestId,
      name: text(p.name, "Organization name"),
      type,
      region: number(p.region || 0),
      facility: text(p.facility || "Main facility", "Facility"),
      active: true,
    };
    tx.put(`org:${org.id}`, org);
    tx.event("OrganizationCreated", { orgId: org.id });
    return { organization: org };
  },
  async registerActor({ tx, actor, payload: p }) {
    requireRole(actor, "operator");
    fail(ROLES.includes(p.role), "INVALID_ROLE", "Unknown role.");
    const org = p.orgId ? await tx.get(`org:${p.orgId}`) : null;
    fail(
      ["operator", "auditor"].includes(p.role) || org?.type === p.role,
      "INVALID_ORGANIZATION",
      "Role must match the approved organization."
    );
    const a = {
      id: text(p.id, "Actor ID"),
      orgId: p.orgId || null,
      role: p.role,
      name: text(p.name, "Actor name"),
      active: true,
    };
    fail(
      !(await tx.get(`actor:${a.id}`)),
      "ACTOR_EXISTS",
      "Actor already registered."
    );
    tx.put(`actor:${a.id}`, a);
    return { actor: a };
  },
  async revokeActor({ tx, actor, payload: p }) {
    requireRole(actor, "operator");
    fail(
      p.id !== actor.id,
      "FORBIDDEN",
      "You cannot revoke your current operator access."
    );
    const a = await tx.get(`actor:${p.id}`);
    fail(a, "NOT_FOUND", "Actor not found.", 404);
    a.active = false;
    tx.put(`actor:${a.id}`, a);
    tx.event("ActorRevoked", { actorId: a.id });
    return { actor: a };
  },
  async registerDocument({ tx, actor, payload: p }) {
    requireRole(actor, "manufacturer", "distributor", "pharmacy", "regulator");
    fail(
      /^[a-f0-9]{64}$/.test(p.digest),
      "INVALID_DIGEST",
      "Invalid document digest."
    );
    const d = {
      id: text(p.id, "Document ID"),
      name: text(p.name, "Document name"),
      digest: p.digest,
      ownerOrgId: actor.orgId,
      public: p.public === true,
      mime: p.mime || "application/octet-stream",
    };
    if (p.storage === "ipfs") {
      fail(
        /^b[a-z2-7]{20,120}$/.test(p.cid) &&
          /^[a-f0-9]{64}$/.test(p.ciphertextDigest),
        "INVALID_DOCUMENT_STORAGE",
        "IPFS CID and encrypted content digest are required."
      );
      d.storage = "ipfs";
      d.cid = p.cid;
      d.ciphertextDigest = p.ciphertextDigest;
    }
    tx.put(`document:${d.id}`, d);
    return { document: d };
  },
  async registerLot({ tx, actor, payload: p, requestId, now }) {
    requireRole(actor, "manufacturer");
    const code = text(p.code, "Product code"),
      lotNumber = text(p.lotNumber, "Lot number", 80),
      namespace = text(p.namespace || "NDC", "Code namespace", 30);
    const id =
      "0x" + hash(`${actor.orgId}\0${namespace}\0${code}\0${lotNumber}`);
    fail(
      !(await tx.get(`lot:${id}`)),
      "LOT_EXISTS",
      "This manufacturer already registered that product and lot.",
      409
    );
    const qty = quantity(p.quantity),
      expiry = number(p.expiry);
    fail(expiry > now, "LOT_EXPIRED", "Expiry must be in the future.");
    const coa = await checkDocument(tx, p.documentId, actor);
    const l = {
      id,
      name: text(p.name, "Medicine name"),
      code,
      namespace,
      lotNumber,
      expiry,
      quantity: qty.toString(),
      manufacturerId: actor.orgId,
      documentId: coa?.id || null,
      registeredAt: now,
      dispensedUnits: "0",
      dispenseRecords: 0,
      reportCount: 0,
      severitySum: 0,
      safetySignal: false,
      currentSegment: 0,
    };
    tx.put(`lot:${id}`, l);
    const s = blankStock(id, actor.orgId);
    s.available = qty.toString();
    tx.put(stockKey(id, actor.orgId), s);
    tx.event("LotRegistered", { lotId: id });
    return { lot: l };
  },
  async ship({ tx, actor, payload: p, requestId, now }) {
    requireRole(actor, "manufacturer", "distributor", "pharmacy");
    const l = await lot(tx, p.lotId);
    const recipient = await tx.get(`org:${p.toOrgId}`);
    fail(
      recipient?.active &&
        ["manufacturer", "distributor", "pharmacy"].includes(recipient.type) &&
        recipient.id !== actor.orgId,
      "INVALID_RECIPIENT",
      "Choose a different approved stock recipient."
    );
    const qty = quantity(p.quantity),
      s = await stock(tx, l.id, actor.orgId);
    const isReturn = p.kind === "return";
    fail(
      !l.recallId || isReturn,
      "LOT_RECALLED",
      "Recalled stock can move only through the return workflow."
    );
    fail(
      l.expiry > now || isReturn,
      "LOT_EXPIRED",
      "Expired stock can move only through the return workflow."
    );
    const bucket =
      isReturn && BigInt(s.quarantine) >= qty ? "quarantine" : "available";
    adjust(s, bucket, -qty);
    adjust(s, "inTransit", qty);
    if (actor.role === "pharmacy") adjust(s, "returned", qty);
    const manifest = await checkDocument(tx, p.documentId, actor);
    const shipment = {
      id: requestId,
      lotId: l.id,
      fromOrgId: actor.orgId,
      toOrgId: p.toOrgId,
      quantity: qty.toString(),
      status: "pending",
      kind: isReturn ? "return" : "shipment",
      sourceBucket: bucket,
      documentId: manifest?.id || null,
      createdAt: now,
      reason: p.reason ? text(p.reason, "Reason", 500) : "",
    };
    tx.put(stockKey(l.id, actor.orgId), s);
    tx.put(`shipment:${shipment.id}`, shipment);
    tx.event("ShipmentCreated", { shipmentId: shipment.id, lotId: l.id });
    return { shipment };
  },
  async receive({ tx, actor, payload: p, now }) {
    requireRole(actor, "manufacturer", "distributor", "pharmacy");
    const sh = await tx.get(`shipment:${p.shipmentId}`);
    fail(sh, "NOT_FOUND", "Shipment not found.", 404);
    fail(
      sh.toOrgId === actor.orgId,
      "FORBIDDEN",
      "Only the named recipient can resolve this shipment.",
      403
    );
    fail(
      sh.status === "pending",
      "SHIPMENT_RESOLVED",
      "Shipment was already resolved.",
      409
    );
    fail(
      ["accept", "reject"].includes(p.action),
      "INVALID_INPUT",
      "Choose accept or reject."
    );
    const qty = quantity(sh.quantity),
      sender = await stock(tx, sh.lotId, sh.fromOrgId),
      recipient = await stock(tx, sh.lotId, sh.toOrgId),
      l = await lot(tx, sh.lotId);
    adjust(sender, "inTransit", -qty);
    if (p.action === "accept") {
      const bucket =
        sh.kind === "return" || l.recallId || l.expiry <= now
          ? "quarantine"
          : "available";
      adjust(recipient, bucket, qty);
      if ((await tx.get(`org:${sh.toOrgId}`)).type === "pharmacy")
        adjust(recipient, "inbound", qty);
    } else {
      adjust(sender, sh.sourceBucket, qty);
      if ((await tx.get(`org:${sh.fromOrgId}`)).type === "pharmacy")
        adjust(sender, "returned", -qty);
    }
    sh.status = p.action === "accept" ? "accepted" : "rejected";
    sh.resolvedAt = now;
    sh.resolution = p.reason ? text(p.reason, "Reason", 500) : "";
    tx.put(stockKey(sh.lotId, sh.fromOrgId), sender);
    tx.put(stockKey(sh.lotId, sh.toOrgId), recipient);
    tx.put(`shipment:${sh.id}`, sh);
    tx.event("ShipmentResolved", { shipmentId: sh.id, status: sh.status });
    return { shipment: sh };
  },
  async shrinkage({ tx, actor, payload: p, now, requestId }) {
    requireRole(actor, "pharmacy", "manufacturer", "distributor");
    const l = await lot(tx, p.lotId),
      s = await stock(tx, l.id, actor.orgId),
      qty = quantity(p.quantity);
    const bucket = p.bucket === "quarantine" ? "quarantine" : "available";
    adjust(s, bucket, -qty);
    adjust(s, "shrinkage", qty);
    const reason = text(p.reason, "Documented reason", 500);
    tx.put(stockKey(l.id, actor.orgId), s);
    tx.put(`adjustment:${requestId}`, {
      id: requestId,
      lotId: l.id,
      orgId: actor.orgId,
      quantity: qty.toString(),
      bucket,
      reason,
      at: now,
    });
    tx.event("ShrinkageRecorded", { lotId: l.id, quantity: qty.toString() });
    return { stock: s };
  },
  async quarantine({ tx, actor, payload: p }) {
    requireRole(actor, "pharmacy", "manufacturer", "distributor");
    const l = await lot(tx, p.lotId),
      s = await stock(tx, l.id, actor.orgId),
      qty = quantity(p.quantity);
    adjust(s, "available", -qty);
    adjust(s, "quarantine", qty);
    tx.put(stockKey(l.id, actor.orgId), s);
    tx.event("StockQuarantined", { lotId: l.id, quantity: qty.toString() });
    return { stock: s };
  },
  async issuePermit({ tx, actor, payload: p, requestId, now }) {
    requireRole(actor, "prescriber");
    const qty = quantity(p.quantity),
      expiry = number(p.expiry);
    fail(
      expiry > now,
      "PERMIT_EXPIRED",
      "Permit validity must end in the future."
    );
    fail(
      /^0x[a-fA-F0-9]{64}$/.test(p.holderCommit),
      "INVALID_COMMITMENT",
      "Invalid holder credential."
    );
    const permit = {
      id: requestId,
      code: text(p.code, "Product code"),
      namespace: text(p.namespace || "NDC", "Namespace", 30),
      balance: qty.toString(),
      quantity: qty.toString(),
      expiry,
      prescriberId: actor.orgId,
      holderCommit: p.holderCommit.toLowerCase(),
      boundOrgId: null,
      createdAt: now,
    };
    tx.put(`permit:${permit.id}`, permit);
    tx.event("PermitIssued", { permitId: permit.id });
    return { permit };
  },
  async transferPermit({ tx, actor, payload: p, now }) {
    requireRole(actor, "pharmacy");
    const permit = await tx.get(`permit:${p.permitId}`);
    fail(
      permit && permit.boundOrgId === actor.orgId,
      "FORBIDDEN",
      "Only the current pharmacy can transfer this permit.",
      403
    );
    fail(
      permit.expiry > now && BigInt(permit.balance) > 0n,
      "PERMIT_EXHAUSTED",
      "This permit is expired or exhausted."
    );
    fail(
      typeof p.permitSecret === "string" &&
        /^0x[a-fA-F0-9]{64}$/.test(p.permitSecret) &&
        keccak256(p.permitSecret) === permit.holderCommit,
      "INVALID_CREDENTIAL",
      "Scan the patient’s prescription credential to approve this transfer."
    );
    const target = await tx.get(`org:${p.toOrgId}`);
    fail(
      target?.active && target.type === "pharmacy" && target.id !== actor.orgId,
      "INVALID_RECIPIENT",
      "Choose another approved pharmacy."
    );
    permit.boundOrgId = target.id;
    tx.put(`permit:${permit.id}`, permit);
    tx.event("PermitTransferred", { permitId: permit.id });
    return { permit };
  },
  async dispense(ctx) {
    requireRole(ctx.actor, "pharmacy");
    return { receipt: await dispenseOne(ctx, ctx.payload, ctx.requestId) };
  },
  async dispenseBatch(ctx) {
    requireRole(ctx.actor, "pharmacy");
    const items = ctx.payload.items;
    fail(
      Array.isArray(items) && items.length > 0 && items.length <= 50,
      "INVALID_BATCH",
      "A batch contains between 1 and 50 fills."
    );
    const receipts = [];
    for (let i = 0; i < items.length; i++) {
      try {
        receipts.push(
          await dispenseOne(ctx, items[i], `${ctx.requestId}_${i}`)
        );
      } catch (e) {
        e.message = `Item ${i + 1}: ${e.message}`;
        throw e;
      }
    }
    return { receipts };
  },
  async recall({ tx, actor, payload: p, requestId, now }) {
    requireRole(actor, "regulator");
    const l = await lot(tx, p.lotId);
    fail(
      !l.recallId,
      "ALREADY_RECALLED",
      "An immutable recall already exists for this lot.",
      409
    );
    fail(
      [1, 2, 3].includes(number(p.classification)),
      "INVALID_CLASSIFICATION",
      "Choose Class I, II or III."
    );
    const doc = await checkDocument(tx, p.documentId, actor);
    const r = {
      id: requestId,
      lotId: l.id,
      classification: Number(p.classification),
      reason: text(p.reason, "Recall reason", 2000),
      instructions: text(p.instructions, "Patient instructions", 2000),
      fromSignal: p.fromSignal === true,
      documentId: doc?.id || null,
      regulatorId: actor.orgId,
      issuedAt: now,
      cutoffRecords: l.dispenseRecords,
      acks: 0,
      actions: { 1: 0, 2: 0, 3: 0 },
    };
    l.recallId = r.id;
    tx.put(`lot:${l.id}`, l);
    tx.put(`recall:${r.id}`, r);
    tx.event("RecallIssued", { recallId: r.id, lotId: l.id });
    return { recall: r };
  },
  async report(ctx) {
    return consumeSignal(ctx, "report");
  },
  async acknowledge(ctx) {
    return consumeSignal(ctx, "ack");
  },
};

async function dispenseOne({ tx, actor, now }, p, id) {
  const l = await liveLot(tx, p.lotId, now),
    qty = quantity(p.quantity),
    permit = await tx.get(`permit:${p.permitId}`);
  fail(permit, "PERMIT_NOT_FOUND", "Prescription permit not found.");
  fail(permit.expiry > now, "PERMIT_EXPIRED", "Prescription has expired.");
  fail(
    permit.code === l.code && permit.namespace === l.namespace,
    "WRONG_PRODUCT",
    "The shelf pack does not match the prescription."
  );
  fail(
    typeof p.permitSecret === "string" &&
      /^0x[a-fA-F0-9]{64}$/.test(p.permitSecret) &&
      keccak256(p.permitSecret) === permit.holderCommit,
    "INVALID_CREDENTIAL",
    "Prescription credential is invalid."
  );
  fail(
    !permit.boundOrgId || permit.boundOrgId === actor.orgId,
    "PHARMACY_BINDING",
    "This prescription is bound to another pharmacy. Transfer it first."
  );
  fail(
    BigInt(permit.balance) >= qty,
    "PERMIT_EXHAUSTED",
    "Quantity exceeds the prescription balance."
  );
  fail(
    /^[0-9]{1,78}$/.test(String(p.commitment)) &&
      BigInt(p.commitment) > 0n &&
      BigInt(p.commitment) < FIELD,
    "INVALID_COMMITMENT",
    "The one-time code is invalid."
  );
  fail(
    !(await tx.get(`used:${p.commitment}`)),
    "COMMITMENT_REUSED",
    "This one-time code was already used.",
    409
  );
  const s = await stock(tx, l.id, actor.orgId);
  fail(
    BigInt(s.inbound) > 0n,
    "LOT_NOT_RECEIVED",
    "Your pharmacy has not accepted this lot."
  );
  adjust(s, "available", -qty);
  adjust(s, "dispensed", qty);
  fail(
    BigInt(s.dispensed) + BigInt(s.returned) + BigInt(s.shrinkage) <=
      BigInt(s.inbound),
    "CLOSURE_VIOLATION",
    "Stock closure would be exceeded."
  );
  permit.balance = (BigInt(permit.balance) - qty).toString();
  permit.boundOrgId = actor.orgId;
  let segment = l.currentSegment,
    key = `tree:${l.id}:${segment}`,
    tree = (await tx.get(key)) || { size: 0, depth: 0, side: [] };
  if (tree.size >= 65536) {
    segment++;
    l.currentSegment = segment;
    key = `tree:${l.id}:${segment}`;
    tree = { size: 0, depth: 0, side: [] };
  }
  const leafIndex = tree.size;
  if (2 ** tree.depth < leafIndex + 1) tree.depth++;
  let node = BigInt(p.commitment);
  for (let level = 0; level < tree.depth; level++) {
    if ((leafIndex >> level) & 1)
      node = poseidon2([BigInt(tree.side[level]), node]);
    else tree.side[level] = node.toString();
  }
  tree.size++;
  tree.side[tree.depth] = node.toString();
  tree.root = node.toString();
  const org = await tx.get(`org:${actor.orgId}`);
  const receipt = {
    id,
    lotId: l.id,
    orgId: actor.orgId,
    pharmacy: org.name,
    region: org.region,
    quantity: qty.toString(),
    commitment: String(p.commitment),
    leafIndex,
    segment,
    root: tree.root,
    at: now,
  };
  l.dispensedUnits = (BigInt(l.dispensedUnits) + qty).toString();
  l.dispenseRecords++;
  tx.put(`permit:${permit.id}`, permit);
  tx.put(stockKey(l.id, actor.orgId), s);
  tx.put(`lot:${l.id}`, l);
  tx.put(key, tree);
  tx.put(`root:${l.id}:${segment}:${tree.root}`, { at: now, size: tree.size });
  tx.put(`used:${p.commitment}`, { receiptId: id });
  tx.put(`receipt:${id}`, receipt);
  tx.put(`leaf:${l.id}:${segment}:${String(leafIndex).padStart(6, "0")}`, {
    lotId: l.id,
    commitment: receipt.commitment,
    leafIndex,
    segment,
  });
  tx.event("Dispensed", { receiptId: id, lotId: l.id });
  return receipt;
}

async function consumeSignal(
  { tx, actor, payload: p, options, now, requestId },
  kind
) {
  requireRole(actor, "relay");
  const recall = kind === "ack" ? await tx.get(`recall:${p.recallId}`) : null;
  if (kind === "ack")
    fail(recall, "RECALL_NOT_FOUND", "Recall does not exist.");
  const l = await lot(tx, kind === "ack" ? recall.lotId : p.lotId),
    segment = number(p.segment || 0);
  const root = await tx.get(`root:${l.id}:${segment}:${p.root}`);
  fail(root, "UNKNOWN_ROOT", "This proof references an uncommitted lot root.");
  if (kind === "ack")
    fail(
      root.at <= recall.issuedAt,
      "POST_RECALL_ROOT",
      "Acknowledgement must use a root committed before the recall."
    );
  const value = number(kind === "ack" ? p.action : p.severity);
  fail(
    kind === "ack" ? [1, 2, 3].includes(value) : value >= 1 && value <= 5,
    "INVALID_SIGNAL",
    "Choose a valid action or severity."
  );
  fail(
    /^[0-9]{1,78}$/.test(String(p.nullifierHash)) &&
      BigInt(p.nullifierHash) < FIELD,
    "INVALID_PROOF",
    "Invalid nullifier."
  );
  const scope = kind === "ack" ? recall.id : l.id,
    external = topic(options.network, kind, scope),
    binding = signal(kind, value, kind === "report" ? p.reportDigest : "");
  if (kind === "report")
    fail(
      /^[a-f0-9]{64}$/.test(p.reportDigest),
      "INVALID_REPORT",
      "An encrypted report digest is required."
    );
  fail(
    !(await tx.get(`nullifier:${options.network}:${kind}:${p.nullifierHash}`)),
    "ALREADY_SUBMITTED",
    "This anonymous signal was already accepted.",
    409
  );
  let valid = false;
  try {
    valid = await snarkjs.groth16.verify(
      options.verificationKey,
      [String(p.root), String(p.nullifierHash), external, binding],
      p.proof
    );
  } catch {}
  fail(valid, "INVALID_PROOF", "Membership proof could not be verified.");
  tx.put(`nullifier:${options.network}:${kind}:${p.nullifierHash}`, {
    id: requestId,
  });
  if (kind === "ack") {
    recall.acks++;
    recall.actions[value]++;
    tx.put(`recall:${recall.id}`, recall);
    tx.event("RecallAcknowledged", { recallId: recall.id });
    return { accepted: true, recallId: recall.id };
  }
  const previouslyRaised = l.safetySignal;
  l.reportCount++;
  l.severitySum += value;
  l.safetySignal = l.reportCount >= options.signalThreshold;
  if (!previouslyRaised && l.safetySignal)
    tx.event("SafetySignal", {
      lotId: l.id,
      reports: l.reportCount,
      averageSeverityX100: Math.floor((l.severitySum * 100) / l.reportCount),
    });
  const report = {
    id: requestId,
    lotId: l.id,
    severity: value,
    documentId: text(p.documentId, "Encrypted report object"),
    digest: p.reportDigest,
    at: now,
  };
  tx.put(`report:${requestId}`, report);
  tx.put(`lot:${l.id}`, l);
  tx.event("AdverseEventReported", { lotId: l.id });
  return { accepted: true, reportId: report.id };
}

export function publicLot(l, organizations = []) {
  return {
    ...publicFields(l, [
      "id", "name", "code", "namespace", "lotNumber", "expiry",
      "documentId", "registeredAt", "recallId",
    ]),
    manufacturer:
      organizations.find((o) => o.id === l.manufacturerId)?.name ||
      "Registered manufacturer",
  };
}
function publicFields(record, fields) {
  return Object.fromEntries(fields.filter((field) => Object.hasOwn(record, field))
    .map((field) => [field, record[field]]));
}
// Both ledger modes use this release boundary. Unknown/new entity fields are
// private by default; membership leaves remain necessary for local proving.
export function projectPublicFeed(entities, { network, checkedAt }) {
  const all = (prefix) => Object.entries(entities)
    .filter(([key]) => key.startsWith(prefix)).map(([, value]) => value);
  const organizations = all("org:");
  return {
    lots: all("lot:").map((lot) => publicLot(lot, organizations)),
    recalls: all("recall:").map((recall) => publicFields(recall, [
      "id", "lotId", "classification", "reason", "instructions", "documentId", "issuedAt",
    ])),
    leaves: all("leaf:").map((leaf) => publicFields(leaf, [
      "lotId", "commitment", "leafIndex", "segment",
    ])),
    roots: Object.keys(entities).filter((key) => key.startsWith("root:"))
      .map((key) => ({ key })),
    network,
    checkedAt,
  };
}
export function projectSnapshot(entities, actor) {
  const values = Object.values(entities),
    all = (prefix) =>
      values
        .filter((v) => v._key?.startsWith(prefix))
        .map(({ _key, ...v }) => v);
  const organizations = all("org:").filter((o) => o.active),
    lots = all("lot:").map((l) => ({ ...l, manufacturer: publicLot(l, organizations).manufacturer })),
    recalls = all("recall:");
  const oversight = ["operator", "auditor"].includes(actor.role);
  const stocks = all("stock:").filter(
    (s) => oversight || s.orgId === actor.orgId
  );
  const shipments = all("shipment:").filter(
    (s) => oversight || s.fromOrgId === actor.orgId || s.toOrgId === actor.orgId
  );
  const permits = all("permit:").filter((p) =>
    actor.role === "prescriber"
      ? p.prescriberId === actor.orgId
      : actor.role === "pharmacy" && p.boundOrgId === actor.orgId
  );
  const receipts = all("receipt:").filter(
    (r) => actor.role === "pharmacy" && r.orgId === actor.orgId
  );
  const reports = actor.role === "regulator" ? all("report:") : [];
  const regions =
    actor.role === "regulator" ? regionalRelease(all("receipt:"), recalls) : [];
  const actors =
    actor.role === "operator"
      ? all("actor:").filter((a) => a.role !== "relay")
      : [];
  return {
    organizations,
    lots,
    stocks,
    shipments,
    permits,
    receipts,
    recalls,
    reports,
    regions,
    actors,
  };
}
export function regionalRelease(receipts, recalls) {
  return recalls.map((recall) => {
    const counts = new Map();
    for (const r of receipts.filter((r) => r.lotId === recall.lotId))
      counts.set(r.region, (counts.get(r.region) || 0) + 1);
    const entries = [...counts].sort((a, b) => a[0] - b[0]);
    const small = entries.filter(([, n]) => n < 5);
    const hide = new Set(small.map(([id]) => id));
    if (small.length === 1 && entries.length > 1)
      hide.add(
        entries
          .filter(([id]) => !hide.has(id))
          .sort((a, b) => a[1] - b[1])[0][0]
      );
    return {
      recallId: recall.id,
      cells: entries.map(([region, records]) => ({
        region,
        records: hide.has(region) ? null : records,
        suppressed: hide.has(region),
      })),
    };
  });
}
