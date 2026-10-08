import { poseidon2 } from "poseidon-lite";

/** Maximum tree depth; must equal MAX_DEPTH in LotTree.sol and the circuit's parameter. */
export const MAX_DEPTH = 16;

/**
 * Off-chain mirror of contracts/libraries/LotTree.sol (a LeanIMT: nodes without a right sibling
 * are carried up unchanged). Rebuild it from a lot's Dispensed events, ordered by leafIndex, to get
 * the Merkle path for a zero-knowledge proof.
 */
export class LotMerkleTree {
  constructor(leaves = []) {
    this.leaves = leaves.map(BigInt);
    this.#rebuild();
  }

  insert(leaf) {
    this.leaves.push(BigInt(leaf));
    this.#rebuild();
  }

  #rebuild() {
    this.layers = [this.leaves];
    while (this.layers.at(-1).length > 1) {
      const cur = this.layers.at(-1);
      const next = [];
      for (let i = 0; i < cur.length; i += 2) next.push(i + 1 < cur.length ? poseidon2([cur[i], cur[i + 1]]) : cur[i]);
      this.layers.push(next);
    }
  }

  get depth() {
    return this.layers.length - 1;
  }

  get root() {
    return this.layers.at(-1)[0] ?? 0n;
  }

  /**
   * Compressed proof: levels where the node has no sibling are skipped, exactly as the contract
   * skips hashing them. Padded to MAX_DEPTH for the circuit; `depth` says how many entries are real.
   */
  path(index) {
    const siblings = [];
    const indices = [];
    let i = index;
    for (let level = 0; level < this.depth; level++) {
      const isRight = i & 1;
      const sib = this.layers[level][isRight ? i - 1 : i + 1];
      if (sib !== undefined) {
        siblings.push(sib);
        indices.push(isRight);
      }
      i >>= 1;
    }
    const depth = siblings.length;
    while (siblings.length < MAX_DEPTH) {
      siblings.push(0n);
      indices.push(0);
    }
    return { pathElements: siblings, pathIndices: indices, depth, root: this.root };
  }
}
