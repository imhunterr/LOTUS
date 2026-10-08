// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DispenseLedger} from "../core/DispenseLedger.sol";
import {RecallRegistry} from "../core/RecallRegistry.sol";
import {IMembershipVerifier} from "../interfaces/IMembershipVerifier.sol";
import {Field} from "../libraries/Field.sol";

/// @title AnonymousSignals
/// @notice Lets a patient prove "I received a unit from lot X" in zero knowledge, without
///         revealing which dispense was theirs, and then:
///           (A) file an adverse-event report — crowd-sourced, sybil-resistant pharmacovigilance;
///           (B) acknowledge a recall — gives regulators a live recall-effectiveness figure.
///
///         Nullifier = Poseidon(patientSecret, externalNullifier) → one report per patient per lot
///         and one acknowledgement per patient per recall. Anyone (e.g. a gas relayer) may submit,
///         so patients never need a wallet or crypto.
contract AnonymousSignals {
    enum AckAction { None, StoppedUsing, ReturnedToPharmacy, ConsultedDoctor }

    struct Proof {
        uint256[2] a;
        uint256[2][2] b;
        uint256[2] c;
    }

    DispenseLedger public immutable dispenses;
    RecallRegistry public immutable recalls;
    IMembershipVerifier public immutable verifier;
    uint256 public immutable safetySignalThreshold;

    mapping(uint256 => bool) public nullifierUsed;
    mapping(bytes32 => uint256) public reportCount;
    mapping(bytes32 => uint256) public severitySum;
    mapping(bytes32 => bool) public safetySignalRaised;
    mapping(uint256 => uint256) public ackCount;
    mapping(uint256 => mapping(uint8 => uint256)) public ackByAction;

    event AdverseEventReported(bytes32 indexed lotKey, uint256 nullifierHash, uint8 severity, bytes32 reportCid, uint256 count);
    event SafetySignal(bytes32 indexed lotKey, uint256 reports, uint256 avgSeverityX100);
    event RecallAcknowledged(uint256 indexed recallId, uint256 nullifierHash, AckAction action, uint256 count);

    constructor(DispenseLedger _dispenses, RecallRegistry _recalls, IMembershipVerifier _verifier, uint256 _threshold) {
        dispenses = _dispenses;
        recalls = _recalls;
        verifier = _verifier;
        safetySignalThreshold = _threshold;
    }

    function externalNullifierForReport(bytes32 lotKey) public pure returns (uint256) {
        return Field.toField(keccak256(abi.encode("LOTUS_AE", lotKey)));
    }

    function externalNullifierForAck(uint256 recallId) public pure returns (uint256) {
        return Field.toField(keccak256(abi.encode("LOTUS_ACK", recallId)));
    }

    function reportSignalHash(uint8 severity, bytes32 reportCid) public pure returns (uint256) {
        return Field.toField(keccak256(abi.encode(severity, reportCid)));
    }

    function ackSignalHash(AckAction action) public pure returns (uint256) {
        return Field.toField(keccak256(abi.encode(uint8(action))));
    }

    /// @notice (A) Anonymous, verified adverse-event report. severity: 1 (mild) … 5 (life-threatening).
    function reportAdverseEvent(bytes32 lotKey, uint256 root, uint256 nullifierHash, uint8 severity, bytes32 reportCid, Proof calldata p)
        external
    {
        require(severity >= 1 && severity <= 5, "Signals: severity 1-5");
        _consume(lotKey, root, nullifierHash, externalNullifierForReport(lotKey), reportSignalHash(severity, reportCid), p);

        uint256 count = ++reportCount[lotKey];
        severitySum[lotKey] += severity;
        emit AdverseEventReported(lotKey, nullifierHash, severity, reportCid, count);

        if (!safetySignalRaised[lotKey] && count >= safetySignalThreshold) {
            safetySignalRaised[lotKey] = true;
            emit SafetySignal(lotKey, count, (severitySum[lotKey] * 100) / count);
        }
    }

    /// @notice (B) Anonymous recall acknowledgement.
    function acknowledgeRecall(uint256 recallId, uint256 root, uint256 nullifierHash, AckAction action, Proof calldata p) external {
        require(action != AckAction.None, "Signals: no action");
        bytes32 lotKey = recalls.getRecall(recallId).lotKey;
        _consume(lotKey, root, nullifierHash, externalNullifierForAck(recallId), ackSignalHash(action), p);

        uint256 count = ++ackCount[recallId];
        ackByAction[recallId][uint8(action)] += 1;
        emit RecallAcknowledged(recallId, nullifierHash, action, count);
    }

    /// @notice Share of affected patients-units that confirmed, in basis points (10000 = 100%).
    function recallEffectivenessBps(uint256 recallId) external view returns (uint256) {
        uint256 affected = dispenses.leafCount(recalls.getRecall(recallId).lotKey);
        return affected == 0 ? 0 : (ackCount[recallId] * 10_000) / affected;
    }

    function _consume(bytes32 lotKey, uint256 root, uint256 nullifierHash, uint256 extNullifier, uint256 signal, Proof calldata p)
        private
    {
        require(dispenses.isKnownRoot(lotKey, root), "Signals: unknown root");
        require(!nullifierUsed[nullifierHash], "Signals: already used");
        require(verifier.verifyProof(p.a, p.b, p.c, [root, nullifierHash, extNullifier, signal]), "Signals: invalid proof");
        nullifierUsed[nullifierHash] = true;
    }
}
