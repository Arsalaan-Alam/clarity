// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.23;

import {Script, console2} from "forge-std/Script.sol";
import {ClarityEscrow} from "../src/ClarityEscrow.sol";

contract DeployClarity is Script {
    function run() external {
        address token = vm.envAddress("USDC_ADDRESS");
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        uint256 platformFeeBP = vm.envOr("PLATFORM_FEE_BP", uint256(500));
        uint256 evaluatorFeeBP = vm.envOr("EVALUATOR_FEE_BP", uint256(500));

        vm.startBroadcast();
        ClarityEscrow escrow = new ClarityEscrow(token, treasury, platformFeeBP, evaluatorFeeBP);
        vm.stopBroadcast();

        console2.log("ClarityEscrow:", address(escrow));
    }
}
