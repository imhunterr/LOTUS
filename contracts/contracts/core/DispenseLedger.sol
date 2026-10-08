// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {LotusBase} from "./LotusBase.sol";
import {RoleRegistry} from "./RoleRegistry.sol";
import {BatchRegistry} from "./BatchRegistry.sol";
import {CustodyLedger} from "./CustodyLedger.sol";
import {PrescriptionRegistry} from "./PrescriptionRegistry.sol";
import {RecallRegistry} from "./RecallRegistry.sol";
import {Roles} from "../libraries/Roles.sol";
import {Field} from "../libraries/Field.sol";
import {LotTree} from "../libraries/LotTree.sol";

/// @title DispenseLedger
/// @notice The "last hop". Each dispense writes a split record:
///           public : lot, pharmacy pseudonym, region, qty, shipment reference
///           private: commitment = Poseidon(patientSecret, nonce_i)   (opaque field element)
///
///         The patient only shows the commitment at the counter; the pharmacy never learns the secret.
contract DispenseLedger is LotusBase, ReentrancyGuard {
    using LotTree for LotTree.Tree;

    BatchRegistry public immutable batches;
    CustodyLedger public immutable custody;
    PrescriptionRegistry public immutable prescriptions;
    RecallRegistry public recalls;

    mapping(bytes32 => LotTree.Tree) private _trees;
    mapping(uint256 => bool) public commitmentUsed; // I4
    mapping(bytes32 => mapping(uint16 => uint256)) public unitsByLotRegion;
    mapping(bytes32 => uint256) public unitsByLot;
    uint256 public totalDispenses;

    event Dispensed(
        bytes32 indexed lotKey,
        bytes32 indexed pharmacyPseudonym,
        uint16 region,
        uint128 qty,
        uint256 commitment,
        uint32 leafIndex,
        uint256 newRoot,
        bytes32 shipmentRef
    );

    constructor(RoleRegistry _roles, BatchRegistry _batches, CustodyLedger _custody, PrescriptionRegistry _rx)
        LotusBase(_roles)
    {
        batches = _batches;
        custody = _custody;
        prescriptions = _rx;
    }

    function setRecallRegistry(RecallRegistry r) external onlyAdmin {
        require(address(recalls) == address(0), "Dispense: already set");
        recalls = r;
    }

    struct DispenseRequest {
        bytes32 lotKey;
        uint256 permitId;
        bytes32 permitSecret;
        uint128 qty;
        uint256 commitment;
        bytes32 shipmentRef;
    }

    function dispense(DispenseRequest calldata r) external onlyRole(Roles.PHARMACY) nonReentrant returns (uint32 leafIndex) {
        require(batches.exists(r.lotKey), "Dispense: unknown lot");
        require(!batches.isExpired(r.lotKey), "Dispense: lot expired");
        require(address(recalls) == address(0) || !recalls.isRecalled(r.lotKey), "Dispense: lot recalled");
        require(r.commitment != 0 && r.commitment < Field.SNARK_SCALAR_FIELD, "Dispense: bad commitment");
        require(!commitmentUsed[r.commitment], "Dispense: commitment reused"); // I4

        prescriptions.redeem(r.permitId, r.qty, msg.sender, r.permitSecret, batches.ndcHashOf(r.lotKey)); // I3
        custody.recordDispense(msg.sender, r.lotKey, r.qty); // I1 + I2

        commitmentUsed[r.commitment] = true;
        uint16 region = roles.regionOf(msg.sender);
        unitsByLotRegion[r.lotKey][region] += r.qty;
        unitsByLot[r.lotKey] += r.qty;
        totalDispenses += 1;

        uint256 root;
        (leafIndex, root) = _trees[r.lotKey].insert(r.commitment);
        emit Dispensed(r.lotKey, roles.pseudonymOf(msg.sender), region, r.qty, r.commitment, leafIndex, root, r.shipmentRef);
    }

    // ───────────────────────────── views ─────────────────────────────

    function verifyCommit(uint256 commitment) external view returns (bool) {
        return commitmentUsed[commitment];
    }

    function isKnownRoot(bytes32 lotKey, uint256 root) external view returns (bool) {
        return _trees[lotKey].isKnownRoot(root);
    }

    function currentRoot(bytes32 lotKey) external view returns (uint256) {
        return _trees[lotKey].currentRoot();
    }

    function leafCount(bytes32 lotKey) external view returns (uint32) {
        return _trees[lotKey].size;
    }
}
