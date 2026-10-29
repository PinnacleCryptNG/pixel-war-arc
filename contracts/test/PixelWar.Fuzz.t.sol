// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PixelWarTestBase} from "./PixelWar.Base.t.sol";
import {PixelWar} from "../PixelWar.sol";

contract PixelWarFuzzTest is PixelWarTestBase {

    // -----------------------------------------------------------------------
    // Fuzz 1: Paint a random unclaimed pixel — price stored == BASE_PRICE
    // -----------------------------------------------------------------------
    function testFuzz_UnclaimedPixelStoredPrice(uint256 pixelId) public {
        pixelId = bound(pixelId, 0, GRID_SIZE - 1);

        _paintUnclaimed(alice, pixelId, 0xABCDEF);

        (, , uint128 storedPrice) = game.getPixel(pixelId);
        assertEq(storedPrice, BASE_PRICE);
    }

    // -----------------------------------------------------------------------
    // Fuzz 2: Each sequential repaint always doubles the stored price
    // -----------------------------------------------------------------------
    function testFuzz_RepaintAlwaysDoubles(uint256 pixelId, uint8 rounds) public {
        pixelId = bound(pixelId, 0, GRID_SIZE - 1);
        rounds  = uint8(bound(rounds, 1, 4));  // keep gas reasonable; price doubles each round

        _paintUnclaimed(alice, pixelId, 0x000001);

        address[2] memory players = [alice, bob];
        uint256 expectedPrice = BASE_PRICE;

        for (uint256 r = 0; r < rounds; r++) {
            uint256 cost = expectedPrice * 2;
            address painter = players[r % 2];
            address other   = players[(r + 1) % 2];

            _paint(painter, pixelId, uint24(r + 1), cost);

            (, , uint128 storedPrice) = game.getPixel(pixelId);
            assertEq(storedPrice, cost, "stored price must equal repaint cost");

            expectedPrice = cost;

            // Keep `other` on the books so we don't run into leaderboard issues;
            // ensure they have some balance for the next round.
            if (r + 1 < rounds) {
                // The `other` player will repaint next round — they need funds.
                // We just need to ensure `_paint` helper will fund them then.
                // Nothing to do here; `_paint` calls `_fund` internally.
                (other); // silence unused-variable warning
            }
        }
    }

    // -----------------------------------------------------------------------
    // Fuzz 3: Payout math conservation — previousOwnerPayout + prizeContribution == cost
    //   for any price P that does NOT trigger PriceOverflow.
    // -----------------------------------------------------------------------
    function testFuzz_PayoutConservation(uint128 price) public {
        // Avoid zero prices and prices above MAX_PRICE/2 (would overflow).
        uint128 maxSafe = uint128(type(uint128).max / 2);
        price = uint128(bound(uint256(price), 1, maxSafe));

        // Plant a pixel with the fuzzed price via storage manipulation.
        uint256 pixelId = 7777;

        // _pixels base is slot 1; each Pixel is 2 slots.
        bytes32 ownerSlot = bytes32(uint256(1) + pixelId * 2);
        bytes32 priceSlot = bytes32(uint256(1) + pixelId * 2 + 1);
        vm.store(address(game), ownerSlot, bytes32(uint256(uint160(alice))));
        vm.store(address(game), priceSlot, bytes32(uint256(price)));

        // Also patch _pixelCount[alice] += 1 so the leaderboard doesn't go haywire.
        //
        // Verified storage layout (forge inspect PixelWar storage-layout):
        //   slot 0          : _owner (Ownable)
        //   slot 1          : _pixels[0] start  (each Pixel = 2 slots)
        //   slots 1..20000  : _pixels[0..9999]
        //   slot 20001      : _season.endTime
        //   slot 20002      : _season.prizePool
        //   slot 20003      : _season.active
        //   slot 20004      : _pixelCount mapping
        //   slot 20005      : _earnings mapping
        //   slot 20006      : _pendingWithdrawals mapping
        //
        // Also fix the pixel storage slots: _pixels base is slot 1 (not 0).
        bytes32 pixelCountSlot = keccak256(abi.encode(alice, uint256(20004)));
        // Add 1 to existing value (likely 0).
        uint256 existing = uint256(vm.load(address(game), pixelCountSlot));
        vm.store(address(game), pixelCountSlot, bytes32(existing + 1));

        uint256 cost           = uint256(price) * 2;
        // prizeContribution = floor(P/2); payout = cost - prizeContribution (exact conservation)
        uint256 expectedPrize  = uint256(price) / 2;
        uint256 expectedPayout = cost - expectedPrize;

        uint256 pendingBefore     = game.getPendingWithdrawal(alice);
        (, uint256 prizeBefore, ) = game.getSeason();

        _paint(bob, pixelId, 0x999999, cost);

        uint256 pendingAfter     = game.getPendingWithdrawal(alice);
        (, uint256 prizeAfter, ) = game.getSeason();

        uint256 alicePayout   = pendingAfter - pendingBefore;
        uint256 prizeIncrease = prizeAfter  - prizeBefore;

        assertEq(alicePayout,   expectedPayout, "payout = cost - floor(P/2)");
        assertEq(prizeIncrease, expectedPrize,  "prize  = floor(P/2)");
        // Exact conservation: payout + prize == cost, always.
        assertEq(alicePayout + prizeIncrease, cost, "payout + prize == cost");
    }

    // -----------------------------------------------------------------------
    // Fuzz 4: pixelCount tracks actual ownership after random repaints
    // -----------------------------------------------------------------------
    function testFuzz_PixelCountTracksOwnership(uint256 pixelId) public {
        pixelId = bound(pixelId, 0, GRID_SIZE - 1);

        assertEq(game.getPixelCount(alice), 0);
        assertEq(game.getPixelCount(bob),   0);

        // Alice claims.
        _paintUnclaimed(alice, pixelId, 0x111111);
        assertEq(game.getPixelCount(alice), 1);
        assertEq(game.getPixelCount(bob),   0);

        // Bob steals.
        _paint(bob, pixelId, 0x222222, BASE_PRICE * 2);
        assertEq(game.getPixelCount(alice), 0);
        assertEq(game.getPixelCount(bob),   1);

        // Alice steals back.
        _paint(alice, pixelId, 0x333333, BASE_PRICE * 4);
        assertEq(game.getPixelCount(alice), 1);
        assertEq(game.getPixelCount(bob),   0);
    }

    // -----------------------------------------------------------------------
    // Fuzz 5: Batch of N unclaimed pixels costs exactly N * BASE_PRICE
    // -----------------------------------------------------------------------
    function testFuzz_BatchCostNUnclaimed(uint256 n) public {
        n = bound(n, 1, MAX_BATCH);

        uint256 totalCost = n * BASE_PRICE;
        _fund(alice, totalCost);

        uint256[] memory ids    = new uint256[](n);
        uint24[]  memory colors = new uint24[](n);
        for (uint256 i = 0; i < n; i++) {
            ids[i]    = i;
            colors[i] = 0x000001;
        }

        uint256 contractBalBefore = usdc.balanceOf(address(game));
        vm.prank(alice);
        game.paintPixels(ids, colors, totalCost);

        assertEq(usdc.balanceOf(address(game)) - contractBalBefore, totalCost);
        assertEq(game.getPixelCount(alice), n);
    }
}
