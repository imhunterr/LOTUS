import { split, combine } from "shamir-secret-sharing";
import { toHex32 } from "./field.js";

/**
 * Guardian recovery: the patient secret is split 2-of-3.
 *
 * Default guardians are the patient's device, the pharmacy of record and the prescriber, but the
 * patient may swap either professional for a personal guardian (family member). That matters
 * because pharmacy + prescriber together already know who the patient is.
 */
const hexToBytes = (hex) => Uint8Array.from(hex.replace(/^0x/, "").match(/.{2}/g).map((b) => parseInt(b, 16)));
const bytesToHex = (bytes) => "0x" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function splitSecret(secret, { shares = 3, threshold = 2 } = {}) {
  const parts = await split(hexToBytes(toHex32(secret)), shares, threshold);
  return parts.map(bytesToHex);
}

export async function recoverSecret(shareHexes) {
  return BigInt(bytesToHex(await combine(shareHexes.map(hexToBytes))));
}
