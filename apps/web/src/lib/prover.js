import { proveMembership } from "@lotus/sdk";
import { fetchDispensed } from "./chain";

/**
 * Real Groth16 proof generation in the browser (snarkjs + the circuit files in public/zk/).
 * Proving takes 1–3 seconds on a laptop and a few seconds on a mid-range phone.
 */
export async function buildMembershipProof({ secret, index, lotKey, leafIndex, externalNullifier, signalHash }) {
  const leaves = (await fetchDispensed())
    .filter((d) => d.lotKey === lotKey)
    .sort((a, b) => a.leafIndex - b.leafIndex)
    .map((d) => d.commitment);
  const snarkjs = await import("snarkjs");
  const z = await proveMembership({
    snarkjs, wasm: "/zk/lotus_membership.wasm", zkey: "/zk/lotus_final.zkey",
    secret, index, leaves, leafIndex, externalNullifier, signalHash,
  });
  return { root: z.root.toString(), nullifierHash: z.nullifierHash.toString(), proof: z.proof };
}
