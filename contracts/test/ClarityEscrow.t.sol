// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.23;

import {Test} from "forge-std/Test.sol";
import {ClarityEscrow} from "../src/ClarityEscrow.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

contract ClarityEscrowTest is Test {
    MockUSDC internal token;
    ClarityEscrow internal escrow;

    address internal client = makeAddr("client");
    address internal provider = makeAddr("provider");
    address internal evaluator = makeAddr("evaluator");
    address internal treasury = makeAddr("treasury");

    uint256 internal constant BUDGET = 100e6;

    function setUp() public {
        token = new MockUSDC();
        escrow = new ClarityEscrow(address(token), treasury, 500, 500);

        token.mint(client, 1_000e6);
        vm.prank(client);
        token.approve(address(escrow), type(uint256).max);
    }

    function testCreateFundSubmitAndComplete() public {
        uint256 jobId = _createJob();

        vm.prank(client);
        escrow.setBudget(jobId, BUDGET);

        vm.prank(client);
        escrow.fund(jobId, BUDGET);

        vm.prank(provider);
        escrow.submitWork(jobId, keccak256("deliverable-cid"));

        vm.prank(evaluator);
        escrow.completeJob(jobId);

        assertEq(token.balanceOf(provider), 90e6);
        assertEq(token.balanceOf(evaluator), 5e6);
        assertEq(token.balanceOf(treasury), 5e6);
    }

    function testRejectReturnsFundsToClient() public {
        uint256 jobId = _createJob();

        vm.prank(client);
        escrow.setBudget(jobId, BUDGET);

        vm.prank(client);
        escrow.fund(jobId, BUDGET);

        vm.prank(provider);
        escrow.submitWork(jobId, keccak256("deliverable-cid"));

        uint256 beforeBalance = token.balanceOf(client);
        vm.prank(evaluator);
        escrow.rejectJob(jobId);

        assertEq(token.balanceOf(client), beforeBalance + BUDGET);
    }

    function testClaimRefundAfterExpiry() public {
        uint64 expiresAt = uint64(block.timestamp + 1 hours);
        vm.prank(client);
        uint256 jobId = escrow.createJob(provider, evaluator, expiresAt, keccak256("job"));

        vm.prank(client);
        escrow.setBudget(jobId, BUDGET);

        vm.prank(client);
        escrow.fund(jobId, BUDGET);

        vm.warp(block.timestamp + 2 hours);
        escrow.claimRefund(jobId);

        (, , , , , , , ClarityEscrow.JobStatus status) = escrow.jobs(jobId);
        assertEq(uint8(status), uint8(ClarityEscrow.JobStatus.Expired));
    }

    function _createJob() private returns (uint256 jobId) {
        vm.prank(client);
        jobId = escrow.createJob(provider, evaluator, uint64(block.timestamp + 1 days), keccak256("job-cid"));
    }
}
