// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract PixelWar is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Pixel {
        address owner;
        uint24 color;
        uint128 price;
    }

    struct Season {
        uint256 endTime;
        uint256 prizePool;
        bool active;
    }

    uint256 public constant GRID_SIZE = 10_000;
    uint256 public constant BASE_PRICE = 50_000; // 0.05 USDC (6 decimals)
    uint256 public constant MAX_PRICE = type(uint128).max;
    uint256 public constant MAX_BATCH = 50;
    address public constant USDC_TOKEN = 0x3600000000000000000000000000000000000000;

    Pixel[GRID_SIZE] private _pixels;
    Season private _season;

    mapping(address => uint256) private _pixelCount;
    mapping(address => uint256) private _earnings;
    mapping(address => uint256) private _pendingWithdrawals;

    // Approximate top-10 leaderboard by pixel count. Intentionally persists across seasons.
    address[10] private _leaderboard;
    uint256 private _leaderboardSize;

    // Tracks every address that has ever owned at least one pixel.
    address[] private _allOwners;
    mapping(address => bool) private _isKnownOwner;

    event PixelPainted(
        uint256 indexed pixelId,
        address indexed newOwner,
        address indexed previousOwner,
        uint24 color,
        uint128 price,
        uint128 prizeContribution
    );
    event SeasonStarted(uint256 endTime);
    event SeasonEnded(address[3] winners, uint256[3] payouts);
    event SeasonEndTimeUpdated(uint256 newEndTime);

    error InvalidArrayLengths();
    error BatchTooLarge();
    error InvalidPixelId();
    error SeasonInactive();
    error SeasonAlreadyEnded();
    error SeasonAlreadyActive();
    error SeasonNotYetEnded();
    error InsufficientApproved(uint256 required, uint256 approved);
    error InvalidEndTime();
    error ZeroAddressWinner();
    error DuplicateWinner();
    error InvalidWinnerRanking();
    error WinnerHasNoPixels();
    error InsufficientPlayers();
    error PendingWithdrawalZero();
    error PriceOverflow();

    constructor(address initialOwner, uint256 seasonEndTime) Ownable(initialOwner) {
        if (seasonEndTime <= block.timestamp) revert InvalidEndTime();

        _season = Season({endTime: seasonEndTime, prizePool: 0, active: true});
        emit SeasonStarted(seasonEndTime);
    }

    function paintPixels(
        uint256[] calldata pixelIds,
        uint24[] calldata colors,
        uint256 totalApproved
    ) external nonReentrant {
        uint256 length = pixelIds.length;

        if (length != colors.length) revert InvalidArrayLengths();
        if (length > MAX_BATCH) revert BatchTooLarge();
        if (!_season.active) revert SeasonInactive();
        if (block.timestamp >= _season.endTime) revert SeasonAlreadyEnded();

        // Per-operation data captured during simulation pass.
        address[] memory previousOwners = new address[](length);
        uint256[] memory costs = new uint256[](length);
        uint256[] memory payouts = new uint256[](length);
        uint256[] memory prizeContributions = new uint256[](length);

        // Simulated state for touched pixels to correctly handle duplicate pixelIds in one batch.
        uint256[] memory touchedIds = new uint256[](length);
        address[] memory simulatedOwners = new address[](length);
        uint128[] memory simulatedPrices = new uint128[](length);
        uint256 touchedCount;

        uint256 totalCost;

        // Pass 1: validate and simulate full batch to compute exact total cost.
        for (uint256 i = 0; i < length; ++i) {
            uint256 pixelId = pixelIds[i];
            if (pixelId >= GRID_SIZE) revert InvalidPixelId();

            (bool found, uint256 idx) = _findTouched(touchedIds, touchedCount, pixelId);

            address currentOwner;
            uint128 currentPrice;
            if (found) {
                currentOwner = simulatedOwners[idx];
                currentPrice = simulatedPrices[idx];
            } else {
                Pixel storage px = _pixels[pixelId];
                currentOwner = px.owner;
                currentPrice = px.price;
            }

            if (currentOwner == address(0)) {
                costs[i] = BASE_PRICE;
                previousOwners[i] = address(0);
                payouts[i] = 0;
                prizeContributions[i] = 0;

                currentOwner = msg.sender;
                currentPrice = uint128(BASE_PRICE);
            } else {
                uint256 oldPrice = uint256(currentPrice);
                if (oldPrice > MAX_PRICE / 2) revert PriceOverflow();
                uint256 cost = oldPrice * 2;
                // prizeContribution = floor(oldPrice / 2); payout = cost - prizeContribution
                // This ensures exact conservation: payout + prizeContribution == cost always.
                uint256 prizeContribution = oldPrice / 2;
                uint256 payout = cost - prizeContribution;

                costs[i] = cost;
                previousOwners[i] = currentOwner;
                payouts[i] = payout;
                prizeContributions[i] = prizeContribution;

                currentOwner = msg.sender;
                currentPrice = uint128(cost);
            }

            totalCost += costs[i];

            if (found) {
                simulatedOwners[idx] = currentOwner;
                simulatedPrices[idx] = currentPrice;
            } else {
                touchedIds[touchedCount] = pixelId;
                simulatedOwners[touchedCount] = currentOwner;
                simulatedPrices[touchedCount] = currentPrice;
                unchecked {
                    ++touchedCount;
                }
            }
        }

        if (totalApproved < totalCost) {
            revert InsufficientApproved(totalCost, totalApproved);
        }

        // Pass 2: effects (state updates only).
        for (uint256 i = 0; i < length; ++i) {
            uint256 pixelId = pixelIds[i];
            address previousOwner = previousOwners[i];
            uint256 cost = costs[i];
            uint256 payout = payouts[i];
            uint256 prizeContribution = prizeContributions[i];

            Pixel storage px = _pixels[pixelId];

            if (!_isKnownOwner[msg.sender]) {
                _isKnownOwner[msg.sender] = true;
                _allOwners.push(msg.sender);
            }

            if (previousOwner == address(0)) {
                // Transition from unclaimed to msg.sender.
                _pixelCount[msg.sender] += 1;
            } else {
                if (previousOwner != msg.sender) {
                    _pixelCount[previousOwner] -= 1;
                    _pixelCount[msg.sender] += 1;
                }

                _pendingWithdrawals[previousOwner] += payout;
                _earnings[previousOwner] += payout;
                _season.prizePool += prizeContribution;
            }

            px.owner = msg.sender;
            px.color = colors[i];
            px.price = uint128(cost);

            _updateLeaderboard(msg.sender);
            _updateLeaderboard(previousOwner);

            emit PixelPainted(
                pixelId,
                msg.sender,
                previousOwner,
                colors[i],
                uint128(cost),
                uint128(prizeContribution)
            );
        }

        // Interactions after all state updates.
        IERC20 usdc = IERC20(USDC_TOKEN);
        usdc.safeTransferFrom(msg.sender, address(this), totalCost);
    }

    function endSeason() external nonReentrant {
        if (!_season.active) revert SeasonInactive();
        if (block.timestamp < _season.endTime) revert SeasonNotYetEnded();

        // The leaderboard tracks top-10 most active players.
        // Only players who have been in the top-10 at some point during the season are prize-eligible.
        _sortLeaderboard();

        uint256 size = _leaderboardSize;
        if (size < 3) revert InsufficientPlayers();

        address[3] memory winners;
        uint256 winnersFound;

        for (uint256 i = 0; i < size && winnersFound < 3; ++i) {
            address owner = _leaderboard[i];
            if (owner == address(0)) continue;
            if (_pixelCount[owner] == 0) continue;

            winners[winnersFound] = owner;
            unchecked {
                ++winnersFound;
            }
        }

        if (winnersFound < 3) revert InsufficientPlayers();

        uint256 pool = _season.prizePool;

        _season.active = false;
        _season.prizePool = 0;

        uint256[3] memory payouts;

        if (pool > 0) {
            payouts[0] = (pool * 50) / 100;
            payouts[1] = (pool * 30) / 100;
            payouts[2] = pool - payouts[0] - payouts[1];

            _pendingWithdrawals[winners[0]] += payouts[0];
            _pendingWithdrawals[winners[1]] += payouts[1];
            _pendingWithdrawals[winners[2]] += payouts[2];
        }

        emit SeasonEnded(winners, payouts);
    }

    function startSeason(uint256 endTime) external onlyOwner {
        if (_season.active) revert SeasonAlreadyActive();
        if (endTime <= block.timestamp) revert InvalidEndTime();

        // Pixel ownership, prices, and _pixelCount intentionally persist across seasons by game design.
        _season.endTime = endTime;
        _season.prizePool = 0;
        _season.active = true;

        emit SeasonStarted(endTime);
    }

    function setSeasonEndTime(uint256 newEndTime) external onlyOwner {
        if (!_season.active) revert SeasonInactive();
        if (newEndTime <= block.timestamp) revert InvalidEndTime();

        _season.endTime = newEndTime;
        emit SeasonEndTimeUpdated(newEndTime);
    }

    function claimEarnings() external nonReentrant {
        uint256 amount = _pendingWithdrawals[msg.sender];
        if (amount == 0) revert PendingWithdrawalZero();

        _pendingWithdrawals[msg.sender] = 0;
        IERC20(USDC_TOKEN).safeTransfer(msg.sender, amount);
    }

    function getPixel(uint256 pixelId) external view returns (address owner, uint24 color, uint128 price) {
        if (pixelId >= GRID_SIZE) revert InvalidPixelId();
        Pixel storage px = _pixels[pixelId];
        return (px.owner, px.color, px.price);
    }

    function getPixels(uint256[] calldata pixelIds) external view returns (Pixel[] memory pixelData) {
        uint256 length = pixelIds.length;
        pixelData = new Pixel[](length);

        for (uint256 i = 0; i < length; ++i) {
            uint256 pixelId = pixelIds[i];
            if (pixelId >= GRID_SIZE) revert InvalidPixelId();
            pixelData[i] = _pixels[pixelId];
        }
    }

    function getSeason() external view returns (uint256 endTime, uint256 prizePool, bool active) {
        return (_season.endTime, _season.prizePool, _season.active);
    }

    function getPixelCount(address user) external view returns (uint256) {
        return _pixelCount[user];
    }

    function getEarnings(address user) external view returns (uint256) {
        return _earnings[user];
    }

    function getPendingWithdrawal(address user) external view returns (uint256) {
        return _pendingWithdrawals[user];
    }

    function getAllOwnersCount() external view returns (uint256) {
        return _allOwners.length;
    }

    function _findTouched(
        uint256[] memory touchedIds,
        uint256 touchedCount,
        uint256 target
    ) private pure returns (bool found, uint256 index) {
        for (uint256 i = 0; i < touchedCount; ++i) {
            if (touchedIds[i] == target) {
                return (true, i);
            }
        }
        return (false, 0);
    }

    function _sortLeaderboard() private {
        uint256 size = _leaderboardSize;

        for (uint256 i = 1; i < size; ++i) {
            address key = _leaderboard[i];
            uint256 keyScore = _pixelCount[key];
            uint256 j = i;

            while (j > 0 && keyScore > _pixelCount[_leaderboard[j - 1]]) {
                _leaderboard[j] = _leaderboard[j - 1];
                unchecked {
                    --j;
                }
            }

            _leaderboard[j] = key;
        }
    }

    function _updateLeaderboard(address addr) private {
        if (addr == address(0)) return;

        uint256 score = _pixelCount[addr];
        uint256 size = _leaderboardSize;
        uint256 idx = type(uint256).max;

        for (uint256 i = 0; i < size; ++i) {
            if (_leaderboard[i] == addr) {
                idx = i;
                break;
            }
        }

        if (idx != type(uint256).max) {
            if (score == 0) {
                for (uint256 i = idx; i + 1 < size; ++i) {
                    _leaderboard[i] = _leaderboard[i + 1];
                }
                _leaderboard[size - 1] = address(0);
                _leaderboardSize = size - 1;
                return;
            }

            while (idx > 0 && score > _pixelCount[_leaderboard[idx - 1]]) {
                address tmp = _leaderboard[idx - 1];
                _leaderboard[idx - 1] = _leaderboard[idx];
                _leaderboard[idx] = tmp;
                unchecked {
                    --idx;
                }
            }

            while (idx + 1 < _leaderboardSize && _pixelCount[_leaderboard[idx]] < _pixelCount[_leaderboard[idx + 1]]) {
                address tmp = _leaderboard[idx + 1];
                _leaderboard[idx + 1] = _leaderboard[idx];
                _leaderboard[idx] = tmp;
                unchecked {
                    ++idx;
                }
            }

            return;
        }

        if (score == 0) return;

        if (size < 10) {
            _leaderboard[size] = addr;
            _leaderboardSize = size + 1;
            idx = size;

            while (idx > 0 && score > _pixelCount[_leaderboard[idx - 1]]) {
                address tmp = _leaderboard[idx - 1];
                _leaderboard[idx - 1] = _leaderboard[idx];
                _leaderboard[idx] = tmp;
                unchecked {
                    --idx;
                }
            }

            return;
        }

        if (score <= _pixelCount[_leaderboard[9]]) return;

        _leaderboard[9] = addr;
        idx = 9;

        while (idx > 0 && score > _pixelCount[_leaderboard[idx - 1]]) {
            address tmp = _leaderboard[idx - 1];
            _leaderboard[idx - 1] = _leaderboard[idx];
            _leaderboard[idx] = tmp;
            unchecked {
                --idx;
            }
        }
    }
}
