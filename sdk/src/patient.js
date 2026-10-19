import { poseidon2 } from "poseidon-lite";
import { keccak256, hexlify, randomBytes, AbiCoder } from "ethers";
import { randomFieldElement, toField } from "./field.js";

/**
 * Patient-side cryptography.
 *
 * One long-lived `patientSecret` (a field element) never leaves the patient's device except as
 * Guardian shares. Every dispense i uses a deterministic nonce:
 *
 *     nonce_i      = Poseidon(secret, i)
 *     commitment_i = Poseidon(secret, nonce_i)
 *
 * Deriving nonces from the secret means recovering the secret recovers the whole history
 * (the original synopsis forgot that random nonces would be lost with the phone).
 */
export function newPatientSecret() {
  return randomFieldElement();
}

export function nonceAt(secret, index) {
  return poseidon2([BigInt(secret), BigInt(index)]);
}

export function commitmentAt(secret, index) {
  return poseidon2([BigInt(secret), nonceAt(secret, index)]);
}

/** Per-dispense nullifier is NOT used; nullifiers bind the secret to a topic so they are one per patient. */
export function nullifierHash(secret, externalNullifier) {
  return poseidon2([BigInt(secret), BigInt(externalNullifier)]);
}

/** Fresh, single-use permit secret so prescriptions are unlinkable to each other. */
export function newPermit() {
  const permitSecret = hexlify(randomBytes(32));
  return { permitSecret, holderCommit: keccak256(permitSecret) };
}

/** Payload the patient shows as a QR code at the pharmacy counter. No secret is included. */
export function counterQrPayload({ secret, index, permitId, permitSecret }) {
  return JSON.stringify({
    v: 1,
    permitId: String(permitId),
    permitSecret,
    commitment: commitmentAt(secret, index).toString(),
  });
}

const coder = AbiCoder.defaultAbiCoder();
export const externalNullifierForReport = (lotKey) =>
  toField(keccak256(coder.encode(["string", "bytes32"], ["LOTUS_AE", lotKey])));
export const externalNullifierForAck = (recallId) =>
  toField(keccak256(coder.encode(["string", "uint256"], ["LOTUS_ACK", recallId])));
export const reportSignalHash = (severity, reportCid) =>
  toField(keccak256(coder.encode(["uint8", "bytes32"], [severity, reportCid])));
export const ackSignalHash = (action) => toField(keccak256(coder.encode(["uint8"], [action])));

/**
 * Local recall matching. Scans commitment indices 0.. until `gapLimit` consecutive indices have no
 * on-chain dispense (same idea as HD-wallet address discovery).
 *
 * @param secret          patient secret
 * @param dispensed       [{ commitment: bigint|string, lotKey, leafIndex, ... }] from Dispensed events
 * @param recalledLotKeys Set of recalled lot keys
 */
export function matchRecalls(secret, dispensed, recalledLotKeys, gapLimit = 20) {
  const byCommitment = new Map(dispensed.map((d) => [BigInt(d.commitment).toString(), d]));
  const mine = [];
  let misses = 0;
  for (let i = 0; misses < gapLimit; i++) {
    const hit = byCommitment.get(commitmentAt(secret, i).toString());
    if (hit) {
      mine.push({ ...hit, index: i });
      misses = 0;
    } else misses++;
  }
  return {
    myDispenses: mine,
    affected: mine.filter((d) => recalledLotKeys.has(d.lotKey)),
    nextIndex: mine.length ? Math.max(...mine.map((d) => d.index)) + 1 : 0,
  };
}
