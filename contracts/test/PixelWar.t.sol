// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// =============================================================================
// PixelWar.t.sol — comprehensive single-file test suite
//
// Groups covered:
//   1. Pricing
//   2. Payouts (pull model)
//   3. Batch paint
//   4. Season lifecycle
//   5. Access control
//   6. Fuzz
//
// Storage layout (forge inspect PixelWar storage-layout):
//   slot 0           : _owner  (Ownable)
//   slot 1..20000    : _pixels[0..9999]  — each Pixel is 2 slots
//                      Pixel.owner+color  at slot (1 + pixelId*2)
//                      Pixel.price        at slot (1 + pixelId*2 + 1)
//   slot 20001       : _season.endTime
//   slot 20002       : _season.prizePool
//   slot 20003       : _season.active
//   slot 20004       : _pixelCount  mapping
//   slot 20005       : _earnings    mapping
//   slot 20006       : _pendingWithdrawals mapping
//   slot 20007..20016: _leaderboard address[10]
//   slot 20017       : _leaderboardSize
//   slot 20018       : _allOwners (dynamic array)
//   slot 20019       : _isKnownOwner mapping
// =============================================================================

import {Test} from "forge-std/Test.sol";
import {PixelWar} from "../PixelWar.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

// ---------------------------------------------------------------------------
// Shared base — etches MockERC20 at hardcoded USDC address, deploys PixelWar
// ---------------------------------------------------------------------------
abstract contract PixelWarBase is Test {
    address internal constant USDC_ADDR   = 0x3600000000000000000000000000000000000000;
    uint256 internal constant BASE_PRICE  = 50_000;
    uint256 internal constant GRID_SIZE   = 10_000;
    uint256 internal constant MAX_BATCH   = 50;
    uint256 internal constant SEASON_DUR  = 3_600; // 1 hour

    address internal deployer = makeAddr("deployer");
    address internal alice    = makeAddr("alice");
    address internal bob      = makeAddr("bob");
    address internal carol    = makeAddr("carol");

    PixelWar  internal game;
    MockERC20 internal usdc;

    function setUp() public virtual {
        // Etch MockERC20 bytecode at the canonical USDC constant address.
        MockERC20 mockImpl = new MockERC20("Mock USDC", "mUSDC", 6);
        vm.etch(USDC_ADDR, address(mockImpl).code);
        usdc = MockERC20(USDC_ADDR);

        vm.warp(1_000_000);
        vm.prank(deployer);
        game = new PixelWar(deployer, block.timestamp + SEASON_DUR);
    }

    // ---- helpers -----------------------------------------------------------

    function _fund(address user, uint256 amount) internal {
        usdc.mint(user, amount);
        vm.prank(user);
        usdc.approve(address(game), amount);
    }

    function _paintUnclaimed(address user, uint256 pixelId, uint24 color) internal {
        _fund(user, BASE_PRICE);
        uint256[] memory ids    = new uint256[](1);
        uint24[]  memory colors = new uint24[](1);
        ids[0] = pixelId; colors[0] = color;
        vm.prank(user);
        game.paintPixels(ids, colors, BASE_PRICE);
    }

    function _paint(address user, uint256 pixelId, uint24 color, uint256 cost) internal {
        _fund(user, cost);
        uint256[] memory ids    = new uint256[](1);
        uint24[]  memory colors = new uint24[](1);
        ids[0] = pixelId; colors[0] = color;
        vm.prank(user);
        game.paintPixels(ids, colors, cost);
    }

    function _warpPastEnd() internal {
        (uint256 endTime, , ) = game.getSeason();
        vm.warp(endTime + 1);
    }

    /// @dev Seed 3 unique pixel owners and warp past season end.
    function _seed3AndWarp() internal {
        _paintUnclaimed(alice, 0, 0xAA0000);
        _paint(bob, 0, 0x00BB00, BASE_PRICE * 2);   // bob steals -> prizePool grows
        _paintUnclaimed(carol, 1, 0x0000CC);
        _paintUnclaimed(alice, 2, 0xAA00AA);          // alice needs >=1 pixel to qualify
        _warpPastEnd();
    }
}

// =============================================================================
// 1. PRICING
// =============================================================================
contract PixelWarPricingTest is PixelWarBase {

    /// Unclaimed pixel costs exactly BASE_PRICE; contract receives it; stored price = BASE_PRICE.
    function test_UnclaimedCostsBasePrice() public {
        _fund(alice, BASE_PRICE);
        uint256[] memory ids    = new uint256[](1);
        uint24[]  memory colors = new uint24[](1);
        ids[0] = 42; colors[0] = 0xFF0000;

        uint256 contractBal = usdc.balanceOf(address(game));
        vm.prank(alice);
        game.paintPixels(ids, colors, BASE_PRICE);

        assertEq(usdc.balanceOf(address(game)) - contractBal, BASE_PRICE, "contract received BASE_PRICE");
        (, , uint128 stored) = game.getPixel(42);
        assertEq(stored, BASE_PRICE, "stored price == BASE_PRICE");
        assertEq(usdc.balanceOf(alice), 0, "alice balance drained");
    }

    /// Repainting costs 2× stored price; new stored price == cost paid.
    function test_RepaintCostsTwiceAndUpdatesPrice() public {
        _paintUnclaimed(alice, 0, 0x111111);

        uint256 repaintCost = BASE_PRICE * 2;
        uint256 cBefore = usdc.balanceOf(address(game));
        _paint(bob, 0, 0x222222, repaintCost);
        assertEq(usdc.balanceOf(address(game)) - cBefore, repaintCost, "contract receives 2P");

        (, , uint128 stored) = game.getPixel(0);
        assertEq(stored, repaintCost, "stored price == 2P");
    }

    /// Price doubles on each successive repaint.
    function test_PriceDoublesOnEachRepaint() public {
        _paintUnclaimed(alice, 10, 0x000001);
        (, , uint128 p0) = game.getPixel(10);
        assertEq(p0, BASE_PRICE);

        _paint(bob,   10, 0x000002, uint256(p0) * 2);
        (, , uint128 p1) = game.getPixel(10);
        assertEq(p1, p0 * 2);

        _paint(alice, 10, 0x000003, uint256(p1) * 2);
        (, , uint128 p2) = game.getPixel(10);
        assertEq(p2, p1 * 2);
    }

    /// PriceOverflow reverts when oldPrice > type(uint128).max / 2.
    function test_PriceOverflowReverts() public {
        uint256 pixelId       = 99;
        uint256 overflowPrice = type(uint128).max / 2 + 1;

        // _pixels base is slot 1; each Pixel is 2 slots.
        bytes32 ownerSlot = bytes32(uint256(1) + pixelId * 2);
        bytes32 priceSlot = bytes32(uint256(1) + pixelId * 2 + 1);

        vm.store(address(game), ownerSlot, bytes32(uint256(uint160(alice))));
        vm.store(address(game), priceSlot, bytes32(overflowPrice));

        // Verify writes landed.
        (address storedOwner, , uint128 storedPrice) = game.getPixel(pixelId);
        assertEq(storedOwner, alice,         "owner write check");
        assertEq(storedPrice, overflowPrice, "price write check");

        uint256 attemptedCost = overflowPrice * 2;
        _fund(bob, attemptedCost);
        uint256[] memory ids    = new uint256[](1);
        uint24[]  memory colors = new uint24[](1);
        ids[0] = pixelId; colors[0] = 0xFF0000;

        vm.prank(bob);
        vm.expectRevert(PixelWar.PriceOverflow.selector);
        game.paintPixels(ids, colors, attemptedCost);
    }
}

// =============================================================================
// 2. PAYOUTS (pull model)
// =============================================================================
contract PixelWarPayoutTest is PixelWarBase {

    /// Alice owns pixel at P; Bob steals → Bob pays 2P, Alice gets 3P/2, prizePool += P/2.
    function test_StealPayout() public {
        _paintUnclaimed(alice, 1, 0xAA0000);
        uint256 P              = BASE_PRICE;
        uint256 expectedPayout = (P * 3) / 2;
        uint256 expectedPrize  = P / 2;

        (, uint256 prizeBefore,)  = game.getSeason();
        uint256 pendingBefore = game.getPendingWithdrawal(alice);

        _paint(bob, 1, 0x00BB00, P * 2);

        assertEq(game.getPendingWithdrawal(alice) - pendingBefore, expectedPayout, "alice pendingWithdrawals += 3P/2");
        (, uint256 prizeAfter,) = game.getSeason();
        assertEq(prizeAfter - prizeBefore, expectedPrize, "prizePool += P/2");
    }

    /// payout + prizeContribution == totalCost (2P) when P is even.
    function test_PayoutPlusPrizeEqualsCost() public {
        _paintUnclaimed(alice, 5, 0x001122);
        uint256 P    = BASE_PRICE;   // 50_000 — even, so no 1-wei truncation
        uint256 cost = P * 2;

        uint256 pendingBefore     = game.getPendingWithdrawal(alice);
        (, uint256 prizeBefore,)  = game.getSeason();

        _paint(bob, 5, 0x334455, cost);

        uint256 payout = game.getPendingWithdrawal(alice) - pendingBefore;
        (, uint256 prizeAfter,)   = game.getSeason();
        uint256 prize  = prizeAfter - prizeBefore;

        assertEq(payout + prize, cost, "payout + prize == cost");
    }

    /// Self-repaint: Alice pays 2P, Alice's pending += 3P/2, prizePool += P/2, pixelCount unchanged.
    function test_SelfRepaint() public {
        _paintUnclaimed(alice, 2, 0xAAAAAA);
        uint256 P              = BASE_PRICE;
        uint256 cost           = P * 2;
        uint256 expectedPayout = (P * 3) / 2;
        uint256 expectedPrize  = P / 2;

        uint256 countBefore   = game.getPixelCount(alice);
        uint256 pendingBefore = game.getPendingWithdrawal(alice);
        (, uint256 prizeBefore,) = game.getSeason();

        _paint(alice, 2, 0xBBBBBB, cost);

        assertEq(game.getPixelCount(alice),          countBefore,    "pixelCount unchanged");
        assertEq(game.getPendingWithdrawal(alice) - pendingBefore, expectedPayout, "alice += 3P/2");
        (, uint256 prizeAfter,) = game.getSeason();
        assertEq(prizeAfter - prizeBefore,           expectedPrize,  "prizePool += P/2");
    }

    /// Unclaimed pixel: full BASE_PRICE goes to contract, prizePool unchanged.
    function test_UnclaimedNoPrize() public {
        (, uint256 prizeBefore,) = game.getSeason();
        _paintUnclaimed(alice, 3, 0x010203);
        (, uint256 prizeAfter,)  = game.getSeason();

        assertEq(prizeAfter, prizeBefore,             "no prize contribution");
        assertEq(usdc.balanceOf(address(game)), BASE_PRICE, "full BASE_PRICE in contract");
    }

    /// claimEarnings transfers credited amount and resets pendingWithdrawals to 0.
    function test_ClaimEarnings() public {
        _paintUnclaimed(alice, 4, 0xFF0001);
        _paint(bob, 4, 0xFF0002, BASE_PRICE * 2);

        uint256 expected = (BASE_PRICE * 3) / 2;
        assertEq(game.getPendingWithdrawal(alice), expected);

        uint256 aliceBalBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        game.claimEarnings();

        assertEq(usdc.balanceOf(alice) - aliceBalBefore, expected, "transferred amount");
        assertEq(game.getPendingWithdrawal(alice), 0,              "pendingWithdrawals reset to 0");
    }

    /// claimEarnings with 0 pending reverts PendingWithdrawalZero.
    function test_ClaimEarnings_ZeroPendingReverts() public {
        vm.prank(alice);
        vm.expectRevert(PixelWar.PendingWithdrawalZero.selector);
        game.claimEarnings();
    }
}

// =============================================================================
// 3. BATCH PAINT
// =============================================================================
contract PixelWarBatchTest is PixelWarBase {

    /// Batch of 1 unclaimed pixel succeeds; state is correct.
    function test_Batch1Unclaimed() public {
        _fund(alice, BASE_PRICE);
        uint256[] memory ids    = new uint256[](1);
        uint24[]  memory colors = new uint24[](1);
        ids[0] = 100; colors[0] = 0x112233;

        vm.prank(alice);
        game.paintPixels(ids, colors, BASE_PRICE);

        (address owner, uint24 color, uint128 price) = game.getPixel(100);
        assertEq(owner, alice);
        assertEq(color, 0x112233);
        assertEq(price, BASE_PRICE);
    }

    /// Batch of 50 (max) — mix of unclaimed and pre-owned pixels.
    function test_Batch50Mixed() public {
        // Bob claims pixels 0-24.
        uint256 bobCost = BASE_PRICE * 25;
        _fund(bob, bobCost);
        uint256[] memory bobIds    = new uint256[](25);
        uint24[]  memory bobColors = new uint24[](25);
        for (uint256 i = 0; i < 25; i++) { bobIds[i] = i; bobColors[i] = 0xAAAAAA; }
        vm.prank(bob);
        game.paintPixels(bobIds, bobColors, bobCost);

        // Alice paints 0-49: 0-24 owned by bob (cost 2×), 25-49 unclaimed (cost 1×).
        uint256 totalCost = (BASE_PRICE * 2 * 25) + (BASE_PRICE * 25);
        _fund(alice, totalCost);
        uint256[] memory ids    = new uint256[](50);
        uint24[]  memory colors = new uint24[](50);
        for (uint256 i = 0; i < 50; i++) { ids[i] = i; colors[i] = 0xBBBBBB; }

        vm.prank(alice);
        game.paintPixels(ids, colors, totalCost);

        (address o0, , )  = game.getPixel(0);
        (address o25, , ) = game.getPixel(25);
        assertEq(o0, alice);
        assertEq(o25, alice);
        assertEq(game.getPixelCount(alice), 50);
    }

    /// 51 pixels → BatchTooLarge.
    function test_51PixelsBatchTooLarge() public {
        uint256[] memory ids    = new uint256[](51);
        uint24[]  memory colors = new uint24[](51);
        for (uint256 i = 0; i < 51; i++) { ids[i] = i; colors[i] = 0x000001; }
        _fund(alice, BASE_PRICE * 51);

        vm.prank(alice);
        vm.expectRevert(PixelWar.BatchTooLarge.selector);
        game.paintPixels(ids, colors, BASE_PRICE * 51);
    }

    /// Mismatched array lengths → InvalidArrayLengths.
    function test_MismatchedArraysRevert() public {
        uint256[] memory ids    = new uint256[](2);
        uint24[]  memory colors = new uint24[](1);
        ids[0] = 0; ids[1] = 1; colors[0] = 0x000001;
        _fund(alice, BASE_PRICE * 2);

        vm.prank(alice);
        vm.expectRevert(PixelWar.InvalidArrayLengths.selector);
        game.paintPixels(ids, colors, BASE_PRICE * 2);
    }

    /// pixelId >= 10000 → InvalidPixelId.
    function test_InvalidPixelIdReverts() public {
        uint256[] memory ids    = new uint256[](1);
        uint24[]  memory colors = new uint24[](1);
        ids[0] = 10_000; colors[0] = 0x000001;
        _fund(alice, BASE_PRICE);

        vm.prank(alice);
        vm.expectRevert(PixelWar.InvalidPixelId.selector);
        game.paintPixels(ids, colors, BASE_PRICE);
    }

    /// Same pixel twice in one batch — second op uses updated (doubled) price.
    function test_SamePixelTwiceUsesUpdatedPrice() public {
        // Op 0: unclaimed → BASE_PRICE; Op 1: owned by alice at BASE_PRICE → 2×BASE_PRICE.
        uint256 totalCost = BASE_PRICE + BASE_PRICE * 2;
        _fund(alice, totalCost);
        uint256[] memory ids    = new uint256[](2);
        uint24[]  memory colors = new uint24[](2);
        ids[0] = 500; colors[0] = 0x000001;
        ids[1] = 500; colors[1] = 0x000002;

        vm.prank(alice);
        game.paintPixels(ids, colors, totalCost);

        (address owner, uint24 color, uint128 price) = game.getPixel(500);
        assertEq(owner, alice);
        assertEq(color, 0x000002);        // last color wins
        assertEq(price, BASE_PRICE * 2);  // price after second op
    }

    /// InsufficientApproved reverts when totalApproved < actual cost.
    function test_InsufficientApprovedReverts() public {
        uint256 actualCost  = BASE_PRICE;
        uint256 lowApproved = actualCost - 1;
        _fund(alice, actualCost);

        uint256[] memory ids    = new uint256[](1);
        uint24[]  memory colors = new uint24[](1);
        ids[0] = 200; colors[0] = 0x000001;

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(PixelWar.InsufficientApproved.selector, actualCost, lowApproved)
        );
        game.paintPixels(ids, colors, lowApproved);
    }
}

// =============================================================================
// 4. SEASON LIFECYCLE
// =============================================================================
contract PixelWarSeasonTest is PixelWarBase {

    /// paintPixels reverts SeasonAlreadyEnded after endTime (season still active).
    function test_PaintRevertsSeasonAlreadyEnded() public {
        _warpPastEnd();
        _fund(alice, BASE_PRICE);
        uint256[] memory ids    = new uint256[](1);
        uint24[]  memory colors = new uint24[](1);
        ids[0] = 50; colors[0] = 0x000001;

        vm.prank(alice);
        vm.expectRevert(PixelWar.SeasonAlreadyEnded.selector);
        game.paintPixels(ids, colors, BASE_PRICE);
    }

    /// endSeason() reverts SeasonNotYetEnded before endTime.
    function test_EndSeasonRevertsBeforeEndTime() public {
        vm.expectRevert(PixelWar.SeasonNotYetEnded.selector);
        game.endSeason();
    }

    /// endSeason() reverts SeasonInactive if season is already ended.
    function test_EndSeasonRevertsSeasonInactive() public {
        _seed3AndWarp();
        game.endSeason();

        vm.expectRevert(PixelWar.SeasonInactive.selector);
        game.endSeason();
    }

    /// endSeason() after endTime: pays top-3 via pendingWithdrawals (50/30/20), season.active=false, prizePool=0.
    function test_EndSeasonPaysTop3AndResets() public {
        // alice: 2 pixels (most), bob: 1, carol: 2 after stealing.
        _paintUnclaimed(alice, 0, 0xAA0000);
        _paintUnclaimed(alice, 1, 0xAA0001);  // alice: 2
        _paintUnclaimed(bob,   2, 0x00BB00);  // bob: 1
        _paintUnclaimed(carol, 3, 0x0000CC);  // carol: 1

        // Generate prize pool via steals.
        _paint(bob,   0, 0xFF0000, BASE_PRICE * 2);   // bob steals pixel 0 from alice
        _paint(carol, 2, 0xFF0001, BASE_PRICE * 2);   // carol steals pixel 2 from bob

        (, uint256 pool, ) = game.getSeason();
        assertEq(pool, BASE_PRICE / 2 + BASE_PRICE / 2, "prize pool from two steals");

        _warpPastEnd();

        uint256 aliceBefore = game.getPendingWithdrawal(alice);
        uint256 bobBefore   = game.getPendingWithdrawal(bob);
        uint256 carolBefore = game.getPendingWithdrawal(carol);

        game.endSeason();

        (, uint256 prizeAfter, bool activeAfter) = game.getSeason();
        assertFalse(activeAfter, "season inactive");
        assertEq(prizeAfter, 0,  "prizePool reset to 0");

        uint256 p0 = (pool * 50) / 100;
        uint256 p1 = (pool * 30) / 100;
        uint256 p2 = pool - p0 - p1;

        uint256 aliceDelta = game.getPendingWithdrawal(alice) - aliceBefore;
        uint256 bobDelta   = game.getPendingWithdrawal(bob)   - bobBefore;
        uint256 carolDelta = game.getPendingWithdrawal(carol) - carolBefore;

        assertEq(aliceDelta + bobDelta + carolDelta, p0 + p1 + p2, "total prize distributed");
        // carol=2 pixels is rank 1 → 50% slice.
        assertEq(carolDelta, p0, "carol (rank 1) gets 50%");
    }

    /// endSeason() reverts InsufficientPlayers if fewer than 3 owners.
    function test_EndSeasonInsufficientPlayers() public {
        _paintUnclaimed(alice, 0, 0xAAAAAA);
        _paintUnclaimed(bob,   1, 0xBBBBBB);
        _warpPastEnd();

        vm.expectRevert(PixelWar.InsufficientPlayers.selector);
        game.endSeason();
    }

    /// startSeason() reverts SeasonAlreadyActive while season is active.
    function test_StartSeasonRevertsWhenActive() public {
        vm.prank(deployer);
        vm.expectRevert(PixelWar.SeasonAlreadyActive.selector);
        game.startSeason(block.timestamp + 3600);
    }

    /// startSeason() after endSeason succeeds: resets prizePool, sets new endTime.
    function test_StartSeasonAfterEnd() public {
        _seed3AndWarp();
        game.endSeason();

        uint256 newEndTime = block.timestamp + 7200;
        vm.prank(deployer);
        game.startSeason(newEndTime);

        (uint256 et, uint256 prize, bool active) = game.getSeason();
        assertTrue(active,         "season active");
        assertEq(et, newEndTime,   "endTime set");
        assertEq(prize, 0,         "prizePool reset");
    }

    /// setSeasonEndTime() only works during active season with a future time.
    function test_SetSeasonEndTime() public {
        uint256 newEnd = block.timestamp + 7200;
        vm.prank(deployer);
        game.setSeasonEndTime(newEnd);

        (uint256 et, , ) = game.getSeason();
        assertEq(et, newEnd);
    }

    function test_SetSeasonEndTimeRevertsIfInactive() public {
        _seed3AndWarp();
        game.endSeason();

        vm.prank(deployer);
        vm.expectRevert(PixelWar.SeasonInactive.selector);
        game.setSeasonEndTime(block.timestamp + 7200);
    }

    function test_SetSeasonEndTimeRevertsForPastTime() public {
        vm.prank(deployer);
        vm.expectRevert(PixelWar.InvalidEndTime.selector);
        game.setSeasonEndTime(block.timestamp); // not strictly future
    }
}

// =============================================================================
// 5. ACCESS CONTROL
// =============================================================================
contract PixelWarAccessControlTest is PixelWarBase {

    /// startSeason reverts for non-owner.
    function test_StartSeasonRevertsNonOwner() public {
        _seed3AndWarp();
        game.endSeason();

        vm.prank(alice);
        vm.expectRevert(); // OwnableUnauthorizedAccount
        game.startSeason(block.timestamp + 3600);
    }

    /// setSeasonEndTime reverts for non-owner.
    function test_SetSeasonEndTimeRevertsNonOwner() public {
        vm.prank(alice);
        vm.expectRevert(); // OwnableUnauthorizedAccount
        game.setSeasonEndTime(block.timestamp + 7200);
    }

    /// endSeason is callable by anyone after endTime.
    function test_EndSeasonCallableByAnyone() public {
        _seed3AndWarp();

        address anyone = makeAddr("anyone");
        vm.prank(anyone);
        game.endSeason(); // must not revert

        (, , bool active) = game.getSeason();
        assertFalse(active);
    }
}

// =============================================================================
// 6. FUZZ
// =============================================================================
contract PixelWarFuzzTest is PixelWarBase {

    /// Fuzz: sequential repaints always double the stored price.
    function testFuzz_RepaintAlwaysDoubles(uint256 pixelId, uint8 rounds) public {
        pixelId = bound(pixelId, 0, GRID_SIZE - 1);
        rounds  = uint8(bound(rounds, 1, 4));

        _paintUnclaimed(alice, pixelId, 0x000001);

        address[2] memory players = [alice, bob];
        uint256 expectedPrice = BASE_PRICE;

        for (uint256 r = 0; r < rounds; r++) {
            uint256 cost = expectedPrice * 2;
            address painter = players[r % 2];

            _paint(painter, pixelId, uint24(r + 1), cost);

            (, , uint128 storedPrice) = game.getPixel(pixelId);
            assertEq(storedPrice, cost, "stored price must equal repaint cost");
            expectedPrice = cost;
        }
    }

    /// Fuzz: payout = floor(3P/2), prizeContrib = floor(P/2), sum within 1 of 2P.
    function testFuzz_PayoutConservation(uint128 price) public {
        uint128 maxSafe = uint128(type(uint128).max / 2);
        price = uint128(bound(uint256(price), 1, maxSafe));

        uint256 pixelId = 7777;

        // Write pixel state directly (storage layout verified via forge inspect).
        bytes32 ownerSlot = bytes32(uint256(1) + pixelId * 2);
        bytes32 priceSlot = bytes32(uint256(1) + pixelId * 2 + 1);
        vm.store(address(game), ownerSlot, bytes32(uint256(uint160(alice))));
        vm.store(address(game), priceSlot, bytes32(uint256(price)));

        // Patch _pixelCount[alice] += 1 (_pixelCount is mapping at slot 20004).
        bytes32 pixelCountSlot = keccak256(abi.encode(alice, uint256(20004)));
        uint256 existing = uint256(vm.load(address(game), pixelCountSlot));
        vm.store(address(game), pixelCountSlot, bytes32(existing + 1));

        uint256 cost           = uint256(price) * 2;
        // prizeContribution = floor(P/2); payout = cost - prizeContribution (exact)
        uint256 expectedPrize  = uint256(price) / 2;
        uint256 expectedPayout = cost - expectedPrize;

        uint256 pendingBefore     = game.getPendingWithdrawal(alice);
        (, uint256 prizeBefore, ) = game.getSeason();

        _paint(bob, pixelId, 0x999999, cost);

        uint256 alicePayout   = game.getPendingWithdrawal(alice) - pendingBefore;
        (, uint256 prizeAfter, ) = game.getSeason();
        uint256 prizeIncrease = prizeAfter - prizeBefore;

        assertEq(alicePayout,   expectedPayout, "payout = cost - floor(P/2)");
        assertEq(prizeIncrease, expectedPrize,  "prize  = floor(P/2)");
        // Exact conservation: payout + prize == cost, always.
        assertEq(alicePayout + prizeIncrease, cost, "payout + prize == cost");
    }

    /// Fuzz: batch of N unclaimed pixels costs exactly N * BASE_PRICE.
    function testFuzz_BatchCostNUnclaimed(uint256 n) public {
        n = bound(n, 1, MAX_BATCH);

        uint256 totalCost = n * BASE_PRICE;
        _fund(alice, totalCost);

        uint256[] memory ids    = new uint256[](n);
        uint24[]  memory colors = new uint24[](n);
        for (uint256 i = 0; i < n; i++) { ids[i] = i; colors[i] = 0x000001; }

        uint256 cBefore = usdc.balanceOf(address(game));
        vm.prank(alice);
        game.paintPixels(ids, colors, totalCost);

        assertEq(usdc.balanceOf(address(game)) - cBefore, totalCost, "contract received N*BASE_PRICE");
        assertEq(game.getPixelCount(alice), n, "pixelCount == n");
    }

    /// Fuzz: pixelCount tracks ownership correctly across claim → steal → steal-back.
    function testFuzz_PixelCountTracksOwnership(uint256 pixelId) public {
        pixelId = bound(pixelId, 0, GRID_SIZE - 1);

        assertEq(game.getPixelCount(alice), 0);
        assertEq(game.getPixelCount(bob),   0);

        _paintUnclaimed(alice, pixelId, 0x111111);
        assertEq(game.getPixelCount(alice), 1);
        assertEq(game.getPixelCount(bob),   0);

        _paint(bob, pixelId, 0x222222, BASE_PRICE * 2);
        assertEq(game.getPixelCount(alice), 0);
        assertEq(game.getPixelCount(bob),   1);

        _paint(alice, pixelId, 0x333333, BASE_PRICE * 4);
        assertEq(game.getPixelCount(alice), 1);
        assertEq(game.getPixelCount(bob),   0);
    }
}
