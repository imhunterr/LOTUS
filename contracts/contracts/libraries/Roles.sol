// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Role identifiers shared by every LOTUS contract.
library Roles {
    bytes32 internal constant MANUFACTURER = keccak256("MANUFACTURER");
    bytes32 internal constant DISTRIBUTOR = keccak256("DISTRIBUTOR");
    bytes32 internal constant PHARMACY = keccak256("PHARMACY");
    bytes32 internal constant PRESCRIBER = keccak256("PRESCRIBER");
    bytes32 internal constant REGULATOR = keccak256("REGULATOR");
    /// @dev Granted only to LOTUS contracts so they can call each other's internal hooks.
    bytes32 internal constant SYSTEM = keccak256("SYSTEM");
}
