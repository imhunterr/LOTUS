// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IMembershipVerifier} from "../interfaces/IMembershipVerifier.sol";

/// @notice DEVELOPMENT ONLY. Accepts every proof whose `a[0]` is non-zero so tests can exercise
///         the nullifier / threshold logic before the circuit is compiled. Never deploy to a
///         public network; the deploy script refuses to.
contract MockMembershipVerifier is IMembershipVerifier {
    function verifyProof(uint256[2] calldata a, uint256[2][2] calldata, uint256[2] calldata, uint256[4] calldata)
        external
        pure
        returns (bool)
    {
        return a[0] != 0;
    }
}
