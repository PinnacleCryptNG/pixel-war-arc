// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PixelWar} from "../PixelWar.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

/// @dev Shared base: deploys the contract and etches MockERC20 at the hardcoded USDC address.
abstract contract PixelWarTestBase is Test {
    // -----------------------------------------------------------------------
    // Constants
    // -----------------------------------------------------------------------
    address internal constant USDC_ADDR = 0x3600000000000000000000000000000000000000;
    uint256 internal constant BASE_PRICE = 50_000;
    uint256 internal constant GRID_SIZE  = 10_000;
    uint256 internal constant MAX_BATCH  = 50;

    // Season duration used for all deployments (1 hour from "now").
    uint256 internal constant SEASON_DURATION = 3600;

    // -----------------------------------------------------------------------
    // Actors
    // -----------------------------------------------------------------------
    address internal deployer = makeAddr("deployer");
    address internal alice    = makeAddr("alice");
    address internal bob      = makeAddr("bob");
    address internal carol    = makeAddr("carol");

    // -----------------------------------------------------------------------
    // Contracts
    // -----------------------------------------------------------------------
    PixelWar  internal game;
    MockERC20 internal usdc;

    // -----------------------------------------------------------------------
    // setUp
    // -----------------------------------------------------------------------
    function setUp() public virtual {
        // 1. Deploy a mock ERC-20 to a throwaway address and etch its
        //    bytecode at the canonical USDC constant.
        MockERC20 mockImpl = new MockERC20("Mock USDC", "mUSDC", 6);
        vm.etch(USDC_ADDR, address(mockImpl).code);
        usdc = MockERC20(USDC_ADDR);

        // 2. Deploy PixelWar with a 1-hour season.
        vm.warp(1_000_000);
        vm.prank(deployer);
        game = new PixelWar(deployer, block.timestamp + SEASON_DURATION);
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /// @dev Mint USDC to `user` and approve the game contract to spend it.
    function _fund(address user, uint256 amount) internal {
        usdc.mint(user, amount);
        vm.prank(user);
        usdc.approve(address(game), amount);
    }

    /// @dev Paint a single unclaimed pixel as `user`.
    function _paintUnclaimed(address user, uint256 pixelId, uint24 color) internal {
        _fund(user, BASE_PRICE);
        uint256[] memory ids    = new uint256[](1);
        uint24[]  memory colors = new uint24[](1);
        ids[0]    = pixelId;
        colors[0] = color;
        vm.prank(user);
        game.paintPixels(ids, colors, BASE_PRICE);
    }

    /// @dev Build single-element call arrays and paint, funding exactly `cost`.
    function _paint(address user, uint256 pixelId, uint24 color, uint256 cost) internal {
        _fund(user, cost);
        uint256[] memory ids    = new uint256[](1);
        uint24[]  memory colors = new uint24[](1);
        ids[0]    = pixelId;
        colors[0] = color;
        vm.prank(user);
        game.paintPixels(ids, colors, cost);
    }

    /// @dev Warp to just after season end.
    function _warpPastEnd() internal {
        (, , bool active) = game.getSeason();
        require(active, "season already ended");
        (uint256 endTime, , ) = game.getSeason();
        vm.warp(endTime + 1);
    }
}
