import {
  newPatientSecret,
  commitmentAt,
  splitSecret,
  recoverSecret,
  LotMerkleTree,
  nullifierHash,
} from '@lotus/sdk';
import { topic, signal, canonical } from '../../../../packages/domain/src/crypto.js';
import { api, post, bytesToBase64, base64ToBytes } from './api';

const encode = new TextEncoder(),
  decode = new TextDecoder();
let sessionKey = null;
let queue = Promise.resolve();
const database = new Promise((resolve, reject) => {
  const request = indexedDB.open('lotus-private-vault', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('values');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
async function read(key) {
  const db = await database;
  return new Promise((resolve, reject) => {
    const request = db.transaction('values').objectStore('values').get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function write(key, value) {
  const db = await database;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('values', 'readwrite');
    tx.objectStore('values').put(value, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
async function derive(passphrase, salt) {
  const material = await crypto.subtle.importKey(
    'raw',
    encode.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 600000 },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}
export const hasVault = async () => Boolean(await read('vault'));
export const lockVault = () => {
  sessionKey = null;
};
export const vaultUnlocked = () => Boolean(sessionKey);
export function saveVault(wallet) {
  const key = sessionKey;
  if (!key) return Promise.reject(new Error('Vault is locked.'));
  const task = queue.then(async () => {
    const current = await read('vault');
    if (!current) throw new Error('Vault is unavailable.');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encode.encode(JSON.stringify(wallet))
    );
    await write('vault', {
      salt: current.salt,
      iv: bytesToBase64(iv),
      data: bytesToBase64(new Uint8Array(data)),
    });
    return wallet;
  });
  queue = task.catch(() => {});
  return task;
}
export async function createVault(passphrase, wallet) {
  if (typeof passphrase !== 'string' || passphrase.length < 12)
    throw new Error('Use a vault passphrase with at least 12 characters.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  sessionKey = await derive(passphrase, salt);
  await write('vault', { salt: bytesToBase64(salt) });
  return saveVault(
    wallet || {
      version: 2,
      secret: newPatientSecret().toString(),
      nextIndex: 0,
      issuedIndices: [],
      permits: [],
      guardianShares: [],
      guardianNames: ['Personal guardian', 'Pharmacy guardian', 'Recovery guardian'],
      language: 'en',
      createdAt: Date.now(),
    }
  );
}
export async function unlockVault(passphrase) {
  const raw = await read('vault');
  if (!raw) throw new Error('No private vault on this browser.');
  const key = await derive(passphrase, base64ToBytes(raw.salt));
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(raw.iv) },
      key,
      base64ToBytes(raw.data)
    );
    const wallet = JSON.parse(decode.decode(plain));
    sessionKey = key;
    return wallet;
  } catch {
    throw new Error('Passphrase could not unlock this vault.');
  }
}
export async function guardians(wallet) {
  return { ...wallet, guardianShares: await splitSecret(wallet.secret) };
}
export async function exportBackup(wallet) {
  const key = await crypto.subtle.importKey(
    'raw',
    await crypto.subtle.digest('SHA-256', encode.encode(`LOTUS_BACKUP:${wallet.secret}`)),
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const safe = { ...wallet, guardianShares: [] };
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encode.encode(JSON.stringify(safe))
  );
  return {
    version: 2,
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(data)),
    at: Date.now(),
  };
}
export async function restoreBackup(shares, backup, passphrase) {
  const secret = (await recoverSecret(shares)).toString();
  const key = await crypto.subtle.importKey(
    'raw',
    await crypto.subtle.digest('SHA-256', encode.encode(`LOTUS_BACKUP:${secret}`)),
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );
  let wallet;
  try {
    wallet = JSON.parse(
      decode.decode(
        await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: base64ToBytes(backup.iv) },
          key,
          base64ToBytes(backup.data)
        )
      )
    );
  } catch {
    throw new Error('These shares do not match the encrypted backup.');
  }
  if (wallet.secret !== secret) throw new Error('Recovery package mismatch.');
  return createVault(passphrase, { ...wallet, guardianShares: [] });
}
export async function reserveCode(wallet, permit) {
  const index = wallet.nextIndex;
  const next = { ...wallet, nextIndex: index + 1, issuedIndices: [...wallet.issuedIndices, index] };
  await saveVault(next);
  return {
    wallet: next,
    code: {
      v: 2,
      permitId: permit.id,
      permitSecret: permit.permitSecret,
      commitment: commitmentAt(wallet.secret, index).toString(),
      index,
      network: permit.network,
    },
  };
}
export function matching(wallet, feed) {
  const commitments = new Map();
  for (const index of wallet.issuedIndices)
    commitments.set(commitmentAt(wallet.secret, index).toString(), index);
  return feed.leaves
    .filter((leaf) => commitments.has(leaf.commitment))
    .map((leaf) => ({ ...leaf, index: commitments.get(leaf.commitment) }));
}
export async function membership(wallet, receipt, feed, kind, value, digest = '') {
  const leaves = feed.leaves
    .filter((l) => l.lotId === receipt.lotId && l.segment === receipt.segment)
    .sort((a, b) => a.leafIndex - b.leafIndex)
    .map((l) => l.commitment);
  const tree = new LotMerkleTree(leaves),
    path = tree.path(receipt.leafIndex);
  const scope =
    kind === 'ack' ? feed.recalls.find((r) => r.lotId === receipt.lotId)?.id : receipt.lotId;
  if (!scope) throw new Error('Recall unavailable.');
  const external = topic(feed.network, kind, scope);
  const nul = nullifierHash(wallet.secret, external).toString();
  const snarkjs = await import('snarkjs');
  const { proof } = await snarkjs.groth16.fullProve(
    {
      root: path.root.toString(),
      nullifierHash: nul,
      externalNullifier: external,
      signalHash: signal(kind, value, digest),
      secret: wallet.secret,
      index: String(receipt.index),
      depth: String(path.depth),
      pathElements: path.pathElements.map(String),
      pathIndices: path.pathIndices.map(String),
    },
    '/zk/lotus_membership.wasm',
    '/zk/lotus_final.zkey'
  );
  return {
    proof,
    root: path.root.toString(),
    nullifierHash: nul,
    segment: receipt.segment,
    lotId: receipt.lotId,
    ...(kind === 'ack'
      ? { recallId: scope, action: value }
      : { severity: value, reportDigest: digest }),
    requestId: crypto.randomUUID(),
  };
}
export async function encryptedReport(text) {
  const { jwk } = await api('/public/safety-key');
  const recipient = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt']
  );
  const aes = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, encode.encode(text));
  const raw = await crypto.subtle.exportKey('raw', aes);
  const key = await crypto.subtle.encrypt('RSA-OAEP', recipient, raw);
  return post('/anonymous/upload', {
    envelope: {
      v: 1,
      key: bytesToBase64(new Uint8Array(key)),
      iv: bytesToBase64(iv),
      data: bytesToBase64(new Uint8Array(data)),
    },
  });
}
export const cacheFeed = (feed) => write('feed', feed);
export const cachedFeed = () => read('feed');
export async function verifyReceipt(record, feed) {
  if (!record.signature || record.network !== feed.network || !feed.receiptKey)
    throw new Error('This receipt is unsigned or belongs to another network.');
  const { signature, ...content } = record;
  const key = await crypto.subtle.importKey(
    'jwk',
    feed.receiptKey,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  );
  const valid = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    base64ToBytes(signature),
    encode.encode(canonical(content))
  );
  if (!valid)
    throw new Error('Receipt signature is invalid. Ask the pharmacy for its committed receipt.');
}
