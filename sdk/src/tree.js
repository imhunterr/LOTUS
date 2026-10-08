import { poseidon2 } from "poseidon-lite";

export const TREE_DEPTH = 16;

const ZEROS = (() => {
  const z = [0n];
  for (let i = 1; i <= TREE_DEPTH; i++) z.push(poseidon2([z[i - 1], z[i - 1]]));
  return z;
})();

/**
 * Off-chain mirror of contracts/libraries/LotTree.sol. Rebuild it from a lot's Dispensed events
 * (ordered by leafIndex) to obtain a Merkle path for the zero-knowledge proof.
 */
export class LotMerkleTree {
  constructor(leaves = []) {
    this.layers = [leaves.map(BigInt)];
    this.#rebuild();
  }

  insert(leaf) {
    this.layers[0].push(BigInt(leaf));
    this.#rebuild();
  }

  #rebuild() {
    for (let level = 0; level < TREE_DEPTH; level++) {
      const cur = this.layers[level];
      const next = [];
      for (let i = 0; i < cur.length; i += 2) {
        next.push(poseidon2([cur[i], i + 1 < cur.length ? cur[i + 1] : ZEROS[level]]));
      }
      this.layers[level + 1] = next;
    }
  }

  get root() {
    return this.layers[TREE_DEPTH][0] ?? ZEROS[TREE_DEPTH];
  }

  path(index) {
    const pathElements = [];
    const pathIndices = [];
    let i = index;
    for (let level = 0; level < TREE_DEPTH; level++) {
      const layer = this.layers[level];
      const sibling = i ^ 1;
      pathElements.push(sibling < layer.length ? layer[sibling] : ZEROS[level]);
      pathIndices.push(i & 1);
      i >>= 1;
    }
    return { pathElements, pathIndices, root: this.root };
  }
}
