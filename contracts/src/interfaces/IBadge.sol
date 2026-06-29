// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IBadge {
    function mint(address to, uint64 commitmentId) external;
    function initialize(address pact) external;
}
