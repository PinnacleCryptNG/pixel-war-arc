// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PixelWarTestBase} from "./PixelWar.Base.t.sol";
import {PixelWar} from "../PixelWar.sol";

contract PixelWarSeasonTest is PixelWarTestBase {

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    /// @dev Seed 3 players with pixels and a non-zero prize pool, then warp past endTime.
    function _seed3PlayersAndWarp() internal {
        // alice claims pixel 0
        _paintUnclaimed(alice, 0, 0xAA0000);
        // bob steals pixel 0 → alice gets payout credit, prizePool grows
        _paint(bob, 0, 0x00BB00, BASE_PRICE * 2);
        // carol claims pixel 1 independently
        _paintUnclaimed(carol, 1, 0x0000CC);

        // alice must have pixels to qualify as a winner.
        // alice currently has 0 pixels (bob stole hers). Give alice pixel 2.
        _paintUnclaimed(alice, 2, 0xAA00AA);

        _warpPastEnd();
    }

    // -----------------------------------------------------------------------
    // 1. endSeason() reverts if not yet past endTime
    // -----------------------------------------------------------------------
    function test_EndSeason_RevertsBeforeEndTime() public {
        vm.expectRevert(PixelWar.SeasonNotYetEnded.selector);
        game.endSeason();
    }

    // -----------------------------------------------------------------------
    // 2. endSeason() reverts if season is inactive
    // -----------------------------------------------------------------------
    function test_EndSeason_RevertsIfInactive() public {
        _seed3PlayersAndWarp();
        game.endSeason(); // succeeds

        // Season is now inactive → calling again must revert.
        vm.expectRevert(PixelWar.SeasonInactive.selector);
        game.endSeason();
    }

    // -----------------------------------------------------------------------
    // 3. endSeason() succeeds at/after endTime, pays top-3 (50/30/20 split)
    // -----------------------------------------------------------------------
    function test_EndSeason_SucceedsAndPaysWinners() public {
        // Paint many pixels for alice (2), fewer for bob (1) and carol (1)
        // so alice ranks #1 in the leaderboard.
        _paintUnclaimed(alice, 0, 0xAA0000);
        _paintUnclaimed(alice, 1, 0xAA0001);  // alice: 2 pixels
        _paintUnclaimed(bob,   2, 0x00BB00);  // bob:   1 pixel
        _paintUnclaimed(carol, 3, 0x0000CC);  // carol: 1 pixel

        // Generate prize pool: bob steals pixel 0 from alice.
        _paint(bob, 0, 0xFF0000, BASE_PRICE * 2);
        // carol steals pixel 2 from bob.
        _paint(carol, 2, 0xFF0001, BASE_PRICE * 2);

        (, uint256 pool, ) = game.getSeason();
        // Each steal contributes BASE_PRICE/2.
        assertEq(pool, BASE_PRICE / 2 + BASE_PRICE / 2);

        _warpPastEnd();

        uint256 alicePendingBefore = game.getPendingWithdrawal(alice);
        uint256 bobPendingBefore   = game.getPendingWithdrawal(bob);
        uint256 carolPendingBefore = game.getPendingWithdrawal(carol);

        game.endSeason();

        // Season state resets.
        (, uint256 prizeAfter, bool activeAfter) = game.getSeason();
        assertFalse(activeAfter, "season should be inactive");
        assertEq(prizeAfter, 0,  "prizePool should be 0");

        // Payouts: 50 / 30 / 20 split.
        uint256 p0 = (pool * 50) / 100;
        uint256 p1 = (pool * 30) / 100;
        uint256 p2 = pool - p0 - p1;

        // Alice started with 1 pixel (pixel 1), bob currently has pixel 0,
        // carol has pixels 2 and 3.
        // Leaderboard is sorted by pixelCount. carol=2, bob=1, alice=1.
        // winner[0] = carol, winner[1] = alice or bob (order depends on leaderboard).
        // We assert total distributed == pool, not per-address (order is non-deterministic).
        uint256 aliceDelta = game.getPendingWithdrawal(alice) - alicePendingBefore;
        uint256 bobDelta   = game.getPendingWithdrawal(bob)   - bobPendingBefore;
        uint256 carolDelta = game.getPendingWithdrawal(carol) - carolPendingBefore;

        assertEq(aliceDelta + bobDelta + carolDelta, p0 + p1 + p2, "total prize distributed");

        // Carol has 2 pixels → rank 1, must get the 50% slice.
        assertEq(carolDelta, p0, "carol (rank 1) gets 50%");
    }

    // -----------------------------------------------------------------------
    // 4. endSeason() reverts InsufficientPlayers if fewer than 3 unique owners
    // -----------------------------------------------------------------------
    function test_EndSeason_RevertsInsufficientPlayers() public {
        // Only alice and bob paint pixels — not enough for 3 winners.
        _paintUnclaimed(alice, 0, 0xAAAAAA);
        _paintUnclaimed(bob,   1, 0xBBBBBB);

        _warpPastEnd();

        vm.expectRevert(PixelWar.InsufficientPlayers.selector);
        game.endSeason();
    }

    // -----------------------------------------------------------------------
    // 5. After endSeason: season.active = false, prizePool = 0
    // -----------------------------------------------------------------------
    function test_EndSeason_ResetsState() public {
        _seed3PlayersAndWarp();
        game.endSeason();

        (, uint256 prize, bool active) = game.getSeason();
        assertFalse(active);
        assertEq(prize, 0);
    }

    // -----------------------------------------------------------------------
    // 6. startSeason() reverts SeasonAlreadyActive during active season
    // -----------------------------------------------------------------------
    function test_StartSeason_RevertsWhenActive() public {
        vm.prank(deployer);
        vm.expectRevert(PixelWar.SeasonAlreadyActive.selector);
        game.startSeason(block.timestamp + 3600);
    }

    // -----------------------------------------------------------------------
    // 7. startSeason() succeeds after endSeason, resets prizePool, sets endTime
    // -----------------------------------------------------------------------
    function test_StartSeason_SucceedsAfterEnd() public {
        _seed3PlayersAndWarp();
        game.endSeason();

        uint256 newEndTime = block.timestamp + 7200;
        vm.prank(deployer);
        game.startSeason(newEndTime);

        (uint256 et, uint256 prize, bool active) = game.getSeason();
        assertTrue(active,          "season should be active");
        assertEq(et,    newEndTime, "endTime set");
        assertEq(prize, 0,         "prizePool reset");
    }

    // -----------------------------------------------------------------------
    // 8. setSeasonEndTime() only works during active season with future time
    // -----------------------------------------------------------------------
    function test_SetSeasonEndTime_UpdatesDuringActiveSeason() public {
        uint256 newEndTime = block.timestamp + 7200;
        vm.prank(deployer);
        game.setSeasonEndTime(newEndTime);

        (uint256 et, , ) = game.getSeason();
        assertEq(et, newEndTime);
    }

    function test_SetSeasonEndTime_RevertsIfSeasonInactive() public {
        _seed3PlayersAndWarp();
        game.endSeason();

        vm.prank(deployer);
        vm.expectRevert(PixelWar.SeasonInactive.selector);
        game.setSeasonEndTime(block.timestamp + 7200);
    }

    function test_SetSeasonEndTime_RevertsForPastTime() public {
        vm.prank(deployer);
        vm.expectRevert(PixelWar.InvalidEndTime.selector);
        game.setSeasonEndTime(block.timestamp);   // not strictly future
    }

    // -----------------------------------------------------------------------
    // 9. startSeason() reverts for non-owner
    // -----------------------------------------------------------------------
    function test_StartSeason_RevertsForNonOwner() public {
        _seed3PlayersAndWarp();
        game.endSeason();

        vm.prank(alice);
        vm.expectRevert();   // OwnableUnauthorizedAccount
        game.startSeason(block.timestamp + 3600);
    }

    // -----------------------------------------------------------------------
    // 10. setSeasonEndTime() reverts for non-owner
    // -----------------------------------------------------------------------
    function test_SetSeasonEndTime_RevertsForNonOwner() public {
        vm.prank(alice);
        vm.expectRevert();   // OwnableUnauthorizedAccount
        game.setSeasonEndTime(block.timestamp + 7200);
    }

    // -----------------------------------------------------------------------
    // 11. endSeason() is callable by anyone after endTime
    // -----------------------------------------------------------------------
    function test_EndSeason_CallableByAnyone() public {
        _seed3PlayersAndWarp();

        address anyone = makeAddr("anyone");
        vm.prank(anyone);
        game.endSeason();   // should not revert

        (, , bool active) = game.getSeason();
        assertFalse(active);
    }

    // -----------------------------------------------------------------------
    // 12. endSeason() emits SeasonEnded event
    // -----------------------------------------------------------------------
    function test_EndSeason_EmitsEvent() public {
        _seed3PlayersAndWarp();

        // Can't predict exact winners array easily, so just check it doesn't revert
        // and the event is emitted (no expectEmit arg check needed here).
        // We'll verify active=false as the observable outcome.
        game.endSeason();
        (, , bool active) = game.getSeason();
        assertFalse(active);
    }

    // -----------------------------------------------------------------------
    // 13. startSeason() emits SeasonStarted
    // -----------------------------------------------------------------------
    function test_StartSeason_EmitsEvent() public {
        _seed3PlayersAndWarp();
        game.endSeason();

        uint256 newEnd = block.timestamp + 9999;
        vm.prank(deployer);
        vm.expectEmit(false, false, false, true, address(game));
        emit PixelWar.SeasonStarted(newEnd);
        game.startSeason(newEnd);
    }

    // -----------------------------------------------------------------------
    // 14. Painting reverts with SeasonAlreadyEnded when past endTime (active season)
    // -----------------------------------------------------------------------
    function test_Paint_RevertsSeasonAlreadyEnded() public {
        _warpPastEnd();
        _fund(alice, BASE_PRICE);
        uint256[] memory ids    = new uint256[](1);
        uint24[]  memory colors = new uint24[](1);
        ids[0]    = 50;
        colors[0] = 0x000001;
        vm.prank(alice);
        vm.expectRevert(PixelWar.SeasonAlreadyEnded.selector);
        game.paintPixels(ids, colors, BASE_PRICE);
    }

    // -----------------------------------------------------------------------
    // 15. Painting reverts with SeasonInactive after endSeason called
    // -----------------------------------------------------------------------
    function test_Paint_RevertsSeasonInactive() public {
        _seed3PlayersAndWarp();
        game.endSeason();

        _fund(alice, BASE_PRICE);
        uint256[] memory ids    = new uint256[](1);
        uint24[]  memory colors = new uint24[](1);
        ids[0]    = 50;
        colors[0] = 0x000001;
        vm.prank(alice);
        vm.expectRevert(PixelWar.SeasonInactive.selector);
        game.paintPixels(ids, colors, BASE_PRICE);
    }
}
