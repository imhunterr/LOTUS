// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Groth16 verifier for circuits/lotus_membership.circom.
///         Public signals, in order: [root, nullifierHash, externalNullifier, signalHash].
interface IMembershipVerifier {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[4] calldata publicSignals
    ) external view returns (bool);
}
