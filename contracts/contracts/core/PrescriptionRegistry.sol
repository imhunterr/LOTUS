// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {LotusBase} from "./LotusBase.sol";
import {RoleRegistry} from "./RoleRegistry.sol";
import {Roles} from "../libraries/Roles.sol";

/// @title PrescriptionRegistry
/// @notice Prescriptions are single-use permits with a quantity balance.
///
///         Privacy fix vs. the original synopsis: a permit never stores a long-lived patient
///         public key (that would link every prescription of one patient). Instead it stores
///         `holderCommit = keccak256(permitSecret)`, where `permitSecret` is fresh per permit.
contract PrescriptionRegistry is LotusBase {
    struct Permit {
        bytes32 holderCommit;
        bytes32 ndcHash;
        uint128 balance;
        uint128 originalQty;
        uint64 expiry;
        address prescriber;
        address boundPharmacy; // set on first redemption; moves only via transferPermit
    }

    Permit[] private _permits;

    event PermitIssued(uint256 indexed permitId, bytes32 indexed ndcHash, uint128 qty, uint64 expiry, address indexed prescriber);
    event PermitRedeemed(uint256 indexed permitId, address indexed pharmacy, uint128 qty, uint128 remaining);
    event PermitExhausted(uint256 indexed permitId);
    event PermitTransferred(uint256 indexed permitId, address indexed from, address indexed to);

    constructor(RoleRegistry _roles) LotusBase(_roles) {}

    function issue(bytes32 holderCommit, string calldata ndc, uint128 qty, uint64 expiry)
        external
        onlyRole(Roles.PRESCRIBER)
        returns (uint256 id)
    {
        require(holderCommit != bytes32(0), "Rx: empty commit");
        require(qty > 0, "Rx: zero qty");
        require(expiry > block.timestamp, "Rx: expired");
        id = _permits.length;
        bytes32 ndcHash = keccak256(bytes(ndc));
        _permits.push(Permit(holderCommit, ndcHash, qty, qty, expiry, msg.sender, address(0)));
        emit PermitIssued(id, ndcHash, qty, expiry, msg.sender);
    }

    /// @notice Atomic balance decrement (I3). Only callable by DispenseLedger.
    function redeem(uint256 id, uint128 qty, address pharmacy, bytes32 permitSecret, bytes32 ndcHash)
        external
        onlyRole(Roles.SYSTEM)
    {
        Permit storage p = _permits[id];
        require(keccak256(abi.encodePacked(permitSecret)) == p.holderCommit, "Rx: bad permit secret");
        require(block.timestamp < p.expiry, "Rx: permit expired");
        require(p.ndcHash == ndcHash, "Rx: wrong drug");
        require(p.boundPharmacy == address(0) || p.boundPharmacy == pharmacy, "Rx: bound to another pharmacy");
        require(qty > 0 && p.balance >= qty, "Rx: insufficient balance");

        p.boundPharmacy = pharmacy;
        p.balance -= qty;
        emit PermitRedeemed(id, pharmacy, qty, p.balance);
        if (p.balance == 0) emit PermitExhausted(id);
    }

    /// @notice Moves the remaining balance to another pharmacy (patient request at the counter).
    function transferPermit(uint256 id, address toPharmacy) external onlyRole(Roles.PHARMACY) {
        Permit storage p = _permits[id];
        require(p.boundPharmacy == msg.sender, "Rx: not current pharmacy");
        require(roles.hasRole(Roles.PHARMACY, toPharmacy), "Rx: recipient not pharmacy");
        require(p.balance > 0, "Rx: exhausted");
        p.boundPharmacy = toPharmacy;
        emit PermitTransferred(id, msg.sender, toPharmacy);
    }

    function getPermit(uint256 id) external view returns (Permit memory) {
        return _permits[id];
    }

    function permitCount() external view returns (uint256) {
        return _permits.length;
    }
}
