import express from "express";
import {
  randomBytes,
  randomUUID,
  createHash,
  scryptSync,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
  privateDecrypt,
  constants,
  sign,
} from "node:crypto";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Store } from "./store.js";
import { FabricLedger } from "./fabric.js";
import { IPFSStore } from "./ipfs.js";
import { DomainError, projectPublicFeed } from "../../../packages/domain/src/engine.js";
import { parseLotNumbers } from "../../../sdk/src/fda.js";
import { canonical } from "../../../packages/domain/src/crypto.js";

const digest = (value) => createHash("sha256").update(value).digest("hex");
function passwordHash(password) {
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 200
  )
    throw new DomainError(
      "WEAK_PASSWORD",
      "Use a password with at least 12 characters."
    );
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
function passwordMatches(password, stored) {
  const [salt, key] = stored.split(":");
  return (
    typeof password === "string" &&
    password.length <= 200 &&
    timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(key, "hex"))
  );
}
const userView = (u) =>
  u
    ? { id: u.id, email: u.email, name: u.name, role: u.role, orgId: u.orgId }
    : null;
const email = (value) => {
  if (
    typeof value !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ||
    value.length > 180
  )
    throw new DomainError("INVALID_EMAIL", "Enter a valid email.");
  return value.trim().toLowerCase();
};
const asyncRoute = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res)).catch(next);

export function createApp({
  dataDir = resolve(".lotus-data"),
  dbPath,
  mode = process.env.LOTUS_LEDGER || "local",
  fabricConfig = process.env.LOTUS_FABRIC_CONFIG,
  fireflyConfig = process.env.LOTUS_FIREFLY_CONFIG,
  ipfsApi = process.env.LOTUS_IPFS_API,
  sandbox = process.env.LOTUS_SANDBOX === "1",
} = {}) {
  mkdirSync(dataDir, { recursive: true });
  const store = new Store(
    dbPath || resolve(dataDir, "lotus.sqlite"),
    sandbox ? { network: "lotus-sandbox-v2" } : {}
  );
  if (!["local", "fabric"].includes(mode))
    throw new Error("LOTUS_LEDGER must be local or fabric.");
  if (mode === "fabric" && !fabricConfig)
    throw new Error(
      "LOTUS_FABRIC_CONFIG is required; local fallback is disabled."
    );
  const ledger =
    mode === "fabric"
      ? new FabricLedger(store, fabricConfig, fireflyConfig)
      : store;
  const ipfs = ipfsApi ? new IPFSStore(ipfsApi) : null;
  const profilePath = resolve(dataDir, "ledger-profile.json");
  const profile = { mode, network: ledger.options.network };
  if (existsSync(profilePath)) {
    const previous = JSON.parse(readFileSync(profilePath, "utf8"));
    if (
      previous.mode !== profile.mode ||
      previous.network !== profile.network
    ) {
      store.db.close();
      throw new Error(
        "This data directory belongs to a different ledger profile. Use an isolated directory or an explicit migration."
      );
    }
  } else
    writeFileSync(profilePath, JSON.stringify(profile, null, 2), {
      mode: 0o600,
    });
  const db = store.db;
  const keyPath = resolve(dataDir, "storage.key");
  if (!existsSync(keyPath))
    writeFileSync(keyPath, randomBytes(32), { mode: 0o600 });
  const storageKey = readFileSync(keyPath);
  const safetyPath = resolve(dataDir, "safety-private.pem");
  if (!existsSync(safetyPath)) {
    const keys = generateKeyPairSync("rsa", {
      modulusLength: 3072,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    writeFileSync(safetyPath, keys.privateKey, { mode: 0o600 });
  }
  const safetyPrivate = createPrivateKey(readFileSync(safetyPath));
  const safetyPublic = createPublicKey(safetyPrivate).export({ format: "jwk" });
  const receiptKeyPath = resolve(dataDir, "receipt-private.pem");
  if (!existsSync(receiptKeyPath)) {
    const keys = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    writeFileSync(receiptKeyPath, keys.privateKey, { mode: 0o600 });
  }
  const receiptPrivate = createPrivateKey(readFileSync(receiptKeyPath)),
    receiptPublic = createPublicKey(receiptPrivate).export({ format: "jwk" });
  const signedReceipt = (receipt) => {
    const record = {
      v: 2,
      type: "receipt",
      network: ledger.options.network,
      ...receipt,
    };
    return {
      ...record,
      signature: sign("sha256", Buffer.from(canonical(record)), {
        key: receiptPrivate,
        dsaEncoding: "ieee-p1363",
      }).toString("base64"),
    };
  };
  const relay = {
    id: "anonymous-relay",
    role: "relay",
    orgId: null,
    name: "Anonymous relay",
    active: true,
  };
  if (mode === "local" && !store.get(`actor:${relay.id}`))
    store.put(`actor:${relay.id}`, relay);
  const seal = (bytes) => {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", storageKey, iv);
    const body = Buffer.concat([cipher.update(bytes), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]);
  };
  const open = (bytes) => {
    const d = createDecipheriv(
      "aes-256-gcm",
      storageKey,
      bytes.subarray(0, 12)
    );
    d.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([d.update(bytes.subarray(28)), d.final()]);
  };
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "8mb" }));
  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    });
    next();
  });
  const attempts = new Map();
  app.use("/api", (req, res, next) => {
    const key = req.ip,
      now = Date.now(),
      entry = attempts.get(key) || { start: now, count: 0 };
    if (now - entry.start > 60000) {
      entry.start = now;
      entry.count = 0;
    }
    entry.count++;
    attempts.set(key, entry);
    if (attempts.size > 10000)
      for (const [k, v] of attempts)
        if (now - v.start > 60000) attempts.delete(k);
    if (entry.count > 300)
      return res.status(429).json({
        error: {
          code: "RATE_LIMIT",
          message: "Too many requests. Try again shortly.",
        },
      });
    next();
  });
  app.use("/api", (req, res, next) => {
    const cookie = req.headers.cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("lotus_session="))
      ?.slice(14);
    const session = cookie
      ? db
          .prepare("SELECT * FROM sessions WHERE hash=? AND expires>?")
          .get(digest(cookie), Date.now())
      : null;
    const user = session
      ? db
          .prepare("SELECT * FROM users WHERE id=? AND active=1")
          .get(session.userId)
      : null;
    req.user = userView(user);
    req.session = session;
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.get("origin"),
        host = req.get("host");
      if (origin && new URL(origin).host !== host)
        return res.status(403).json({
          error: {
            code: "ORIGIN_REJECTED",
            message: "Request origin is not allowed.",
          },
        });
      if (session && req.get("x-csrf-token") !== session.csrf)
        return res.status(403).json({
          error: {
            code: "CSRF_REQUIRED",
            message: "Refresh your session before submitting.",
          },
        });
    }
    next();
  });
  const authenticated = (req, res, next) =>
    req.user
      ? next()
      : res.status(401).json({
          error: {
            code: "SIGN_IN_REQUIRED",
            message: "Sign in to this workspace.",
          },
        });
  const operator = (req, res, next) =>
    req.user?.role === "operator"
      ? next()
      : res.status(403).json({
          error: {
            code: "FORBIDDEN",
            message: "Operator access is required.",
          },
        });
  const loginSession = (res, u) => {
    const token = randomBytes(32).toString("hex"),
      csrf = randomBytes(24).toString("hex");
    db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(
      digest(token),
      u.id,
      csrf,
      Date.now() + 8 * 3600000
    );
    res.cookie("lotus_session", token, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.LOTUS_SECURE_COOKIES === "1",
      maxAge: 8 * 3600000,
      path: "/",
    });
    return { user: userView(u), csrf };
  };
  app.get("/api/session", (req, res) =>
    res.json({
      user: req.user,
      csrf: req.session?.csrf || null,
      setupRequired: !db.prepare("SELECT id FROM users LIMIT 1").get(),
      ledger: mode,
      transport: mode === "fabric" ? ledger.transport : "sqlite",
      network: ledger.options.network,
      sandbox,
    })
  );
  app.post(
    "/api/setup",
    asyncRoute(async (req, res) => {
      if (db.prepare("SELECT id FROM users LIMIT 1").get())
        throw new DomainError(
          "SETUP_COMPLETE",
          "An operator already exists.",
          409
        );
      if (
        !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
          req.socket.remoteAddress
        )
      )
        throw new DomainError(
          "LOCAL_SETUP_ONLY",
          "Initial setup must be completed on this computer.",
          403
        );
      const user = {
        id: mode === "fabric" ? ledger.config.publicReader.id : randomUUID(),
        email: email(req.body.email),
        name: String(req.body.name || "Workspace operator").slice(0, 180),
        role: "operator",
        orgId: null,
        password: passwordHash(req.body.password),
      };
      if (mode === "fabric") {
        if (
          ledger.config.publicReader.role !== "operator" ||
          ledger.config.publicReader.orgId !== null
        )
          throw new DomainError(
            "FABRIC_BOOTSTRAP_REQUIRED",
            "First-run identity must be an enrolled operator.",
            503
          );
        const state = await ledger.snapshot(ledger.config.publicReader);
        if (
          state.organizations.length ||
          state.lots.length ||
          state.receipts.length ||
          state.permits.length
        )
          throw new DomainError(
            "PROFILE_IN_USE",
            "This Fabric profile already has business state. Restore its authorized staff database.",
            409
          );
        if (db.prepare("SELECT id FROM users LIMIT 1").get())
          throw new DomainError(
            "SETUP_COMPLETE",
            "An operator already exists.",
            409
          );
      }
      db.prepare(
        "INSERT INTO users(id,email,name,role,orgId,password) VALUES(?,?,?,?,?,?)"
      ).run(user.id, user.email, user.name, user.role, null, user.password);
      store.put(`actor:${user.id}`, { ...userView(user), active: true });
      res.status(201).json(loginSession(res, user));
    })
  );
  app.post(
    "/api/login",
    asyncRoute(async (req, res) => {
      const u = db
        .prepare("SELECT * FROM users WHERE email=? AND active=1")
        .get(email(req.body.email));
      if (!u || !passwordMatches(req.body.password, u.password))
        throw new DomainError(
          "INVALID_LOGIN",
          "Email or password is incorrect.",
          401
        );
      res.json(loginSession(res, u));
    })
  );
  app.post("/api/logout", (req, res) => {
    if (req.session)
      db.prepare("DELETE FROM sessions WHERE hash=?").run(req.session.hash);
    res.clearCookie("lotus_session", { path: "/" });
    res.json({ ok: true });
  });
  app.post(
    "/api/invitations",
    authenticated,
    operator,
    asyncRoute(async (req, res) => {
      const p = req.body,
        org = await ledger.get(`org:${p.orgId}`);
      if (!org || org.type !== p.role)
        throw new DomainError(
          "INVALID_ORGANIZATION",
          "Choose an organization matching the staff role."
        );
      const token = randomBytes(32).toString("hex");
      db.prepare("INSERT INTO invitations VALUES(?,?,?,?,?,?,0)").run(
        digest(token),
        email(p.email),
        String(p.name || "Staff member").slice(0, 180),
        p.role,
        p.orgId,
        Date.now() + 7 * 86400000
      );
      res.status(201).json({
        url: `/join?invite=${token}`,
        expiresAt: Date.now() + 7 * 86400000,
      });
    })
  );
  app.get(
    "/api/invitations/:token",
    asyncRoute(async (req, res) => {
      const i = db
        .prepare(
          "SELECT * FROM invitations WHERE hash=? AND used=0 AND expires>?"
        )
        .get(digest(req.params.token), Date.now());
      if (!i)
        throw new DomainError(
          "INVITATION_EXPIRED",
          "Invitation is unavailable or expired.",
          404
        );
      res.json({ name: i.name, email: i.email, role: i.role });
    })
  );
  app.post(
    "/api/join",
    asyncRoute(async (req, res) => {
      const i = db
        .prepare(
          "SELECT * FROM invitations WHERE hash=? AND used=0 AND expires>?"
        )
        .get(digest(String(req.body.token)), Date.now());
      if (!i)
        throw new DomainError(
          "INVITATION_EXPIRED",
          "Invitation is unavailable or expired.",
          404
        );
      if (db.prepare("SELECT id FROM users WHERE email=?").get(i.email))
        throw new DomainError(
          "EMAIL_EXISTS",
          "A staff account already uses that email.",
          409
        );
      const u = {
        id: `member_${i.hash.slice(0, 32)}`,
        email: i.email,
        name: i.name,
        role: i.role,
        orgId: i.orgId,
        password: passwordHash(req.body.password),
      };
      const admin = userView(
        db
          .prepare(
            "SELECT * FROM users WHERE role='operator' AND active=1 LIMIT 1"
          )
          .get()
      );
      const claimed = db
        .prepare("UPDATE invitations SET used=1 WHERE hash=? AND used=0")
        .run(i.hash);
      if (!claimed.changes)
        throw new DomainError(
          "INVITATION_USED",
          "This invitation was already accepted.",
          409
        );
      try {
        await ledger.run(
          admin,
          "registerActor",
          userView(u),
          `invite_${i.hash}`
        );
        if (mode === "fabric") await ledger.assignIdentity(admin, userView(u));
        db.prepare(
          "INSERT INTO users(id,email,name,role,orgId,password) VALUES(?,?,?,?,?,?)"
        ).run(u.id, u.email, u.name, u.role, u.orgId, u.password);
      } catch (error) {
        db.prepare("UPDATE invitations SET used=0 WHERE hash=?").run(i.hash);
        throw error;
      }
      res.status(201).json(loginSession(res, u));
    })
  );
  app.get(
    "/api/workspace",
    authenticated,
    asyncRoute(async (req, res) =>
      res.json({
        ...(await ledger.snapshot(req.user)),
        user: req.user,
        ledger: mode,
        transport: mode === "fabric" ? ledger.transport : "sqlite",
        network: ledger.options.network,
        checkedAt: Date.now(),
        sandbox,
      })
    )
  );
  app.post(
    "/api/commands",
    authenticated,
    asyncRoute(async (req, res) => {
      const { command, payload, requestId } = req.body;
      const result = await ledger.run(
        req.user,
        command,
        payload || {},
        requestId
      );
      if (result.receipt) result.receipt = signedReceipt(result.receipt);
      if (result.receipts) result.receipts = result.receipts.map(signedReceipt);
      if (command === "revokeActor") {
        db.prepare("UPDATE users SET active=0 WHERE id=?").run(payload.id);
        db.prepare("DELETE FROM sessions WHERE userId=?").run(payload.id);
      }
      res.json({ status: "committed", ledger: mode, result });
    })
  );
  app.get(
    "/api/receipts/:id",
    authenticated,
    asyncRoute(async (req, res) => {
      if (req.user.role !== "pharmacy")
        throw new DomainError("FORBIDDEN", "Pharmacy access is required.", 403);
      const record = (await ledger.snapshot(req.user)).receipts.find(
        (r) => r.id === req.params.id
      );
      if (!record)
        throw new DomainError(
          "NOT_FOUND",
          "This receipt is outside your pharmacy scope.",
          404
        );
      res.json({ receipt: signedReceipt(record) });
    })
  );
  app.get(
    "/api/audit",
    authenticated,
    asyncRoute(async (req, res) => {
      if (!["operator", "auditor"].includes(req.user.role))
        throw new DomainError("FORBIDDEN", "Audit scope required.", 403);
      const rows = db
        .prepare(
          "SELECT seq,requestId,actorId,command,at FROM journal ORDER BY seq DESC LIMIT 200"
        )
        .all();
      res.json({
        rows,
        ledger: mode,
        note:
          mode === "fabric"
            ? "Application journal; authoritative commits reside in Fabric."
            : "Committed local operation journal.",
      });
    })
  );
  app.get(
    "/api/integrations",
    authenticated,
    asyncRoute(async (req, res) => {
      if (!["operator", "auditor"].includes(req.user.role))
        throw new DomainError(
          "FORBIDDEN",
          "Operator or auditor scope required.",
          403
        );
      const readEvidence = (path) =>
        existsSync(resolve(path))
          ? JSON.parse(readFileSync(resolve(path), "utf8"))
          : null;
      let firefly = { configured: Boolean(ledger.firefly), connected: false };
      if (ledger.firefly) {
        try {
          await ledger.firefly.health();
          firefly.connected = true;
        } catch (error) {
          firefly.error = error.message;
        }
      }
      let documentStorage = {
        type: ipfs ? "ipfs" : "encrypted-sqlite",
        connected: false,
      };
      if (ipfs) {
        try {
          const version = await ipfs.health();
          documentStorage.connected = true;
          documentStorage.version = version.Version;
        } catch (error) {
          documentStorage.error = error.message;
        }
      } else documentStorage.connected = true;
      res.json({
        checkedAt: Date.now(),
        ledger: mode,
        transport: mode === "fabric" ? ledger.transport : "sqlite",
        network: ledger.options.network,
        firefly,
        documentStorage,
        caliper: readEvidence("test-results/caliper/latest.json"),
        brownie: readEvidence("test-results/brownie/gas-reference.json"),
        verification: readEvidence("test-results/firefly/acceptance.json"),
      });
    })
  );
  app.put("/api/drafts/:id", authenticated, (req, res) => {
    const id = String(req.params.id).slice(0, 100);
    if (JSON.stringify(req.body).length > 200000)
      return res
        .status(413)
        .json({ error: { message: "Draft is too large." } });
    db.prepare(
      "INSERT INTO drafts VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt WHERE drafts.userId=excluded.userId"
    ).run(
      id,
      req.user.id,
      seal(Buffer.from(JSON.stringify(req.body))).toString("base64"),
      Date.now()
    );
    res.json({ ok: true });
  });
  app.get("/api/drafts/:id", authenticated, (req, res) => {
    const row = db
      .prepare("SELECT value FROM drafts WHERE id=? AND userId=?")
      .get(req.params.id, req.user.id);
    res.json({
      draft: row
        ? JSON.parse(open(Buffer.from(row.value, "base64")).toString())
        : null,
    });
  });
  app.post(
    "/api/documents",
    authenticated,
    asyncRoute(async (req, res) => {
      const { base64, name, mime, public: isPublic } = req.body;
      if (typeof base64 !== "string" || base64.length > 7500000)
        throw new DomainError(
          "FILE_TOO_LARGE",
          "Choose a document under 5 MB."
        );
      const bytes = Buffer.from(base64, "base64");
      if (!bytes.length || bytes.length > 5 * 1024 * 1024)
        throw new DomainError(
          "INVALID_DOCUMENT",
          "Document is empty or too large."
        );
      const id = randomUUID(),
        hash = digest(bytes);
      const encrypted = seal(bytes);
      const location = ipfs
        ? { storage: "ipfs", ...(await ipfs.put(encrypted)) }
        : {};
      const result = await ledger.run(
        req.user,
        "registerDocument",
        {
          id,
          name: String(name).slice(0, 180),
          mime: String(mime || "application/octet-stream").slice(0, 100),
          digest: hash,
          public: isPublic === true,
          ...location,
        },
        randomUUID()
      );
      db.prepare("INSERT INTO documents VALUES(?,?,?,?,?,?,?,?)").run(
        id,
        req.user.orgId,
        String(name).slice(0, 180),
        String(mime || "application/octet-stream").slice(0, 100),
        hash,
        encrypted,
        0,
        Date.now()
      );
      res.status(201).json(result.document);
    })
  );
  app.get(
    "/api/documents/:id",
    asyncRoute(async (req, res) => {
      const d = db
          .prepare("SELECT * FROM documents WHERE id=?")
          .get(req.params.id),
        record = await ledger.get(
          `document:${req.params.id}`,
          req.user || undefined
        );
      if (!d || d.anonymous || !record)
        throw new DomainError(
          "DOCUMENT_NOT_FOUND",
          "Document is unavailable.",
          404
        );
      if (
        !record.public &&
        (!req.user ||
          (req.user.orgId !== record.ownerOrgId &&
            !["regulator", "auditor"].includes(req.user.role)))
      )
        throw new DomainError("FORBIDDEN", "This document is restricted.", 403);
      if (record.storage === "ipfs" && !ipfs)
        throw new DomainError(
          "IPFS_UNAVAILABLE",
          "Configure IPFS to retrieve this document.",
          503
        );
      const encrypted =
        record.storage === "ipfs"
          ? await ipfs.get(record.cid, record.ciphertextDigest)
          : d.bytes;
      const bytes = open(encrypted);
      if (digest(bytes) !== d.digest)
        throw new DomainError(
          "DIGEST_MISMATCH",
          "Document integrity check failed.",
          500
        );
      res.set({
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${d.name.replace(
          /[^a-zA-Z0-9._-]/g,
          "_"
        )}"`,
        "X-Content-SHA256": d.digest,
      });
      res.send(bytes);
    })
  );
  const localFeed = () => {
    return projectPublicFeed(store.entities(), {
      network: ledger.options.network,
      checkedAt: Date.now(),
    });
  };
  app.get(
    "/api/public/feed",
    asyncRoute(async (req, res) =>
      res.json({
        ...(mode === "fabric" ? await ledger.publicFeed() : localFeed()),
        receiptKey: receiptPublic,
      })
    )
  );
  app.get(
    "/api/public/verify",
    asyncRoute(async (req, res) => {
      const feed = mode === "fabric" ? await ledger.publicFeed() : localFeed();
      const matches = feed.lots.filter(
        (l) =>
          l.code === req.query.code &&
          l.lotNumber === req.query.lot &&
          (!req.query.namespace || l.namespace === req.query.namespace)
      );
      const scope = await ledger.snapshot(
        mode === "fabric"
          ? ledger.config.publicReader
          : { id: "public-summary", role: "auditor", orgId: null }
      );
      const custody = scope.shipments
        .filter((s) => matches.some((l) => l.id === s.lotId))
        .map((s) => ({
          lotId: s.lotId,
          status: s.status,
          fromRole: scope.organizations.find((o) => o.id === s.fromOrgId)?.type,
          toRole: scope.organizations.find((o) => o.id === s.toOrgId)?.type,
          day: Math.floor(s.createdAt / 86400) * 86400,
        }));
      res.json({
        matches,
        custody,
        recalls: feed.recalls.filter((r) =>
          matches.some((l) => l.id === r.lotId)
        ),
        checkedAt: Date.now(),
      });
    })
  );
  app.get("/api/public/safety-key", (req, res) =>
    res.json({ jwk: safetyPublic })
  );
  app.post(
    "/api/anonymous/upload",
    asyncRoute(async (req, res) => {
      const encoded = JSON.stringify(req.body.envelope);
      if (!req.body.envelope || encoded.length > 100000)
        throw new DomainError(
          "INVALID_REPORT",
          "Encrypted report is invalid or too large."
        );
      const id = randomUUID(),
        bytes = Buffer.from(encoded);
      db.prepare("INSERT INTO documents VALUES(?,?,?,?,?,?,?,?)").run(
        id,
        null,
        "Encrypted side-effect report",
        "application/json",
        digest(bytes),
        seal(bytes),
        1,
        Date.now()
      );
      res.status(201).json({ id, digest: digest(bytes) });
    })
  );
  app.post(
    "/api/anonymous/:kind",
    asyncRoute(async (req, res) => {
      const kind = req.params.kind;
      if (!["report", "ack"].includes(kind))
        throw new DomainError("NOT_FOUND", "Endpoint not found.", 404);
      if (kind === "report") {
        const d = db
          .prepare("SELECT id,digest FROM documents WHERE id=? AND anonymous=1")
          .get(req.body.documentId);
        if (!d || d.digest !== req.body.reportDigest)
          throw new DomainError(
            "INVALID_REPORT",
            "Encrypted report object does not match the proof."
          );
      }
      const result = await ledger.run(
        relay,
        kind === "report" ? "report" : "acknowledge",
        req.body,
        req.body.requestId
      );
      res.json({ status: "committed", result });
    })
  );
  app.get(
    "/api/reports/:id",
    authenticated,
    asyncRoute(async (req, res) => {
      if (req.user.role !== "regulator")
        throw new DomainError(
          "FORBIDDEN",
          "Only authorized safety staff can decrypt reports.",
          403
        );
      const report = (await ledger.snapshot(req.user)).reports.find(
          (r) => r.id === req.params.id
        ),
        d =
          report &&
          db
            .prepare("SELECT * FROM documents WHERE id=?")
            .get(report.documentId);
      if (!d) throw new DomainError("NOT_FOUND", "Report unavailable.", 404);
      const encoded = open(d.bytes);
      if (digest(encoded) !== report.digest)
        throw new DomainError(
          "DIGEST_MISMATCH",
          "Report integrity check failed.",
          500
        );
      const e = JSON.parse(encoded.toString()),
        key = privateDecrypt(
          {
            key: safetyPrivate,
            oaepHash: "sha256",
            padding: constants.RSA_PKCS1_OAEP_PADDING,
          },
          Buffer.from(e.key, "base64")
        );
      const cipher = Buffer.from(e.data, "base64"),
        iv = Buffer.from(e.iv, "base64"),
        dec = createDecipheriv("aes-256-gcm", key, iv);
      dec.setAuthTag(cipher.subarray(-16));
      const body = Buffer.concat([
        dec.update(cipher.subarray(0, -16)),
        dec.final(),
      ]).toString();
      res.json({ report, text: body });
    })
  );
  app.post(
    "/api/sandbox/replay",
    authenticated,
    asyncRoute(async (req, res) => {
      if (!sandbox || req.user.role !== "regulator")
        throw new DomainError(
          "SANDBOX_ONLY",
          "Recall replay is available only to a safety account in the isolated sandbox.",
          403
        );
      const event = req.body.event,
        codes = event?.product_ndc || event?.openfda?.product_ndc || [],
        names = parseLotNumbers(event?.code_info || "", 1000);
      const data = await ledger.snapshot(req.user),
        exact = data.lots.filter(
          (l) =>
            l.namespace === "NDC" &&
            codes.includes(l.code) &&
            names.includes(l.lotNumber.toUpperCase())
        );
      if (!exact.length)
        throw new DomainError(
          "UNRESOLVED_SCOPE",
          "No exact staged product and lot match. Nothing was recalled."
        );
      const classification = { "Class I": 1, "Class II": 2, "Class III": 3 }[
        event.classification
      ];
      if (!classification)
        throw new DomainError(
          "INVALID_CLASSIFICATION",
          "Source classification is unresolved."
        );
      const sameProduct = data.lots.filter(
        (l) => l.namespace === "NDC" && codes.includes(l.code)
      );
      const recalled = [];
      for (const l of exact.filter((l) => !l.recallId))
        recalled.push(
          (
            await ledger.run(
              req.user,
              "recall",
              {
                lotId: l.id,
                classification,
                reason: String(event.reason_for_recall || event.recall_number),
                instructions: String(
                  req.body.instructions ||
                    "Read the source notice and contact your pharmacy or prescriber."
                ),
                fromSignal: false,
              },
              randomUUID()
            )
          ).recall
        );
      res.json({
        recalled,
        matchedLots: exact.length,
        exactRecords: exact.reduce((n, l) => n + l.dispenseRecords, 0),
        productRecords: sameProduct.reduce((n, l) => n + l.dispenseRecords, 0),
      });
    })
  );
  app.post(
    "/api/imports/fetch",
    authenticated,
    asyncRoute(async (req, res) => {
      if (req.user.role !== "regulator")
        throw new DomainError(
          "FORBIDDEN",
          "Safety authority access required.",
          403
        );
      const response = await fetch(
        "https://api.fda.gov/drug/enforcement.json?search=status:%22Ongoing%22&limit=20&sort=report_date:desc",
        { signal: AbortSignal.timeout(15000) }
      );
      if (!response.ok)
        throw new DomainError(
          "SOURCE_UNAVAILABLE",
          "Official recall source is unavailable. Import a saved source file instead.",
          503
        );
      const source = await response.json();
      res.json({
        source: "openFDA drug enforcement",
        fetchedAt: Date.now(),
        events: source.results.map((event) => ({
          ...event,
          product_ndc: event.openfda?.product_ndc || [],
        })),
      });
    })
  );
  app.post(
    "/api/imports",
    authenticated,
    asyncRoute(async (req, res) => {
      if (req.user.role !== "regulator")
        throw new DomainError("FORBIDDEN", "Regulator access required.", 403);
      const input = req.body.events;
      if (!Array.isArray(input) || input.length > 100)
        throw new DomainError(
          "INVALID_IMPORT",
          "Import up to 100 source notices."
        );
      const data = await ledger.snapshot(req.user),
        items = input.map((ev) => {
          const named = parseLotNumbers(ev.code_info || "", 1000),
            codes = ev.product_ndc || ev.openfda?.product_ndc || [];
          const lots = data.lots.filter(
            (l) =>
              l.namespace === "NDC" &&
              codes.includes(l.code) &&
              named.includes(l.lotNumber.toUpperCase())
          );
          return {
            source: ev,
            sourceDigest: digest(JSON.stringify(ev)),
            lotIds: lots.map((l) => l.id),
            status: lots.length ? "exact-candidates" : "unresolved",
          };
        });
      const id = randomUUID();
      db.prepare("INSERT INTO imports VALUES(?,?,?)").run(
        id,
        JSON.stringify({ id, items }),
        Date.now()
      );
      res.status(201).json({ id, items });
    })
  );
  app.get("/api/imports", authenticated, (req, res) => {
    if (req.user.role !== "regulator")
      return res
        .status(403)
        .json({ error: { message: "Regulator access required." } });
    res.json({
      imports: db
        .prepare("SELECT value FROM imports ORDER BY at DESC")
        .all()
        .map((r) => JSON.parse(r.value)),
    });
  });
  app.use("/api", (req, res) =>
    res
      .status(404)
      .json({ error: { code: "NOT_FOUND", message: "Endpoint not found." } })
  );
  if (existsSync(resolve("apps/web/dist/index.html"))) {
    app.use(
      express.static(resolve("apps/web/dist"), {
        setHeaders: (res, path) => {
          if (path.endsWith(".html"))
            res.setHeader("Cache-Control", "no-cache");
        },
      })
    );
    app.get("*", (req, res) =>
      res.sendFile(resolve("apps/web/dist/index.html"))
    );
  }
  app.use((error, req, res, next) => {
    const status = error.status || 400;
    res.status(status).json({
      error: {
        code: error.code || "REQUEST_FAILED",
        message:
          status >= 500
            ? "The operation could not be completed. Check service configuration and retry safely."
            : error.message,
      },
    });
  });
  return {
    app,
    store,
    ledger,
    close: async () => {
      if (ledger !== store) await ledger.close();
      await store.close();
    },
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const service = createApp({
    dataDir: resolve(process.env.LOTUS_DATA_DIR || ".lotus-data"),
  });
  const port = Number(process.env.PORT || 8787),
    host = process.env.HOST || "127.0.0.1";
  const server = service.app.listen(port, host, () =>
    console.log(
      `LOTUS web/API: http://${host}:${port} | ledger: ${
        process.env.LOTUS_LEDGER || "local"
      } | complete first-run setup in your browser`
    )
  );
  for (const name of ["SIGINT", "SIGTERM"])
    process.on(name, () =>
      server.close(() => service.close().then(() => process.exit()))
    );
}
