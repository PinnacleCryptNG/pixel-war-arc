// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PixelWarTestBase} from "./PixelWar.Base.t.sol";
import {PixelWar} from "../PixelWar.sol";

contract PixelWarPricingTest is PixelWarTestBase {

    // -----------------------------------------------------------------------
    // 1. Unclaimed pixel costs BASE_PRICE
    // -----------------------------------------------------------------------
    function test_UnclaimedPixelCostsBasePrice() public {
        uint256 aliceBalBefore = usdc.balanceOf(alice);
        _fund(alice, BASE_PRICE);
        uint256 aliceBalAfter  = usdc.balanceOf(alice);
        // After fund, alice has BASE_PRICE available.
        assertEq(aliceBalAfter - aliceBalBefore, BASE_PRICE);

        uint256[] memory ids    = new uint256[](1);
        uint24[]  memory colors = new uint24[](1);
        ids[0]    = 42;
        colors[0] = 0xFF0000;

        uint256 contractBalBefore = usdc.balanceOf(address(game));
        vm.prank(alice);
        game.paintPixels(ids, colors, BASE_PRICE);

        // Contract received exactly BASE_PRICE.
        assertEq(usdc.balanceOf(address(game)) - contractBalBefore, BASE_PRICE);
        // Pixel price stored equals BASE_PRICE.
        (, , uint128 storedPrice) = game.getPixel(42);
        assertEq(storedPrice, BASE_PRICE);
        // Alice's balance is now 0.
        assertEq(usdc.balanceOf(alice), 0);
    }

    // -----------------------------------------------------------------------
    // 2. Repainting costs 2× current price
    // -----------------------------------------------------------------------
    function test_RepaintCostIsTwiceCurrentPrice() public {
        // Alice claims pixel 0 at BASE_PRICE.
        _paintUnclaimed(alice, 0, 0x111111);

        (, , uint128 priceAfterClaim) = game.getPixel(0);
        assertEq(priceAfterClaim, BASE_PRICE);

        // Bob repaints — must pay 2 × BASE_PRICE.
        uint256 repaintCost = BASE_PRICE * 2;
        uint256 contractBalBefore = usdc.balanceOf(address(game));

        _paint(bob, 0, 0x222222, repaintCost);

        assertEq(usdc.balanceOf(address(game)) - contractBalBefore, repaintCost);
    }

    // -----------------------------------------------------------------------
    // 3. After repaint, stored price == cost paid (2×)
    // -----------------------------------------------------------------------
    function test_StoredPriceEqualsRepaintCost() public {
        _paintUnclaimed(alice, 5, 0xAAAAAA);
        uint256 repaintCost = BASE_PRICE * 2;
        _paint(bob, 5, 0xBBBBBB, repaintCost);

        (, , uint128 storedAfterRepaint) = game.getPixel(5);
        assertEq(storedAfterRepaint, repaintCost);

        // Bob repaints again — new cost is 2× repaintCost.
        uint256 secondRepaintCost = repaintCost * 2;
        _paint(alice, 5, 0xCCCCCC, secondRepaintCost);

        (, , uint128 storedAfterSecond) = game.getPixel(5);
        assertEq(storedAfterSecond, secondRepaintCost);
    }

    // -----------------------------------------------------------------------
    // 4. Price doubles on each successive repaint (chain of 3)
    // -----------------------------------------------------------------------
    function test_PriceDoublesOnEachRepaint() public {
        _paintUnclaimed(alice, 10, 0x000001);
        (, , uint128 p0) = game.getPixel(10);
        assertEq(p0, BASE_PRICE);

        _paint(bob, 10, 0x000002, uint256(p0) * 2);
        (, , uint128 p1) = game.getPixel(10);
        assertEq(p1, p0 * 2);

        _paint(alice, 10, 0x000003, uint256(p1) * 2);
        (, , uint128 p2) = game.getPixel(10);
        assertEq(p2, p1 * 2);
    }

    // -----------------------------------------------------------------------
    // 5. PriceOverflow reverts when price would exceed type(uint128).max / 2
    // -----------------------------------------------------------------------
    function test_PriceOverflowReverts() public {
        // Manually set the pixel price to MAX_PRICE/2 + 1 via storage writes
        // so that attempting to repaint triggers PriceOverflow.
        //
        // Storage layout (from `forge inspect PixelWar storage-layout`):
        //   slot 0          : _owner (Ownable)
        //   slot 1..20000   : _pixels[0..9999], each Pixel occupies 2 slots
        //                     Pixel.owner+color at slot (1 + pixelId*2)
        //                     Pixel.price       at slot (1 + pixelId*2 + 1)
        //
        // Pixel struct packing (64 bytes = 2 slots):
        //   slot 0 of struct: owner (bytes 0-19), color (bytes 20-22)
        //   slot 1 of struct: price (bytes 0-15, uint128)

        uint256 pixelId = 99;
        uint256 overflowPrice = type(uint128).max / 2 + 1;

        // _pixels base slot is 1; each Pixel is 2 slots wide.
        bytes32 ownerSlot = bytes32(uint256(1) + pixelId * 2);
        bytes32 priceSlot = bytes32(uint256(1) + pixelId * 2 + 1);

        // Write owner = alice into the low 20 bytes of ownerSlot.
        vm.store(address(game), ownerSlot, bytes32(uint256(uint160(alice))));
        // Write overflowPrice into priceSlot (uint128 sits in the low 16 bytes).
        vm.store(address(game), priceSlot, bytes32(overflowPrice));

        // Verify the write landed correctly.
        (address storedOwner, , uint128 storedPrice) = game.getPixel(pixelId);
        assertEq(storedOwner, alice,          "owner write check");
        assertEq(storedPrice, overflowPrice,  "price write check");

        // Bob attempts to repaint — contract should revert with PriceOverflow
        // before it ever checks totalApproved.
        uint256 attemptedCost = overflowPrice * 2;
        _fund(bob, attemptedCost);
        uint256[] memory ids    = new uint256[](1);
        uint24[]  memory colors = new uint24[](1);
        ids[0]    = pixelId;
        colors[0] = 0xFF0000;

        vm.prank(bob);
        vm.expectRevert(PixelWar.PriceOverflow.selector);
        game.paintPixels(ids, colors, attemptedCost);
    }
}
