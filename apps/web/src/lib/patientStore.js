import { newPatientSecret } from "@lotus/sdk";
import { demoPatient } from "./chain";

/**
 * The patient wallet lives only in this browser. In production this would be an encrypted
 * IndexedDB entry unlocked by device biometrics; for the prototype localStorage is enough.
 */
const KEY = "lotus.patient.v1";

export function loadWallet() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

export function saveWallet(w) {
  try { localStorage.setItem(KEY, JSON.stringify(w)); } catch {}
  return w;
}

export function createWallet() {
  return saveWallet({ secret: newPatientSecret().toString(), nextIndex: 0, permits: [], guardianShares: null, language: "en" });
}

export function importDemoWallet() {
  if (!demoPatient) return null;
  return saveWallet({ ...demoPatient, permits: [], language: "en" });
}

export function clearWallet() {
  try { localStorage.removeItem(KEY); } catch {}
}
