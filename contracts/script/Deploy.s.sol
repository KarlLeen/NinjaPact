// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {NinjaPact} from "../src/NinjaPact.sol";
import {MockUSD} from "../src/MockUSD.sol";
import {Badge} from "../src/Badge.sol";

contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        MockUSD musd  = new MockUSD();
        Badge   badge = new Badge();
        NinjaPact pact = new NinjaPact(address(musd), address(badge));
        badge.initialize(address(pact));

        // Give deployer 10 000 mUSD for testing
        musd.mint(deployer, 10_000e6);

        vm.stopBroadcast();

        console.log("=== Ninja Pact Deployed ===");
        console.log("MockUSD  :", address(musd));
        console.log("Badge    :", address(badge));
        console.log("NinjaPact:", address(pact));
        console.log("Deployer :", deployer);
    }
}
