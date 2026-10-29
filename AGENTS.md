# PixelWar — Agent Notes

## Deployed Contracts

| Network | Address | Explorer |
|---|---|---|
| Arc Testnet | `0xf6b7e56b1b440262cf77098aff39abad7c537cf5` | https://explorer.testnet.arc.io/address/0xf6b7e56b1b440262cf77098aff39abad7c537cf5 |

## Key Details
- Season 1 end: Unix 1795794160 (Nov 27 2026, 30 days from deploy)
- USDC: `0x3600000000000000000000000000000000000000` (6 dec ERC-20 / 18 dec native — same asset)
- BASE_PRICE: 50000 (0.05 USDC)
- Grid: 100x100 = 10,000 pixels
- Owner: `0x5B12Ce46C7194aD57d143bC22847224047b1Ef42` (platform deployer — testnet only)

## Mainnet Deploy (pending)
- Deployer wallet created: `0x17a947d85a057bb408fea414fb5b66b4458180c5`
- Wallet ID: `2598520e-e024-5c1d-9896-c3f746d4b330`
- Fund with ~2 USDC on Arc mainnet, then run:
  `bun run compass:deploy PixelWar '["$DEPLOYER","<timestamp>"]' --mode verify --blockchain ARC --compass-chain Arc --rpc https://rpc.mainnet.arc.io`
  then `--mode live ... --wallet-id 2598520e-e024-5c1d-9896-c3f746d4b330 --wallet-address 0x17a947d85a057bb408fea414fb5b66b4458180c5 --skip-funding`
- Use live Circle API key (Production environment in Circle Console)
- Entity secret registered for live env (new secret, backed up by user Oct 28 2026)

## Design Decisions
- Pull-payment: pixel repaint earnings go to _pendingWithdrawals, claimed via claimEarnings()
- On-chain leaderboard[10] maintained per-paint; endSeason uses _sortLeaderboard() O(10) to pay top-3
- Season prizes use pull-payment (credited to _pendingWithdrawals of top-3 winners)
- Price doubling capped at MAX_PRICE (type(uint128).max) via PriceOverflow error
- via_ir=true in foundry.toml (required to avoid stack-too-deep)
- Frontend: Arc Dark theme, Canvas API pixel grid, wagmi reads via getPixels() batched in CHUNK=200

## Frontend Files
- `src/App.tsx` — top-level layout, pixel loading, canvas + sidebar
- `src/abi.ts` — contract address, ABI, USDC address, explorer base
- `src/components/PixelCanvas.tsx` — Canvas API grid with zoom/pan, click to select
- `src/components/PaintSidebar.tsx` — color picker, selection summary, approve + paint flow
- `src/components/SeasonPanel.tsx` — season countdown, prize pool, claim earnings, end season
