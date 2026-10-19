// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {LotusBase} from "./LotusBase.sol";
import {RoleRegistry} from "./RoleRegistry.sol";
import {Roles} from "../libraries/Roles.sol";

/// @title CustodyLedger
/// @notice Two-sided chain of custody. A sender ships, the recipient must accept, and only then
///         do units count as received. A pharmacy can never self-declare inbound stock.
///
///         Dispense Closure (I1), per pharmacy per lot:
///             dispensed + returned + shrinkage <= inbound
contract CustodyLedger is LotusBase {
    enum Status { None, Pending, Accepted, Rejected }

    struct Shipment {
        bytes32 lotKey;
        address from;
        address to;
        uint128 qty;
        bytes32 manifestHash; // IPFS digest of the shipping manifest
        Status status;
        uint64 createdAt;
    }

    struct PharmacyBook {
        uint128 inbound;
        uint128 dispensed;
        uint128 returned;
        uint128 shrinkage;
    }

    /// @notice Units currently held (accepted and not yet shipped/dispensed) by each holder.
    mapping(bytes32 => mapping(address => uint256)) public onHand;
    mapping(address => mapping(bytes32 => PharmacyBook)) private _books;
    Shipment[] private _shipments;

    event Minted(bytes32 indexed lotKey, address indexed manufacturer, uint128 qty);
    event Shipped(uint256 indexed shipmentId, bytes32 indexed lotKey, address indexed from, address to, uint128 qty, bytes32 manifestHash);
    event Accepted(uint256 indexed shipmentId, bytes32 indexed lotKey, address indexed to, uint128 qty);
    event Rejected(uint256 indexed shipmentId, bytes32 indexed lotKey, address indexed to);
    event ShrinkageReported(bytes32 indexed lotKey, address indexed pharmacy, uint128 qty, bytes32 reasonHash);
    event ReturnedToSupplier(bytes32 indexed lotKey, address indexed pharmacy, uint256 shipmentId, uint128 qty);

    constructor(RoleRegistry _roles) LotusBase(_roles) {}

    // ───────────────────────────── system hooks ─────────────────────────────

    function mintToManufacturer(bytes32 lotKey, address manufacturer, uint128 qty) external onlyRole(Roles.SYSTEM) {
        onHand[lotKey][manufacturer] += qty;
        emit Minted(lotKey, manufacturer, qty);
    }

    /// @notice Called by DispenseLedger. Enforces I1 (closure) and I2 (lot must be received).
    function recordDispense(address pharmacy, bytes32 lotKey, uint128 qty) external onlyRole(Roles.SYSTEM) {
        PharmacyBook storage b = _books[pharmacy][lotKey];
        require(b.inbound > 0, "Custody: lot never received"); // I2
        require(uint256(b.dispensed) + b.returned + b.shrinkage + qty <= b.inbound, "Custody: closure violated"); // I1
        b.dispensed += qty;
        onHand[lotKey][pharmacy] -= qty;
    }

    // ───────────────────────────── shipments ─────────────────────────────

    function ship(bytes32 lotKey, address to, uint128 qty, bytes32 manifestHash) public returns (uint256 id) {
        require(
            roles.hasRole(Roles.MANUFACTURER, msg.sender) || roles.hasRole(Roles.DISTRIBUTOR, msg.sender)
                || roles.hasRole(Roles.PHARMACY, msg.sender),
            "Custody: sender role"
        );
        require(roles.hasRole(Roles.DISTRIBUTOR, to) || roles.hasRole(Roles.PHARMACY, to) || roles.hasRole(Roles.MANUFACTURER, to), "Custody: recipient role");
        require(to != msg.sender, "Custody: self shipment");
        require(qty > 0 && onHand[lotKey][msg.sender] >= qty, "Custody: insufficient stock");
        if (roles.hasRole(Roles.PHARMACY, msg.sender)) {
            PharmacyBook storage b = _books[msg.sender][lotKey];
            require(uint256(b.dispensed) + b.returned + b.shrinkage + qty <= b.inbound, "Custody: closure violated");
            b.returned += qty;
        }

        onHand[lotKey][msg.sender] -= qty;
        id = _shipments.length;
        _shipments.push(Shipment(lotKey, msg.sender, to, qty, manifestHash, Status.Pending, uint64(block.timestamp)));
        emit Shipped(id, lotKey, msg.sender, to, qty, manifestHash);
    }

    function accept(uint256 id) external {
        Shipment storage s = _shipments[id];
        require(s.status == Status.Pending, "Custody: not pending");
        require(s.to == msg.sender, "Custody: not recipient");
        s.status = Status.Accepted;
        onHand[s.lotKey][msg.sender] += s.qty;
        if (roles.hasRole(Roles.PHARMACY, msg.sender)) _books[msg.sender][s.lotKey].inbound += s.qty;
        emit Accepted(id, s.lotKey, msg.sender, s.qty);
    }

    function reject(uint256 id) external {
        Shipment storage s = _shipments[id];
        require(s.status == Status.Pending, "Custody: not pending");
        require(s.to == msg.sender, "Custody: not recipient");
        s.status = Status.Rejected;
        onHand[s.lotKey][s.from] += s.qty;
        if (roles.hasRole(Roles.PHARMACY, s.from)) _books[s.from][s.lotKey].returned -= s.qty;
        emit Rejected(id, s.lotKey, msg.sender);
    }

    /// @notice Pharmacy-documented loss (breakage, theft, expiry destruction).
    function reportShrinkage(bytes32 lotKey, uint128 qty, bytes32 reasonHash) external onlyRole(Roles.PHARMACY) {
        PharmacyBook storage b = _books[msg.sender][lotKey];
        require(qty > 0 && uint256(b.dispensed) + b.returned + b.shrinkage + qty <= b.inbound, "Custody: closure violated");
        b.shrinkage += qty;
        onHand[lotKey][msg.sender] -= qty;
        emit ShrinkageReported(lotKey, msg.sender, qty, reasonHash);
    }

    /// @notice Return-to-supplier is a normal shipment that also counts against closure.
    function returnToSupplier(bytes32 lotKey, address supplier, uint128 qty, bytes32 manifestHash)
        external
        onlyRole(Roles.PHARMACY)
        returns (uint256 id)
    {
        id = ship(lotKey, supplier, qty, manifestHash);
        emit ReturnedToSupplier(lotKey, msg.sender, id, qty);
    }

    // ───────────────────────────── views ─────────────────────────────

    function bookOf(address pharmacy, bytes32 lotKey) external view returns (PharmacyBook memory) {
        return _books[pharmacy][lotKey];
    }

    function hasReceived(address pharmacy, bytes32 lotKey) external view returns (bool) {
        return _books[pharmacy][lotKey].inbound > 0;
    }

    function getShipment(uint256 id) external view returns (Shipment memory) {
        return _shipments[id];
    }

    function shipmentCount() external view returns (uint256) {
        return _shipments.length;
    }
}
