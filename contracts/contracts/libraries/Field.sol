// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice BN254 scalar field helpers. Commitments, nullifiers and Merkle nodes must live
///         inside this field so the zero-knowledge circuit can reproduce them.
library Field {
    uint256 internal constant SNARK_SCALAR_FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    function toField(bytes32 x) internal pure returns (uint256) {
        return uint256(x) % SNARK_SCALAR_FIELD;
    }
}
