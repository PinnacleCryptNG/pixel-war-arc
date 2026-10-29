# PixelWar — Paint the Chain

> A fully onchain multiplayer pixel art game on [Arc](https://arc.io). Every pixel on a shared 100×100 canvas is owned on the blockchain. Paint pixels with USDC, steal rivals' territory, and hold the most pixels at season end to win the prize pool.

Built with [Arc Studio](https://studio.arc.io)

---

## What is PixelWar?

PixelWar is a competitive territory game where **every pixel is real money**:

- The canvas is 100×100 = **10,000 pixels**, all stored on the Arc blockchain
- Each unclaimed pixel costs **0.05 USDC** to own
- If you want a pixel someone else already owns, you can **steal it for 2× its current price**
  - The previous owner gets **half** the steal price back as earnings
  - The other half goes into the **season prize pool**
- At the end of Season 1, the **top 3 pixel holders** split the prize pool: **50% / 30% / 20%**

**Can I play alone?** Yes. You don't need other players to start. Paint unclaimed pixels, build your territory, and earn passive income when others try to steal. The more you hold at season end, the bigger your reward.

---

## Live Deployment

| Network | Contract Address | Explorer |
|---|---|---|
| Arc Testnet | `0xf6b7e56b1b440262cf77098aff39abad7c537cf5` | [View on Explorer](https://explorer.testnet.arc.io/address/0xf6b7e56b1b440262cf77098aff39abad7c537cf5) |

**Season 1 ends:** November 27, 2026

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript + Vite |
| Wallet | wagmi v2 + ConnectKit |
| Blockchain client | viem |
| Smart contract | Solidity 0.8 + OpenZeppelin |
| Chain | Arc Testnet (USDC as native gas) |
| Package manager | Bun |

---

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) 1.0+
- A wallet: MetaMask, Coinbase Wallet, or any injected browser wallet
- Arc Testnet USDC — use the **"Get test USDC"** button inside Arc Studio, or visit [faucet.circle.com](https://faucet.circle.com)

### Install

```bash
bun install
```

### Run locally

```bash
bun run dev
```

Open [http://localhost:5173](http://localhost:5173) — the app will prompt your wallet to switch to Arc Testnet automatically.

### Build for production

```bash
bun run build
```

Output goes to `dist/`.

### Run contract tests

```bash
cd contracts && forge test
```

All 77 tests should pass.

---

## Environment Variables

The frontend reads no secret variables — all onchain interactions happen via the user's own connected wallet.

The following variables are used only during **contract deployment** (not needed to run the frontend):

| Variable | Purpose | Required for |
|---|---|---|
| `CIRCLE_API_KEY` | Circle Developer API key | Mainnet contract deploy |
| `CIRCLE_ENTITY_SECRET` | Circle entity secret (registered once per account) | Mainnet contract deploy |
| `RPC_PROXY_BASE_URL` | Arc Studio RPC proxy base URL | Arc Studio only (optional outside Studio) |
| `RPC_PROXY_TOKEN` | Arc Studio RPC proxy token | Arc Studio only (optional outside Studio) |
| `RPC_PROXY_CHAINS` | Comma-separated chain keys for the proxy | Arc Studio only (optional outside Studio) |

> The `RPC_PROXY_*` variables are injected automatically inside Arc Studio and are not needed when running locally or deploying to Vercel/Netlify.

---

## How to Play

1. **Connect wallet** — click "Connect Wallet" and approve the Arc Testnet network switch
2. **Pick a color** — choose from the 20-color palette or use the custom color picker
3. **Select pixels** — tap (mobile) or click (desktop) any pixel on the canvas to select it; select multiple at once
4. **Approve USDC** — one-time approval per session; covers 10× the current cost so you don't re-approve each time
5. **Paint** — confirm the transaction; your pixels appear on the canvas within seconds
6. **Steal** — click an owned pixel to see its current price; pay 2× to steal it and earn when others steal it back
7. **Claim earnings** — open the Season tab; your accumulated earnings are claimable any time

---

## Project Structure

```
├── contracts/
│   ├── PixelWar.sol          # Main game contract
│   ├── test/                 # Foundry unit tests (77 tests)
│   └── script/               # Deployment scripts
├── src/
│   ├── App.tsx               # Root layout (responsive desktop/mobile)
│   ├── abi.ts                # Contract address, ABI, USDC address
│   ├── config.ts             # wagmi config (Arc Testnet + connectors)
│   ├── onchain-facts.ts      # Chain IDs, RPC URLs, token addresses
│   ├── onchain-money.ts      # USDC amount helpers
│   └── components/
│       ├── LandingPage.tsx   # Hero, how-to-play, rules
│       ├── PixelCanvas.tsx   # Canvas API grid — zoom, pan, touch, click
│       ├── PaintSidebar.tsx  # Color picker, approve + paint flow
│       └── SeasonPanel.tsx   # Countdown, prize pool, claim earnings
├── foundry.toml              # Foundry config (via_ir = true)
└── README.md
```

---

## Contract: PixelWar.sol

### Key mechanics

| Function | What it does |
|---|---|
| `paintPixels(ids, colors, maxCost)` | Paint or steal one or more pixels in a single transaction |
| `claimEarnings()` | Withdraw accumulated steal earnings + prize winnings to your wallet |
| `endSeason()` | Callable by anyone once the season timer expires; distributes prizes to top 3 |
| `getSeason()` | Returns `(endTime, prizePool, active)` |
| `getPixels(ids)` | Batch-read pixel state (owner, color, price) |
| `getPendingWithdrawal(addr)` | Check how much USDC a player can claim |

### Security

- Audited at **max severity** with 4 rounds of fixes
- Pull-payment model (no auto-transfer on steal — earnings accumulate and are claimed explicitly)
- `ReentrancyGuard` on all state-changing functions
- `SafeERC20` for all USDC transfers
- Price doubling capped at `type(uint128).max` to prevent overflow
- No owner withdrawal of player funds

---

## Deploying to Mainnet

> ⚠️ Mainnet involves real funds. Deploy only after thorough testing on testnet.

1. Register a Circle entity secret against your **live** Circle API key
2. Fund the deployer wallet with ~2 USDC on Arc Mainnet
3. Update `src/abi.ts` with the new mainnet contract address
4. Deploy:

```bash
bun run compass:deploy PixelWar '["<OWNER_ADDRESS>","<SEASON_END_UNIX>"]' \
  --mode live \
  --blockchain ARC \
  --compass-chain Arc \
  --rpc https://rpc.mainnet.arc.io \
  --wallet-id <YOUR_WALLET_ID> \
  --wallet-address <YOUR_WALLET_ADDRESS> \
  --skip-funding
```

---

## License

MIT
