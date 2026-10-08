import { LotMerkleTree, nullifierHash } from "@lotus/sdk";
import { fetchDispensed } from "./chain";

/**
 * Builds everything the zero-knowledge proof needs from public chain data + the patient secret.
 *
 * The Merkle path and nullifier are real. The Groth16 proof itself is produced by snarkjs once the
 * circuit is compiled (see circuits/README.md): drop lotus_membership.wasm + lotus_final.zkey into
 * public/zk/. Until then a placeholder proof is returned, which only the local MockMembershipVerifier accepts.
 */
export async function buildMembershipProof({ secret, index, lotKey, leafIndex, externalNullifier, signalHash }) {
  const leaves = (await fetchDispensed())
    .filter((d) => d.lotKey === lotKey)
    .sort((a, b) => a.leafIndex - b.leafIndex)
    .map((d) => d.commitment);
  const tree = new LotMerkleTree(leaves);
  const { pathElements, pathIndices, root } = tree.path(leafIndex);
  const nullifier = nullifierHash(secret, externalNullifier);

  const input = {
    root, nullifierHash: nullifier, externalNullifier, signalHash,
    secret: BigInt(secret), index: BigInt(index), pathElements, pathIndices,
  };

  let proof = { a: ["1", "0"], b: [["0", "0"], ["0", "0"]], c: ["0", "0"] };
  let real = false;
  try {
    const snarkjs = window.snarkjs; // loaded on demand when circuit files are present
    if (snarkjs) {
      const out = await snarkjs.groth16.fullProve(input, "/zk/lotus_membership.wasm", "/zk/lotus_final.zkey");
      const p = out.proof;
      proof = { a: p.pi_a.slice(0, 2), b: [p.pi_b[0].slice().reverse(), p.pi_b[1].slice().reverse()], c: p.pi_c.slice(0, 2) };
      real = true;
    }
  } catch (e) {
    console.warn("snarkjs proof failed, using development placeholder", e);
  }
  return { root: root.toString(), nullifierHash: nullifier.toString(), proof, real };
}
