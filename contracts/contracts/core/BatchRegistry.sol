// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {LotusBase} from "./LotusBase.sol";
import {RoleRegistry} from "./RoleRegistry.sol";
import {CustodyLedger} from "./CustodyLedger.sol";
import {Roles} from "../libraries/Roles.sol";

/// @title BatchRegistry
/// @notice Manufacturers register lots (NDC + lot number). Registration mints the lot's
///         units into the manufacturer's custody, which starts the chain of custody.
contract BatchRegistry is LotusBase {
    struct Lot {
        string ndc;
        string lotNumber;
        uint64 expiry;
        bytes32 coaHash; // IPFS CID digest of the certificate of analysis
        address manufacturer;
        uint128 units;
        uint64 registeredAt;
    }

    CustodyLedger public immutable custody;
    mapping(bytes32 => Lot) private _lots;
    bytes32[] public allLots;

    event LotRegistered(
        bytes32 indexed lotKey, string ndc, string lotNumber, uint64 expiry, bytes32 coaHash, address indexed manufacturer, uint128 units
    );

    constructor(RoleRegistry _roles, CustodyLedger _custody) LotusBase(_roles) {
        custody = _custody;
    }

    function lotKeyOf(string calldata ndc, string calldata lotNumber) public pure returns (bytes32) {
        return keccak256(abi.encode(ndc, lotNumber));
    }

    function registerLot(string calldata ndc, string calldata lotNumber, uint64 expiry, bytes32 coaHash, uint128 units)
        external
        onlyRole(Roles.MANUFACTURER)
        returns (bytes32 key)
    {
        require(bytes(ndc).length > 0 && bytes(lotNumber).length > 0, "Batch: empty id");
        require(expiry > block.timestamp, "Batch: already expired");
        require(units > 0, "Batch: zero units");
        key = lotKeyOf(ndc, lotNumber);
        require(_lots[key].manufacturer == address(0), "Batch: lot exists");

        _lots[key] = Lot(ndc, lotNumber, expiry, coaHash, msg.sender, units, uint64(block.timestamp));
        allLots.push(key);
        custody.mintToManufacturer(key, msg.sender, units);
        emit LotRegistered(key, ndc, lotNumber, expiry, coaHash, msg.sender, units);
    }

    function exists(bytes32 key) public view returns (bool) {
        return _lots[key].manufacturer != address(0);
    }

    function getLot(bytes32 key) external view returns (Lot memory) {
        require(exists(key), "Batch: unknown lot");
        return _lots[key];
    }

    function ndcHashOf(bytes32 key) external view returns (bytes32) {
        return keccak256(bytes(_lots[key].ndc));
    }

    function isExpired(bytes32 key) external view returns (bool) {
        return block.timestamp >= _lots[key].expiry;
    }

    function lotCount() external view returns (uint256) {
        return allLots.length;
    }
}
