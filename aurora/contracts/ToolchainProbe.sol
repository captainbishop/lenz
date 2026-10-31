// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

/// @notice Installation fixture only. Does not hold funds or implement Lenz.
contract ToolchainProbe {
    uint256 public value;
    event Recorded(uint256 value);

    function record(uint256 next) external {
        value = next;
        emit Recorded(next);
    }
}
