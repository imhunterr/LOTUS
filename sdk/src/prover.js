import { LotMerkleTree } from "./tree.js";
import { nullifierHash } from "./patient.js";

/**
 * Builds the circuit input and a Groth16 proof for circuits/lotus_membership.circom.
 *
 * @param snarkjs   the snarkjs module (passed in so Node and the browser can load it their own way)
 * @param wasm      path/URL or Uint8Array of lotus_membership.wasm
 * @param zkey      path/URL or Uint8Array of lotus_final.zkey
 * @param leaves    all commitments of the lot, ordered by leafIndex (from Dispensed events)
 */
export async function proveMembership({ snarkjs, wasm, zkey, secret, index, leaves, leafIndex, externalNullifier, signalHash }) {
  const tree = new LotMerkleTree(leaves);
  const { pathElements, pathIndices, depth, root } = tree.path(leafIndex);
  const nullifier = nullifierHash(secret, externalNullifier);
  const input = {
    root: root.toString(),
    nullifierHash: nullifier.toString(),
    externalNullifier: BigInt(externalNullifier).toString(),
    signalHash: BigInt(signalHash).toString(),
    secret: BigInt(secret).toString(),
    index: BigInt(index).toString(),
    depth: String(depth),
    pathElements: pathElements.map(String),
    pathIndices: pathIndices.map(String),
  };
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasm, zkey);
  return { root, nullifierHash: nullifier, proof: toSolidityProof(proof), publicSignals };
}

/** snarkjs proof → the (a, b, c) layout the generated Solidity verifier expects (note the b swap). */
export function toSolidityProof(p) {
  return {
    a: [p.pi_a[0], p.pi_a[1]],
    b: [
      [p.pi_b[0][1], p.pi_b[0][0]],
      [p.pi_b[1][1], p.pi_b[1][0]],
    ],
    c: [p.pi_c[0], p.pi_c[1]],
  };
}
