// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PoseidonT3} from "poseidon-solidity/PoseidonT3.sol";

uint8 constant MAX_DEPTH = 16; // up to 65,536 dispenses per lot
uint8 constant ROOT_HISTORY_SIZE = 32;

/// @notice Lean incremental Poseidon Merkle tree (one per lot) holding dispense commitments.
///         Same scheme as zk-kit's LeanIMT: the depth grows with the number of leaves, and a node
///         without a right sibling is carried up unchanged instead of being hashed with a zero.
///         An insert therefore costs popcount(index) hashes instead of a fixed 16, which cut the
///         gas of a dispense by more than half. Mirrored by sdk/src/tree.js and the circuit.
library LotTree {
    struct Tree {
        uint32 size;
        uint8 depth;
        uint8 currentRootIndex;
        uint256[MAX_DEPTH + 1] sideNodes;
        uint256[ROOT_HISTORY_SIZE] roots;
    }

    function hashPair(uint256 left, uint256 right) internal pure returns (uint256) {
        return PoseidonT3.hash([left, right]);
    }

    function insert(Tree storage t, uint256 leaf) internal returns (uint32 index, uint256 root) {
        index = t.size;
        require(index < uint32(1) << MAX_DEPTH, "LotTree: full");
        uint8 depth = t.depth;
        if (uint256(1) << depth < uint256(index) + 1) depth++;
        t.depth = depth;

        uint256 node = leaf;
        for (uint8 level = 0; level < depth; level++) {
            if ((index >> level) & 1 == 1) node = hashPair(t.sideNodes[level], node);
            else t.sideNodes[level] = node;
        }
        t.size = index + 1;
        t.sideNodes[depth] = node;

        uint8 next = (t.currentRootIndex + 1) % ROOT_HISTORY_SIZE;
        t.currentRootIndex = next;
        t.roots[next] = node;
        root = node;
    }

    function isKnownRoot(Tree storage t, uint256 root) internal view returns (bool) {
        if (root == 0 || t.size == 0) return false;
        uint8 i = t.currentRootIndex;
        for (uint8 n = 0; n < ROOT_HISTORY_SIZE; n++) {
            if (t.roots[i] == root) return true;
            i = i == 0 ? ROOT_HISTORY_SIZE - 1 : i - 1;
        }
        return false;
    }

    function currentRoot(Tree storage t) internal view returns (uint256) {
        return t.roots[t.currentRootIndex];
    }
}
