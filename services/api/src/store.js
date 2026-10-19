import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execute, projectSnapshot } from '../../../packages/domain/src/engine.js';

export class Store {
  constructor(path, options = {}) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    this.db.exec(`CREATE TABLE IF NOT EXISTS entities(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,role TEXT NOT NULL,orgId TEXT,password TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,userId TEXT NOT NULL,csrf TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS invitations(hash TEXT PRIMARY KEY,email TEXT NOT NULL,name TEXT NOT NULL,role TEXT NOT NULL,orgId TEXT,expires INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,ownerOrgId TEXT,name TEXT NOT NULL,mime TEXT NOT NULL,digest TEXT NOT NULL,bytes BLOB NOT NULL,anonymous INTEGER NOT NULL DEFAULT 0,createdAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS journal(seq INTEGER PRIMARY KEY AUTOINCREMENT,requestId TEXT UNIQUE NOT NULL,actorId TEXT NOT NULL,command TEXT NOT NULL,result TEXT NOT NULL,at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS drafts(id TEXT PRIMARY KEY,userId TEXT NOT NULL,value TEXT NOT NULL,updatedAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS imports(id TEXT PRIMARY KEY,value TEXT NOT NULL,at INTEGER NOT NULL);`);
    this.options = {
      network: 'lotus-local-v2',
      signalThreshold: 3,
      verificationKey: JSON.parse(
        readFileSync(
          new URL('../../../apps/web/public/zk/verification_key.json', import.meta.url),
          'utf8'
        )
      ),
      ...options,
    };
    this.pending = Promise.resolve();
  }
  get(key) {
    const row = this.db.prepare('SELECT value FROM entities WHERE key=?').get(key);
    return row ? JSON.parse(row.value) : null;
  }
  put(key, value) {
    this.db
      .prepare(
        'INSERT INTO entities(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
      )
      .run(key, JSON.stringify(value));
  }
  entities() {
    return Object.fromEntries(
      this.db
        .prepare('SELECT key,value FROM entities ORDER BY key')
        .all()
        .map((r) => [r.key, { ...JSON.parse(r.value), _key: r.key }])
    );
  }
  snapshot(actor) {
    return projectSnapshot(this.entities(), actor);
  }
  run(actor, command, payload, id = randomUUID()) {
    const job = this.pending.then(async () => {
      // Proof verification may await worker threads. Keep unrelated sessions/invites outside
      // that ledger transaction; stage all entity writes and enter SQLite only to commit.
      const writes = new Map();
      const staged = { get: (key) => this.get(key), put: (key, value) => writes.set(key, value) };
      const result = await execute(staged, actor, command, payload, id, {
        ...this.options,
        now: Math.floor(Date.now() / 1000),
      });
      this.db.exec('BEGIN IMMEDIATE');
      try {
        for (const [key, value] of writes) this.put(key, value);
        this.db
          .prepare(
            'INSERT OR IGNORE INTO journal(requestId,actorId,command,result,at) VALUES(?,?,?,?,?)'
          )
          .run(id, actor.id, command, JSON.stringify(result), result.committedAt);
        this.db.exec('COMMIT');
        return result;
      } catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
      }
    });
    this.pending = job.catch(() => {});
    return job;
  }
  async close() {
    await this.pending;
    this.db.close();
  }
}
