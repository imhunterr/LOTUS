export const SNARK_SCALAR_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** Uniform random field element (31 bytes keeps it strictly below the modulus). */
export function randomFieldElement() {
  const bytes = new Uint8Array(31);
  globalThis.crypto.getRandomValues(bytes);
  return BigInt("0x" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(""));
}

export function toField(hex) {
  return BigInt(hex) % SNARK_SCALAR_FIELD;
}

export const toHex32 = (n) => "0x" + BigInt(n).toString(16).padStart(64, "0");
