import { newPatientSecret } from "@lotus/sdk";
import { demoPatient } from "./chain";

/**
 * Encrypted patient wallet. The secret never touches storage in clear text: the wallet JSON is
 * sealed with AES-GCM under a key derived from the patient's PIN (PBKDF2-SHA256, 250k rounds).
 * The derived key lives only in memory while the app is unlocked.
 */
const KEY = "lotus.patient.v2";
const VAULT = "lotus.demo.guardianVault"; // demo only: shares "held" by pharmacy and prescriber
const ITERATIONS = 250_000;

let sessionKey = null;
let sessionSalt = null;

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(pin, salt) {
  const base = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function readRaw() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "null");
  } catch {
    return null;
  }
}

export const hasWallet = () => !!readRaw();
export const isUnlocked = () => !!sessionKey;

export async function saveWallet(wallet) {
  if (!sessionKey) throw new Error("Wallet is locked");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, sessionKey, enc.encode(JSON.stringify(wallet)));
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: 2, salt: b64(sessionSalt), iv: b64(iv), data: b64(data) }));
  } catch {}
  return wallet;
}

export async function unlockWallet(pin) {
  const raw = readRaw();
  if (!raw) throw new Error("No wallet on this device");
  const salt = unb64(raw.salt);
  const key = await deriveKey(pin, salt);
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(raw.iv) }, key, unb64(raw.data));
    sessionKey = key;
    sessionSalt = salt;
    return JSON.parse(dec.decode(plain));
  } catch {
    throw new Error("Wrong PIN");
  }
}

async function initWallet(pin, wallet) {
  if (!/^\d{4,8}$/.test(pin)) throw new Error("Choose a PIN of 4 to 8 digits");
  sessionSalt = crypto.getRandomValues(new Uint8Array(16));
  sessionKey = await deriveKey(pin, sessionSalt);
  return saveWallet({ nextIndex: 0, permits: [], guardianShares: null, guardianNames: ["This phone", "Pharmacy of record", "Prescriber"], notified: [], language: "en", ...wallet });
}

export const createWallet = (pin) => initWallet(pin, { secret: newPatientSecret().toString() });
export const restoreWallet = (pin, secret) => initWallet(pin, { secret: secret.toString() });
export function importDemoWallet(pin) {
  if (!demoPatient) throw new Error("Run npm run demo:seed first");
  return initWallet(pin, { secret: demoPatient.secret, nextIndex: demoPatient.nextIndex, guardianShares: demoPatient.guardianShares });
}

export function lockWallet() {
  sessionKey = null;
  sessionSalt = null;
}

/** Lost phone: the device copy disappears; in the demo the two professional guardians keep their shares. */
export function loseDevice(wallet) {
  try {
    if (wallet.guardianShares) localStorage.setItem(VAULT, JSON.stringify(wallet.guardianShares.slice(1)));
    localStorage.removeItem(KEY);
  } catch {}
  lockWallet();
}

export function demoGuardianShares() {
  try {
    return JSON.parse(localStorage.getItem(VAULT) || "null");
  } catch {
    return null;
  }
}
