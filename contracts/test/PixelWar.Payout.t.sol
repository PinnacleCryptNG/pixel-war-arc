// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PixelWarTestBase} from "./PixelWar.Base.t.sol";
import {PixelWar} from "../PixelWar.sol";

contract PixelWarPayoutTest is PixelWarTestBase {

    // -----------------------------------------------------------------------
    // 1. When Bob steals Alice's pixel at price P:
    //    - Bob pays 2P
    //    - Alice gets 3P/2 in pendingWithdrawals
    //    - prizePool increases by P/2
    // -----------------------------------------------------------------------
    function test_StealPayout() public {
        // Alice claims pixel 1 at BASE_PRICE.
        _paintUnclaimed(alice, 1, 0xAA0000);

        uint256 P = BASE_PRICE;
        uint256 cost             = P * 2;
        uint256 expectedPayout   = (P * 3) / 2;
        uint256 expectedPrize    = P / 2;

        (, uint256 prizePoolBefore, ) = game.getSeason();
        uint256 pendingAliceBefore    = game.getPendingWithdrawal(alice);

        _paint(bob, 1, 0x00BB00, cost);

        (, uint256 prizePoolAfter, ) = game.getSeason();
        uint256 pendingAliceAfter    = game.getPendingWithdrawal(alice);

        assertEq(pendingAliceAfter - pendingAliceBefore, expectedPayout, "alice pendingWithdrawals");
        assertEq(prizePoolAfter - prizePoolBefore,       expectedPrize,  "prizePool contribution");
    }

    // -----------------------------------------------------------------------
    // 2. Self-repaint (Alice repaints her own pixel)
    //    - Alice pays 2P
    //    - Alice credited 3P/2
    //    - prizePool gets P/2
    //    - pixelCount unchanged
    // -----------------------------------------------------------------------
    function test_SelfRepaintPayout() public {
        _paintUnclaimed(alice, 2, 0xAAAAAA);

        uint256 P              = BASE_PRICE;
        uint256 cost           = P * 2;
        uint256 expectedPayout = (P * 3) / 2;
        uint256 expectedPrize  = P / 2;

        uint256 pixelCountBefore  = game.getPixelCount(alice);
        uint256 pendingBefore     = game.getPendingWithdrawal(alice);
        (, uint256 prizeBefore, ) = game.getSeason();

        _paint(alice, 2, 0xBBBBBB, cost);

        uint256 pixelCountAfter  = game.getPixelCount(alice);
        uint256 pendingAfter     = game.getPendingWithdrawal(alice);
        (, uint256 prizeAfter, ) = game.getSeason();

        assertEq(pixelCountAfter, pixelCountBefore,            "pixelCount unchanged");
        assertEq(pendingAfter - pendingBefore, expectedPayout, "alice credited 3P/2");
        assertEq(prizeAfter  - prizeBefore,   expectedPrize,  "prizePool += P/2");
    }

    // -----------------------------------------------------------------------
    // 3. Unclaimed pixel: full BASE_PRICE stays in contract, no prize pool
    // -----------------------------------------------------------------------
    function test_UnclaimedPixelNoPrizeContribution() public {
        (, uint256 prizePoolBefore, ) = game.getSeason();
        _paintUnclaimed(alice, 3, 0x010203);
        (, uint256 prizePoolAfter, ) = game.getSeason();

        assertEq(prizePoolAfter, prizePoolBefore, "no prize contribution for unclaimed");
        assertEq(usdc.balanceOf(address(game)),   BASE_PRICE, "full BASE_PRICE in contract");
    }

    // -----------------------------------------------------------------------
    // 4. claimEarnings() transfers credited amount to caller, resets to 0
    // -----------------------------------------------------------------------
    function test_ClaimEarnings() public {
        // Alice owns pixel; Bob steals → Alice earns 3P/2.
        _paintUnclaimed(alice, 4, 0xFF0001);
        _paint(bob, 4, 0xFF0002, BASE_PRICE * 2);

        uint256 expectedPending = (BASE_PRICE * 3) / 2;
        assertEq(game.getPendingWithdrawal(alice), expectedPending);

        uint256 aliceBalBefore = usdc.balanceOf(alice);

        vm.prank(alice);
        game.claimEarnings();

        uint256 aliceBalAfter = usdc.balanceOf(alice);

        assertEq(aliceBalAfter - aliceBalBefore, expectedPending, "transferred amount");
        assertEq(game.getPendingWithdrawal(alice), 0,             "pendingWithdrawals reset");
    }

    // -----------------------------------------------------------------------
    // 5. claimEarnings() reverts with PendingWithdrawalZero when nothing owed
    // -----------------------------------------------------------------------
    function test_ClaimEarnings_RevertsWhenZero() public {
        vm.prank(alice);
        vm.expectRevert(PixelWar.PendingWithdrawalZero.selector);
        game.claimEarnings();
    }

    // -----------------------------------------------------------------------
    // 6. payout + prizeContribution == cost (conservation check)
    // -----------------------------------------------------------------------
    function test_PayoutConservation() public {
        _paintUnclaimed(alice, 5, 0x001122);

        uint256 P    = BASE_PRICE;
        uint256 cost = P * 2;

        uint256 pendingBefore     = game.getPendingWithdrawal(alice);
        (, uint256 prizeBefore, ) = game.getSeason();

        _paint(bob, 5, 0x334455, cost);

        uint256 pendingAfter     = game.getPendingWithdrawal(alice);
        (, uint256 prizeAfter, ) = game.getSeason();

        uint256 alicePayout     = pendingAfter - pendingBefore;
        uint256 prizeIncrease   = prizeAfter  - prizeBefore;

        // 3P/2 + P/2 = 2P = cost  (integer math: 3*P/2 + P/2 might be off by 1 for odd P)
        assertEq(alicePayout + prizeIncrease, cost, "payout + prize == cost");
    }

    // -----------------------------------------------------------------------
    // 7. earnings() accumulates correctly over multiple steals
    // -----------------------------------------------------------------------
    function test_EarningsAccumulate() public {
        // Alice claims pixel 6.
        _paintUnclaimed(alice, 6, 0x000001);

        // Bob steals (cost=2*BASE_PRICE, alice earns 3*BASE_PRICE/2).
        _paint(bob, 6, 0x000002, BASE_PRICE * 2);

        // Alice steals back (price now = 2*BASE_PRICE, cost = 4*BASE_PRICE).
        uint256 p1 = BASE_PRICE * 2;
        _paint(alice, 6, 0x000003, p1 * 2);

        // Bob's earnings: 3*p1/2
        uint256 bobPending = game.getPendingWithdrawal(bob);
        assertEq(bobPending, (p1 * 3) / 2);
    }
}
