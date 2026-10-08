// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PoseidonT3} from "poseidon-solidity/PoseidonT3.sol";

uint8 constant TREE_DEPTH = 16; // 65,536 dispenses per lot
uint8 constant ROOT_HISTORY_SIZE = 32;

/// @notice Append-only Poseidon Merkle tree (one per lot) holding dispense commitments.
///         Patients prove membership in zero knowledge, so the hash must be SNARK-friendly.
library LotTree {
    uint8 internal constant DEPTH = TREE_DEPTH;
    uint8 internal constant ROOT_HISTORY = ROOT_HISTORY_SIZE;

    struct Tree {
        uint32 nextIndex;
        uint8 currentRootIndex;
        uint256[TREE_DEPTH] filledSubtrees;
        uint256[ROOT_HISTORY_SIZE] roots;
    }

    function hashPair(uint256 left, uint256 right) internal pure returns (uint256) {
        return PoseidonT3.hash([left, right]);
    }

    function insert(Tree storage t, uint256[TREE_DEPTH] storage zeros, uint256 leaf) internal returns (uint32 index, uint256 root) {
        index = t.nextIndex;
        require(index < uint32(1) << DEPTH, "LotTree: full");
        uint256 node = leaf;
        uint32 i = index;
        for (uint8 level = 0; level < DEPTH; level++) {
            if (i & 1 == 0) {
                t.filledSubtrees[level] = node;
                node = hashPair(node, zeros[level]);
            } else {
                node = hashPair(t.filledSubtrees[level], node);
            }
            i >>= 1;
        }
        t.nextIndex = index + 1;
        uint8 next = (t.currentRootIndex + 1) % ROOT_HISTORY;
        t.currentRootIndex = next;
        t.roots[next] = node;
        root = node;
    }

    function isKnownRoot(Tree storage t, uint256 root) internal view returns (bool) {
        if (root == 0 || t.nextIndex == 0) return false;
        uint8 i = t.currentRootIndex;
        for (uint8 n = 0; n < ROOT_HISTORY; n++) {
            if (t.roots[i] == root) return true;
            i = i == 0 ? ROOT_HISTORY - 1 : i - 1;
        }
        return false;
    }

    function currentRoot(Tree storage t) internal view returns (uint256) {
        return t.roots[t.currentRootIndex];
    }
}
