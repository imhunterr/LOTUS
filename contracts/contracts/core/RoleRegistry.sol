// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Roles} from "../libraries/Roles.sol";

/// @title RoleRegistry
/// @notice On-chain RBAC for the five actor types plus the internal SYSTEM role.
///         Every actor also carries a public pseudonym and a coarse region code
///         (used only for k-anonymous recall aggregates).
contract RoleRegistry is AccessControl {
    mapping(address => bytes32) public pseudonymOf;
    mapping(address => uint16) public regionOf;

    event ActorRegistered(address indexed account, bytes32 indexed role, bytes32 pseudonym, uint16 region);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Grants a business role and records the actor's pseudonym and region.
    function registerActor(address account, bytes32 role, uint16 region) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(role != DEFAULT_ADMIN_ROLE && role != Roles.SYSTEM, "RoleRegistry: reserved role");
        _grantRole(role, account);
        bytes32 pseudo = keccak256(abi.encode(account, block.chainid, "LOTUS"));
        pseudonymOf[account] = pseudo;
        regionOf[account] = region;
        emit ActorRegistered(account, role, pseudo, region);
    }

    /// @notice Wires a LOTUS contract into the system so it can call protected hooks.
    function registerSystemContract(address target) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(Roles.SYSTEM, target);
    }
}
