// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Soulbound (non-transferable) ERC-721 badge.
/// Mint-only; transfer and approval are disabled.
contract Badge {
    string public constant name   = "Ninja Pact Badge";
    string public constant symbol = "NPB";

    uint256 private _nextTokenId = 1;

    // tokenId → owner
    mapping(uint256 => address) public ownerOf;
    // tokenId → commitmentId that triggered the mint
    mapping(uint256 => uint64) public commitmentOf;
    // owner → badge count
    mapping(address => uint256) public balanceOf;

    address public pact;   // only NinjaPact may mint; set once via initialize
    bool    private _initialized;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);

    error Soulbound();
    error Unauthorized();
    error AlreadyInitialized();

    constructor() {}

    /// Called once by the deployer after NinjaPact is deployed.
    function initialize(address _pact) external {
        if (_initialized) revert AlreadyInitialized();
        _initialized = true;
        pact = _pact;
    }

    function mint(address to, uint64 commitmentId) external {
        if (msg.sender != pact) revert Unauthorized();
        uint256 tokenId = _nextTokenId++;
        ownerOf[tokenId]      = to;
        commitmentOf[tokenId] = commitmentId;
        balanceOf[to]++;
        emit Transfer(address(0), to, tokenId);
    }

    // Soulbound: block all transfers
    function transferFrom(address, address, uint256) external pure {
        revert Soulbound();
    }

    function safeTransferFrom(address, address, uint256) external pure {
        revert Soulbound();
    }

    function approve(address, uint256) external pure {
        revert Soulbound();
    }

    function setApprovalForAll(address, bool) external pure {
        revert Soulbound();
    }
}
