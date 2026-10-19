// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {RoleRegistry} from "./RoleRegistry.sol";

/// @notice Shared role-gating for contracts that defer to the RoleRegistry.
abstract contract LotusBase {
    RoleRegistry public immutable roles;

    error Unauthorized(bytes32 role, address account);

    constructor(RoleRegistry _roles) {
        roles = _roles;
    }

    modifier onlyRole(bytes32 role) {
        if (!roles.hasRole(role, msg.sender)) revert Unauthorized(role, msg.sender);
        _;
    }

    modifier onlyAdmin() {
        if (!roles.hasRole(roles.DEFAULT_ADMIN_ROLE(), msg.sender)) revert Unauthorized(bytes32(0), msg.sender);
        _;
    }
}
