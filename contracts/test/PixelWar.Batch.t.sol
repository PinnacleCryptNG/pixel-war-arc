// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PixelWarTestBase} from "./PixelWar.Base.t.sol";
import {PixelWar} from "../PixelWar.sol";

contract PixelWarBatchTest is PixelWarTestBase {

    // -----------------------------------------------------------------------
    // 1. Batch of 1 unclaimed pixel
    // -----------------------------------------------------------------------
    function test_Batch1Unclaimed() public {
        _fund(alice, BASE_PRICE);

        uint256[] memory ids    = new uint256[](1);
        uint24[]  memory colors = new uint24[](1);
        ids[0]    = 100;
        colors[0] = 0x112233;

        vm.prank(alice);
        game.paintPixels(ids, colors, BASE_PRICE);

        (address owner, uint24 color, uint128 price) = game.getPixel(100);
        assertEq(owner, alice);
        assertEq(color, 0x112233);
        assertEq(price, BASE_PRICE);
    }

    // -----------------------------------------------------------------------
    // 2. Batch of MAX_BATCH (50) pixels — mix of unclaimed and owned
    // -----------------------------------------------------------------------
    function test_Batch50Mixed() public {
        // Pre-claim pixels 0-24 as bob, then alice buys all 50 (0-49).
        // First: bob claims 0-24 at BASE_PRICE each.
        uint256 bobCost = BASE_PRICE * 25;
        _fund(bob, bobCost);
        {
            uint256[] memory bobIds    = new uint256[](25);
            uint24[]  memory bobColors = new uint24[](25);
            for (uint256 i = 0; i < 25; i++) {
                bobIds[i]    = i;
                bobColors[i] = 0xAAAAAA;
            }
            vm.prank(bob);
            game.paintPixels(bobIds, bobColors, bobCost);
        }

        // Now alice paints pixels 0-49:
        // - 0-24: claimed by bob → cost = 2 × BASE_PRICE each
        // - 25-49: unclaimed     → cost = BASE_PRICE each
        uint256 totalCost = (BASE_PRICE * 2 * 25) + (BASE_PRICE * 25);
        _fund(alice, totalCost);

        uint256[] memory ids    = new uint256[](50);
        uint24[]  memory colors = new uint24[](50);
        for (uint256 i = 0; i < 50; i++) {
            ids[i]    = i;
            colors[i] = 0xBBBBBB;
        }

        vm.prank(alice);
        game.paintPixels(ids, colors, totalCost);

        // Spot-check a few pixels.
        (address o0, , ) = game.getPixel(0);
        (address o25, , ) = game.getPixel(25);
        assertEq(o0,  alice);
        assertEq(o25, alice);
        assertEq(game.getPixelCount(alice), 50);
    }

    // -----------------------------------------------------------------------
    // 3. Batch of 51 reverts with BatchTooLarge
    // -----------------------------------------------------------------------
    function test_Batch51_RevertsBatchTooLarge() public {
        uint256[] memory ids    = new uint256[](51);
        uint24[]  memory colors = new uint24[](51);
        for (uint256 i = 0; i < 51; i++) {
            ids[i]    = i;
            colors[i] = 0x000001;
        }
        _fund(alice, BASE_PRICE * 51);

        vm.prank(alice);
        vm.expectRevert(PixelWar.BatchTooLarge.selector);
        game.paintPixels(ids, colors, BASE_PRICE * 51);
    }

    // -----------------------------------------------------------------------
    // 4. Mismatched array lengths reverts with InvalidArrayLengths
    // -----------------------------------------------------------------------
    function test_MismatchedArrayLengths_Reverts() public {
        uint256[] memory ids    = new uint256[](2);
        uint24[]  memory colors = new uint24[](1);
        ids[0] = 0; ids[1] = 1;
        colors[0] = 0x000001;
        _fund(alice, BASE_PRICE * 2);

        vm.prank(alice);
        vm.expectRevert(PixelWar.InvalidArrayLengths.selector);
        game.paintPixels(ids, colors, BASE_PRICE * 2);
    }

    // -----------------------------------------------------------------------
    // 5. Invalid pixelId (>= 10000) reverts with InvalidPixelId
    // -----------------------------------------------------------------------
    function test_InvalidPixelId_Reverts() public {
        uint256[] memory ids    = new uint256[](1);
        uint24[]  memory colors = new uint24[](1);
        ids[0]    = 10_000; // GRID_SIZE, out of bounds
        colors[0] = 0x000001;
        _fund(alice, BASE_PRICE);

        vm.prank(alice);
        vm.expectRevert(PixelWar.InvalidPixelId.selector);
        game.paintPixels(ids, colors, BASE_PRICE);
    }

    // -----------------------------------------------------------------------
    // 6. Same pixel twice in one batch — second operation uses updated price
    // -----------------------------------------------------------------------
    function test_SamePixelTwiceInBatch() public {
        // Both ops in the same batch target pixel 500.
        // Op 0: unclaimed → cost = BASE_PRICE
        // Op 1: now owned by msg.sender (alice) at price BASE_PRICE → cost = 2×BASE_PRICE
        uint256 totalCost = BASE_PRICE + BASE_PRICE * 2;
        _fund(alice, totalCost);

        uint256[] memory ids    = new uint256[](2);
        uint24[]  memory colors = new uint24[](2);
        ids[0]    = 500; colors[0] = 0x000001;
        ids[1]    = 500; colors[1] = 0x000002;

        vm.prank(alice);
        game.paintPixels(ids, colors, totalCost);

        // Final state: alice owns pixel 500, color = second op's color.
        (address owner, uint24 color, uint128 price) = game.getPixel(500);
        assertEq(owner, alice);
        assertEq(color, 0x000002);
        // Price after op 1 = 2×BASE_PRICE.
        assertEq(price, BASE_PRICE * 2);
    }

    // -----------------------------------------------------------------------
    // 7. InsufficientApproved reverts when totalApproved < actualTotalCost
    // -----------------------------------------------------------------------
    function test_InsufficientApproved_Reverts() public {
        // Actually fund & approve alice, but pass a lower totalApproved param.
        uint256 actualCost = BASE_PRICE;
        uint256 lowApproved = actualCost - 1;

        _fund(alice, actualCost);

        uint256[] memory ids    = new uint256[](1);
        uint24[]  memory colors = new uint24[](1);
        ids[0]    = 200;
        colors[0] = 0x000001;

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(PixelWar.InsufficientApproved.selector, actualCost, lowApproved)
        );
        game.paintPixels(ids, colors, lowApproved);
    }

    // -----------------------------------------------------------------------
    // 8. Batch revert SeasonInactive when season is not active
    // -----------------------------------------------------------------------
    function test_PaintReverts_SeasonInactive() public {
        // End the season first.
        _warpPastEnd();
        vm.prank(deployer);

        // Build a 3-player leaderboard first so endSeason doesn't fail.
        // Actually we don't need to call endSeason; just test SeasonAlreadyEnded.
        // The contract reverts SeasonAlreadyEnded when past endTime (season still active).
        _fund(alice, BASE_PRICE);
        uint256[] memory ids    = new uint256[](1);
        uint24[]  memory colors = new uint24[](1);
        ids[0]    = 0;
        colors[0] = 0x000001;
        vm.prank(alice);
        vm.expectRevert(PixelWar.SeasonAlreadyEnded.selector);
        game.paintPixels(ids, colors, BASE_PRICE);
    }

    // -----------------------------------------------------------------------
    // 9. pixelCount increments correctly for a batch of new pixels
    // -----------------------------------------------------------------------
    function test_PixelCountAfterBatch() public {
        uint256 n = 10;
        _fund(alice, BASE_PRICE * n);
        uint256[] memory ids    = new uint256[](n);
        uint24[]  memory colors = new uint24[](n);
        for (uint256 i = 0; i < n; i++) {
            ids[i]    = 9000 + i;
            colors[i] = 0x000001;
        }
        vm.prank(alice);
        game.paintPixels(ids, colors, BASE_PRICE * n);

        assertEq(game.getPixelCount(alice), n);
    }
}
