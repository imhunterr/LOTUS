// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {LotusBase} from "./LotusBase.sol";
import {RoleRegistry} from "./RoleRegistry.sol";
import {BatchRegistry} from "./BatchRegistry.sol";
import {DispenseLedger} from "./DispenseLedger.sol";
import {Roles} from "../libraries/Roles.sol";

/// @title RecallRegistry
/// @notice Lot-scoped recalls. Only regulators can issue (I5), recalls are immutable, and the
///         regional aggregates are k-anonymous: any region with fewer than K affected units is
///         suppressed so a rare drug in a small town can't single out a patient.
contract RecallRegistry is LotusBase {
    enum Classification { None, ClassI, ClassII, ClassIII }

    struct Recall {
        bytes32 lotKey;
        Classification classification;
        uint64 issuedAt;
        bytes32 reasonHash; // IPFS digest of the full recall notice
        address regulator;
        bool fromCrowdSignal; // true if triggered by an anonymous adverse-event SafetySignal
    }

    uint256 public constant K_ANONYMITY = 5;

    BatchRegistry public immutable batches;
    DispenseLedger public immutable dispenses;
    Recall[] private _recalls;
    mapping(bytes32 => uint256) private _recallIdPlusOne;

    event RecallIssued(
        uint256 indexed recallId, bytes32 indexed lotKey, string ndc, string lotNumber, Classification classification, bool fromCrowdSignal
    );

    constructor(RoleRegistry _roles, BatchRegistry _batches, DispenseLedger _dispenses) LotusBase(_roles) {
        batches = _batches;
        dispenses = _dispenses;
    }

    function issueRecall(bytes32 lotKey, Classification classification, bytes32 reasonHash, bool fromCrowdSignal)
        external
        onlyRole(Roles.REGULATOR)
        returns (uint256 id)
    {
        require(batches.exists(lotKey), "Recall: unknown lot");
        require(classification != Classification.None, "Recall: no class");
        require(_recallIdPlusOne[lotKey] == 0, "Recall: already recalled");
        id = _recalls.length;
        _recalls.push(Recall(lotKey, classification, uint64(block.timestamp), reasonHash, msg.sender, fromCrowdSignal));
        _recallIdPlusOne[lotKey] = id + 1;
        BatchRegistry.Lot memory lot = batches.getLot(lotKey);
        emit RecallIssued(id, lotKey, lot.ndc, lot.lotNumber, classification, fromCrowdSignal);
    }

    function isRecalled(bytes32 lotKey) external view returns (bool) {
        return _recallIdPlusOne[lotKey] != 0;
    }

    function recallIdOf(bytes32 lotKey) external view returns (uint256) {
        require(_recallIdPlusOne[lotKey] != 0, "Recall: not recalled");
        return _recallIdPlusOne[lotKey] - 1;
    }

    function getRecall(uint256 id) external view returns (Recall memory) {
        return _recalls[id];
    }

    function recallCount() external view returns (uint256) {
        return _recalls.length;
    }

    /// @return units affected units in the region, or 0 when suppressed
    /// @return suppressed true when 0 < units < K_ANONYMITY
    function affectedCount(uint256 recallId, uint16 region) external view returns (uint256 units, bool suppressed) {
        uint256 raw = dispenses.unitsByLotRegion(_recalls[recallId].lotKey, region);
        if (raw > 0 && raw < K_ANONYMITY) return (0, true);
        return (raw, false);
    }

    function totalAffected(uint256 recallId) external view returns (uint256) {
        return dispenses.unitsByLot(_recalls[recallId].lotKey);
    }
}
