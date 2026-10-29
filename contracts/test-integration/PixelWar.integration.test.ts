/**
 * PixelWar pre-deploy fork verification test.
 *
 * Runs against an anvil fork at forkRpcUrl with the predicted contract address.
 * Every sender is obtained via anvil_impersonateAccount + anvil_setBalance.
 *
 * Arc-specific note: The live Arc USDC at 0x3600... uses a native precompile
 * (0x1800...0000) for balance transfers, which is not available on the anvil fork.
 * We replace the USDC code with a minimal EVM-only ERC20 mock so all token
 * interactions run against pure EVM storage — this is a valid pre-deploy
 * verification technique since we're testing PixelWar's logic, not Arc's USDC impl.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
  defineChain,
} from "viem";

// ─── Configuration ────────────────────────────────────────────────────────────
const FORK_RPC_URL     = "http://127.0.0.1:37687";
const CONTRACT_ADDRESS = "0xDcA8948a0E21a179535f2A3BaEE3c6c22FE5f452" as const;
const DEPLOYER_ADDRESS = "0xBf047065a37C5D6F746322953F1731768Fa0eCb5" as const;
const USDC_ADDRESS     = "0x3600000000000000000000000000000000000000" as const;

// Test wallets (impersonated on anvil — no private keys needed)
const PAINTER1 = "0x1111111111111111111111111111111111111111" as const;
const PAINTER2 = "0x2222222222222222222222222222222222222222" as const;
const PAINTER3 = "0x3333333333333333333333333333333333333333" as const;

/**
 * Deployed bytecode of a minimal ERC20 mock (compiled from MockERC20.sol with solc 0.8.24).
 * Implements balanceOf, approve, transfer, transferFrom, allowance purely in EVM storage.
 * Storage layout: balanceOf → slot 0 mapping, allowance → slot 1 mapping.
 */
const MOCK_ERC20_BYTECODE =
  "0x608060405234801561000f575f80fd5b5060043610610055575f3560e01c8063095ea7b31461005957806323b872dd1461008957806370a08231146100b9578063a9059cbb146100e9578063dd62ed3e14610119575b5f80fd5b610073600480360381019061006e919061063c565b610149565b6040516100809190610694565b60405180910390f35b6100a3600480360381019061009e91906106ad565b6101d1565b6040516100b09190610694565b60405180910390f35b6100d360048036038101906100ce91906106fd565b610449565b6040516100e09190610737565b60405180910390f35b61010360048036038101906100fe919061063c565b61045d565b6040516101109190610694565b60405180910390f35b610133600480360381019061012e9190610750565b61058b565b6040516101409190610737565b60405180910390f35b5f8160015f3373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f205f8573ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f20819055506001905092915050565b5f815f808673ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f20541015610251576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401610248906107e8565b60405180910390fd5b8160015f8673ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f205f3373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f2054101561030c576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040161030390610850565b60405180910390fd5b8160015f8673ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f205f3373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f205f828254610393919061089b565b92505081905550815f808673ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f205f8282546103e5919061089b565b92505081905550815f808573ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f205f82825461043791906108ce565b92505081905550600190509392505050565b5f602052805f5260405f205f915090505481565b5f815f803373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f205410156104dd576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016104d49061094b565b60405180910390fd5b815f803373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f205f828254610528919061089b565b92505081905550815f808573ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f205f82825461057a91906108ce565b925050819055506001905092915050565b6001602052815f5260405f20602052805f5260405f205f91509150505481565b5f80fd5b5f73ffffffffffffffffffffffffffffffffffffffff82169050919050565b5f6105d8826105af565b9050919050565b6105e8816105ce565b81146105f2575f80fd5b50565b5f81359050610603816105df565b92915050565b5f819050919050565b61061b81610609565b8114610625575f80fd5b50565b5f8135905061063681610612565b92915050565b5f8060408385031215610652576106516105ab565b5b5f61065f858286016105f5565b925050602061067085828601610628565b9150509250929050565b5f8115159050919050565b61068e8161067a565b82525050565b5f6020820190506106a75f830184610685565b92915050565b5f805f606084860312156106c4576106c36105ab565b5b5f6106d1868287016105f5565b93505060206106e2868287016105f5565b92505060406106f386828701610628565b9150509250925092565b5f60208284031215610712576107116105ab565b5b5f61071f848285016105f5565b91505092915050565b61073181610609565b82525050565b5f60208201905061074a5f830184610728565b92915050565b5f8060408385031215610766576107656105ab565b5b5f610773858286016105f5565b9250506020610784858286016105f5565b9150509250929050565b5f82825260208201905092915050565b7f696e73756666696369656e742062616c616e63650000000000000000000000005f82015250565b5f6107d260148361078e565b91506107dd8261079e565b602082019050919050565b5f6020820190508181035f8301526107ff816107c6565b9050919050565b7f696e73756666696369656e7420616c6c6f77616e6365000000000000000000005f82015250565b5f61083a60168361078e565b915061084582610806565b602082019050919050565b5f6020820190508181035f8301526108678161082e565b9050919050565b7f4e487b71000000000000000000000000000000000000000000000000000000005f52601160045260245ffd5b5f6108a582610609565b91506108b083610609565b92508282039050818111156108c8576108c761086e565b5b92915050565b5f6108d882610609565b91506108e383610609565b92508282019050808211156108fb576108fa61086e565b5b92915050565b7f696e73756666696369656e7400000000000000000000000000000000000000005f82015250565b5f610935600c8361078e565b915061094082610901565b602082019050919050565b5f6020820190508181035f83015261096281610929565b905091905056fea2646970667358221220a06b70c7ba155b000ad4aefb65256ea0e1f89a685929004bcd9576d2312026fe64736f6c63430008180033";

// ─── ABI ──────────────────────────────────────────────────────────────────────
const ABI = [
  { name: "getSeason",            type: "function", stateMutability: "view",       inputs: [],                                                           outputs: [{ name: "endTime", type: "uint256" }, { name: "prizePool", type: "uint256" }, { name: "active", type: "bool" }] },
  { name: "getPixel",             type: "function", stateMutability: "view",       inputs: [{ name: "pixelId", type: "uint256" }],                        outputs: [{ name: "owner", type: "address" }, { name: "color", type: "uint24" }, { name: "price", type: "uint128" }] },
  { name: "getPixelCount",        type: "function", stateMutability: "view",       inputs: [{ name: "user", type: "address" }],                           outputs: [{ name: "", type: "uint256" }] },
  { name: "getPendingWithdrawal", type: "function", stateMutability: "view",       inputs: [{ name: "user", type: "address" }],                           outputs: [{ name: "", type: "uint256" }] },
  { name: "owner",                type: "function", stateMutability: "view",       inputs: [],                                                           outputs: [{ name: "", type: "address" }] },
  { name: "paintPixels",         type: "function", stateMutability: "nonpayable", inputs: [{ name: "pixelIds", type: "uint256[]" }, { name: "colors", type: "uint24[]" }, { name: "totalApproved", type: "uint256" }], outputs: [] },
  { name: "claimEarnings",       type: "function", stateMutability: "nonpayable", inputs: [],                                                           outputs: [] },
  { name: "setSeasonEndTime",    type: "function", stateMutability: "nonpayable", inputs: [{ name: "newEndTime", type: "uint256" }],                    outputs: [] },
  { name: "endSeason",           type: "function", stateMutability: "nonpayable", inputs: [],                                                           outputs: [] },
  { name: "startSeason",         type: "function", stateMutability: "nonpayable", inputs: [{ name: "endTime", type: "uint256" }],                       outputs: [] },
] as const;

const ERC20_ABI = [
  { name: "balanceOf",   type: "function", stateMutability: "view",       inputs: [{ name: "account", type: "address" }],                                                    outputs: [{ name: "", type: "uint256" }] },
  { name: "approve",     type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],               outputs: [{ name: "", type: "bool" }] },
  { name: "allowance",   type: "function", stateMutability: "view",       inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],               outputs: [{ name: "", type: "uint256" }] },
] as const;

// ─── Arc fork chain definition (chainId from actual fork) ─────────────────────
const arcFork = defineChain({
  id: 5042,
  name: "Arc Fork",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [FORK_RPC_URL] } },
});

// ─── Clients ──────────────────────────────────────────────────────────────────
const publicClient = createPublicClient({ chain: arcFork, transport: http(FORK_RPC_URL) });

function walletClient(account: string) {
  return createWalletClient({
    account: account as `0x${string}`,
    chain: arcFork,
    transport: http(FORK_RPC_URL),
  });
}

// ─── Result tracking ──────────────────────────────────────────────────────────
interface TestResult {
  testName: string;
  status: "PASS" | "FAIL" | "SKIPPED";
  detail?: string;
  durationMs: number;
}

const results: TestResult[] = [];

function log(r: TestResult) {
  console.log(JSON.stringify(r));
  results.push(r);
}

// ─── RPC helpers ──────────────────────────────────────────────────────────────
async function rpc(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(FORK_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (json.error) throw new Error(`RPC ${method} failed: ${json.error.message}`);
  return json.result;
}

async function impersonate(addr: string) {
  await rpc("anvil_impersonateAccount", [addr]);
  // Fund with 100 USDC (18-dec native) for gas on Arc fork
  await rpc("anvil_setBalance", [addr, "0x" + (100n * 10n ** 18n).toString(16)]);
}

/**
 * Compute the EVM storage slot for balanceOf[account] in the MockERC20.
 * Slot 0 is the balanceOf mapping: slot = keccak256(abi.encode(account, 0)).
 */
function balanceSlot(account: string): `0x${string}` {
  return keccak256(encodeAbiParameters(parseAbiParameters("address, uint256"), [account as `0x${string}`, 0n]));
}

/**
 * Compute the EVM storage slot for allowance[owner][spender] in the MockERC20.
 * Slot 1 is the allowance mapping: slot = keccak256(spender ++ keccak256(owner ++ 1)).
 */
function allowanceSlot(owner: string, spender: string): `0x${string}` {
  const innerSlot = keccak256(encodeAbiParameters(parseAbiParameters("address, uint256"), [owner as `0x${string}`, 1n]));
  return keccak256(encodeAbiParameters(parseAbiParameters("address, bytes32"), [spender as `0x${string}`, innerSlot]));
}

function toUint256Hex(value: bigint): string {
  return "0x" + value.toString(16).padStart(64, "0");
}

/** Write USDC balance (6 dec) directly into the mock ERC20's storage. */
async function setUsdcBalance(account: string, amount: bigint) {
  const slot = balanceSlot(account);
  await rpc("anvil_setStorageAt", [USDC_ADDRESS, slot, toUint256Hex(amount)]);
}

/** Write USDC allowance directly into the mock ERC20's storage. */
async function setUsdcAllowance(owner: string, spender: string, amount: bigint) {
  const slot = allowanceSlot(owner, spender);
  await rpc("anvil_setStorageAt", [USDC_ADDRESS, slot, toUint256Hex(amount)]);
}

async function getUsdcBalance(account: string): Promise<bigint> {
  return publicClient.readContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account as `0x${string}`],
  }) as Promise<bigint>;
}

async function sendTx(from: string, to: string, data: `0x${string}`): Promise<`0x${string}`> {
  const wc = walletClient(from);
  const hash = await wc.sendTransaction({
    to: to as `0x${string}`,
    data,
    gas: 800_000n,
    maxFeePerGas: 0n,
    maxPriorityFeePerGas: 0n,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`Tx reverted: ${hash}`);
  return hash;
}

async function readSeason(): Promise<readonly [bigint, bigint, boolean]> {
  return publicClient.readContract({ address: CONTRACT_ADDRESS, abi: ABI, functionName: "getSeason" }) as Promise<readonly [bigint, bigint, boolean]>;
}

async function readPixel(pixelId: bigint): Promise<readonly [string, number, bigint]> {
  return publicClient.readContract({ address: CONTRACT_ADDRESS, abi: ABI, functionName: "getPixel", args: [pixelId] }) as Promise<readonly [string, number, bigint]>;
}

async function readPixelCount(user: string): Promise<bigint> {
  return publicClient.readContract({ address: CONTRACT_ADDRESS, abi: ABI, functionName: "getPixelCount", args: [user as `0x${string}`] }) as Promise<bigint>;
}

async function readPendingWithdrawal(user: string): Promise<bigint> {
  return publicClient.readContract({ address: CONTRACT_ADDRESS, abi: ABI, functionName: "getPendingWithdrawal", args: [user as `0x${string}`] }) as Promise<bigint>;
}

async function paintPixels(from: string, pixelIds: bigint[], colors: number[], totalApproved: bigint): Promise<`0x${string}`> {
  const data = encodeFunctionData({ abi: ABI, functionName: "paintPixels", args: [pixelIds, colors, totalApproved] });
  return sendTx(from, CONTRACT_ADDRESS, data);
}

// ─── Pre-approve helper: write allowance to mock ERC20 storage ────────────────
async function fundAndApprove(account: string, fundAmount: bigint) {
  await setUsdcBalance(account, fundAmount);
  // Approve via storage write (more reliable than tx since mock is freshly deployed)
  await setUsdcAllowance(account, CONTRACT_ADDRESS, fundAmount);
}

// ─── Setup ────────────────────────────────────────────────────────────────────
// ─── Storage slot constants (from forge inspect storage-layout) ──────────────
const SEASON_ENDTIME_SLOT   = "0x0000000000000000000000000000000000000000000000000000000000004e21"; // 20001
const SEASON_PRIZEPOOL_SLOT = "0x0000000000000000000000000000000000000000000000000000000000004e22"; // 20002
const SEASON_ACTIVE_SLOT    = "0x0000000000000000000000000000000000000000000000000000000000004e23"; // 20003
const LEADERBOARD_SIZE_SLOT = "0x0000000000000000000000000000000000000000000000000000000000004e31"; // 20017
const ALL_OWNERS_LEN_SLOT   = "0x0000000000000000000000000000000000000000000000000000000000004e32"; // 20018
const ZERO32 = "0x0000000000000000000000000000000000000000000000000000000000000000";

// Pre-computed pixel storage slots (pixel i: owner+color at 1+2i, price at 2+2i)
const PIXEL_SLOTS: [string, string][] = [
  ["0x0000000000000000000000000000000000000000000000000000000000000001", "0x0000000000000000000000000000000000000000000000000000000000000002"], // pixel 0
  ["0x0000000000000000000000000000000000000000000000000000000000000003", "0x0000000000000000000000000000000000000000000000000000000000000004"], // pixel 1
  ["0x0000000000000000000000000000000000000000000000000000000000000005", "0x0000000000000000000000000000000000000000000000000000000000000006"], // pixel 2
];
// Pre-computed mapping slots (keccak256(abi.encode(addr, slotIndex)))
const PIXEL_COUNT_SLOTS: Record<string, string> = {
  [PAINTER1]: "0x4f42cadbd197e15c8bbda82a4c84d6403f0c9b54b57d296af6ef73425f9f630a", // _pixelCount[painter1] (slot 20004)
  [PAINTER2]: "0xbc1add743410f816436e447fe32203a13f7d2ddfc4595e8749703740961499aa",
  [PAINTER3]: "0x07f64b45d39a451b1bcb3f685225bfb7487d66063da6a3475753f93c5bb2c14a",
  ["0x4444444444444444444444444444444444444444"]: "0xe37feadd18dc31fb6b35e8f7f82ecc572ac2a1e938a9f7d4e643ef287bc12063",
};
const PENDING_SLOTS: Record<string, string> = {
  [PAINTER1]: "0x33b0ce48495acb9e380578dc55dcd06de7d606584f5e84bf5cabe38af4441928", // _pendingWithdrawals[painter1] (slot 20006)
  [PAINTER2]: "0x0339c8f8b5128073b0bf0be0cd6dae1a2821feec160e9444c3ab0b4703bc540a",
  [PAINTER3]: "0x35d9b13aaf42b455b03c561e0e155a3687635180df09461814c4479c390f4356",
  ["0x4444444444444444444444444444444444444444"]: "0x14bc18eae7dc0f49b831523e603a6c5185f91c2fb583c6225f6cbe466038c3d6",
};
const IS_KNOWN_OWNER_SLOTS: Record<string, string> = {
  [PAINTER1]: "0xebf84801b5c86478ce0034530325586e9689bad598a2ec17aa8c5f0810160b52", // _isKnownOwner[painter1] (slot 20019)
  [PAINTER2]: "0x00c1694d65912a738af220a398de832eb1ac61fd0dbb1fdaa5ddeb589cef03a4",
  [PAINTER3]: "0xd3bcba6153b28019bcc7cbe9e88c9208c40fd1e06375a3e16ff9354bf85a766a",
  ["0x4444444444444444444444444444444444444444"]: "0xb5ba932ede855c875d6b3dc332ae96142c64f6456b91ca858013ca37afd49f63",
};
const LEADERBOARD_SLOTS = [
  "0x0000000000000000000000000000000000000000000000000000000000004e27", // _leaderboard[0]
  "0x0000000000000000000000000000000000000000000000000000000000004e28",
  "0x0000000000000000000000000000000000000000000000000000000000004e29",
  "0x0000000000000000000000000000000000000000000000000000000000004e2a",
  "0x0000000000000000000000000000000000000000000000000000000000004e2b",
  "0x0000000000000000000000000000000000000000000000000000000000004e2c",
  "0x0000000000000000000000000000000000000000000000000000000000004e2d",
  "0x0000000000000000000000000000000000000000000000000000000000004e2e",
  "0x0000000000000000000000000000000000000000000000000000000000004e2f",
  "0x0000000000000000000000000000000000000000000000000000000000004e30", // _leaderboard[9]
];

async function setup() {
  // Zero base fee so impersonated senders don't need gas in their native balance
  await rpc("anvil_setNextBlockBaseFeePerGas", ["0x0"]);
  await rpc("evm_mine", []);

  // Replace the Arc USDC proxy with a simple EVM ERC20 mock.
  await rpc("anvil_setCode", [USDC_ADDRESS, MOCK_ERC20_BYTECODE]);

  // ── Reset PixelWar contract state to clean initial values ──────────────────
  // Season state: endTime=original, prizePool=0, active=true
  const ORIGINAL_END_TIME = 1795794160n;
  await rpc("anvil_setStorageAt", [CONTRACT_ADDRESS, SEASON_ENDTIME_SLOT, toUint256Hex(ORIGINAL_END_TIME)]);
  await rpc("anvil_setStorageAt", [CONTRACT_ADDRESS, SEASON_PRIZEPOOL_SLOT, ZERO32]);
  await rpc("anvil_setStorageAt", [CONTRACT_ADDRESS, SEASON_ACTIVE_SLOT, toUint256Hex(1n)]);

  // Reset pixels 0, 1, 2 (owner+color and price slots)
  for (const [ownerSlot, priceSlot] of PIXEL_SLOTS) {
    await rpc("anvil_setStorageAt", [CONTRACT_ADDRESS, ownerSlot, ZERO32]);
    await rpc("anvil_setStorageAt", [CONTRACT_ADDRESS, priceSlot, ZERO32]);
  }

  // Reset pixelCount, pendingWithdrawals, isKnownOwner for all test painters
  for (const addr of [PAINTER1, PAINTER2, PAINTER3, "0x4444444444444444444444444444444444444444"]) {
    if (PIXEL_COUNT_SLOTS[addr])   await rpc("anvil_setStorageAt", [CONTRACT_ADDRESS, PIXEL_COUNT_SLOTS[addr], ZERO32]);
    if (PENDING_SLOTS[addr])       await rpc("anvil_setStorageAt", [CONTRACT_ADDRESS, PENDING_SLOTS[addr], ZERO32]);
    if (IS_KNOWN_OWNER_SLOTS[addr]) await rpc("anvil_setStorageAt", [CONTRACT_ADDRESS, IS_KNOWN_OWNER_SLOTS[addr], ZERO32]);
  }

  // Reset leaderboard
  for (const slot of LEADERBOARD_SLOTS) {
    await rpc("anvil_setStorageAt", [CONTRACT_ADDRESS, slot, ZERO32]);
  }
  await rpc("anvil_setStorageAt", [CONTRACT_ADDRESS, LEADERBOARD_SIZE_SLOT, ZERO32]);
  await rpc("anvil_setStorageAt", [CONTRACT_ADDRESS, ALL_OWNERS_LEN_SLOT, ZERO32]);

  // Reset USDC mock balances/allowances for the PixelWar contract address
  await setUsdcBalance(CONTRACT_ADDRESS, 0n);

  // Impersonate all actors
  await impersonate(DEPLOYER_ADDRESS);
  await impersonate(PAINTER1);
  await impersonate(PAINTER2);
  await impersonate(PAINTER3);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

async function test_getSeason() {
  const t0 = Date.now();
  try {
    const [endTime, prizePool, active] = await readSeason();
    const expectedEnd = 1795794160n;
    // Note: the fork may have had its seasonEndTime updated by a prior test run;
    // we accept the original OR any value set by setSeasonEndTime tests.
    if (endTime !== expectedEnd) {
      throw new Error(`endTime mismatch: got ${endTime}, want ${expectedEnd}`);
    }
    if (prizePool !== 0n)  throw new Error(`prizePool=${prizePool}, want 0`);
    if (!active)           throw new Error(`active=false, want true`);
    log({ testName: "getSeason()", status: "PASS", detail: `endTime=${endTime} prizePool=${prizePool} active=${active}`, durationMs: Date.now() - t0 });
  } catch (e: unknown) {
    log({ testName: "getSeason()", status: "FAIL", detail: String(e), durationMs: Date.now() - t0 });
  }
}

async function test_paintPixels_unclaimed(): Promise<boolean> {
  const t0 = Date.now();
  try {
    const FUND   = 1_000_000n; // 1 USDC (6 dec)
    const COST   = 50_000n;   // BASE_PRICE

    await fundAndApprove(PAINTER1, FUND);

    const hash = await paintPixels(PAINTER1, [0n], [0xFF0000], COST);
    log({ testName: "paintPixels — unclaimed pixel 0", status: "PASS", detail: `tx ${hash}`, durationMs: Date.now() - t0 });
    return true;
  } catch (e: unknown) {
    log({ testName: "paintPixels — unclaimed pixel 0", status: "FAIL", detail: String(e), durationMs: Date.now() - t0 });
    return false;
  }
}

async function test_getPixel_after_paint(expectedOwner: string) {
  const t0 = Date.now();
  try {
    const [owner, color, price] = await readPixel(0n);
    const colorNum = typeof color === "bigint" ? Number(color) : color;
    if (owner.toLowerCase() !== expectedOwner.toLowerCase()) throw new Error(`owner=${owner}, want ${expectedOwner}`);
    if (colorNum !== 0xFF0000) throw new Error(`color=0x${colorNum.toString(16)}, want 0xff0000`);
    if (price !== 50_000n)     throw new Error(`price=${price}, want 50000`);
    log({ testName: "getPixel(0) after paint", status: "PASS", detail: `owner=${owner} color=0x${colorNum.toString(16)} price=${price}`, durationMs: Date.now() - t0 });
  } catch (e: unknown) {
    log({ testName: "getPixel(0) after paint", status: "FAIL", detail: String(e), durationMs: Date.now() - t0 });
  }
}

async function test_getPixelCount(user: string, expected: bigint) {
  const t0 = Date.now();
  try {
    const count = await readPixelCount(user);
    if (count !== expected) throw new Error(`count=${count}, want ${expected}`);
    log({ testName: "getPixelCount(painter1)", status: "PASS", detail: `count=${count}`, durationMs: Date.now() - t0 });
  } catch (e: unknown) {
    log({ testName: "getPixelCount(painter1)", status: "FAIL", detail: String(e), durationMs: Date.now() - t0 });
  }
}

async function test_paintPixels_steal(): Promise<boolean> {
  const t0 = Date.now();
  try {
    // Steal pixel 0: cost = 2 * 50_000 = 100_000
    const STEAL_COST = 100_000n;
    const FUND       = 1_000_000n;

    await fundAndApprove(PAINTER2, FUND);

    const prevPending = await readPendingWithdrawal(PAINTER1);

    const hash = await paintPixels(PAINTER2, [0n], [0x00FF00], STEAL_COST);

    const newPending = await readPendingWithdrawal(PAINTER1);
    // From source: payout = cost - prizeContribution = 100_000 - (50_000/2) = 75_000
    const expectedPayout = 75_000n;
    const increase = newPending - prevPending;
    if (increase !== expectedPayout) {
      throw new Error(`pendingWithdrawals[painter1] increased by ${increase}, want ${expectedPayout}`);
    }
    log({ testName: "paintPixels — steal pixel 0", status: "PASS", detail: `tx ${hash} | painter1 pending += ${increase}`, durationMs: Date.now() - t0 });
    return true;
  } catch (e: unknown) {
    log({ testName: "paintPixels — steal pixel 0", status: "FAIL", detail: String(e), durationMs: Date.now() - t0 });
    return false;
  }
}

async function test_claimEarnings() {
  const t0 = Date.now();
  try {
    const pending = await readPendingWithdrawal(PAINTER1);
    if (pending === 0n) throw new Error("No pending withdrawal for painter1 — prerequisite failed");

    const balBefore = await getUsdcBalance(PAINTER1);
    const data = encodeFunctionData({ abi: ABI, functionName: "claimEarnings", args: [] });
    const hash = await sendTx(PAINTER1, CONTRACT_ADDRESS, data);
    const balAfter = await getUsdcBalance(PAINTER1);

    const increase = balAfter - balBefore;
    if (increase !== pending) throw new Error(`balance increase ${increase} !== pending was ${pending}`);

    log({ testName: "claimEarnings()", status: "PASS", detail: `tx ${hash} | claimed ${pending} units, balance ${balBefore} → ${balAfter}`, durationMs: Date.now() - t0 });
  } catch (e: unknown) {
    log({ testName: "claimEarnings()", status: "FAIL", detail: String(e), durationMs: Date.now() - t0 });
  }
}

async function test_getPendingWithdrawal_zero() {
  const t0 = Date.now();
  try {
    const pending = await readPendingWithdrawal(PAINTER1);
    if (pending !== 0n) throw new Error(`Expected 0 after claim, got ${pending}`);
    log({ testName: "getPendingWithdrawal — 0 after claim", status: "PASS", detail: `pending=${pending}`, durationMs: Date.now() - t0 });
  } catch (e: unknown) {
    log({ testName: "getPendingWithdrawal — 0 after claim", status: "FAIL", detail: String(e), durationMs: Date.now() - t0 });
  }
}

async function test_setSeasonEndTime(): Promise<bigint> {
  const t0 = Date.now();
  try {
    const block = await publicClient.getBlock();
    const newEnd = block.timestamp + 3600n;

    const data = encodeFunctionData({ abi: ABI, functionName: "setSeasonEndTime", args: [newEnd] });
    const hash = await sendTx(DEPLOYER_ADDRESS, CONTRACT_ADDRESS, data);

    const [endTime] = await readSeason();
    if (endTime !== newEnd) throw new Error(`endTime not updated: got ${endTime}, want ${newEnd}`);

    log({ testName: "setSeasonEndTime()", status: "PASS", detail: `tx ${hash} | newEnd=${newEnd}`, durationMs: Date.now() - t0 });
    return newEnd;
  } catch (e: unknown) {
    log({ testName: "setSeasonEndTime()", status: "FAIL", detail: String(e), durationMs: Date.now() - t0 });
    return 0n;
  }
}

async function test_endSeason(seasonEndTime: bigint) {
  const t0 = Date.now();
  try {
    // Need ≥3 distinct pixel owners in the leaderboard. Painter1 already has pixel 0
    // (after being stolen, their count is 0 — so they might not qualify).
    // Painter2 painted pixel 0 (has 1 pixel). Paint pixels 1 and 2 with painter3 and
    // another address to ensure 3 leaderboard entries with pixels.
    const FUND = 1_000_000n;

    // Painter1 re-paints pixel 0 to get it back (they were stolen)
    // Actually painter2 owns pixel 0 now. We need 3 different painters with pixels.
    // Painter2 has pixel 0 (1 pixel), painter3 needs pixel 1, painter1 re-paints or gets pixel 2.
    // Let's use a 4th address for the 3rd owner to be clean:
    const PAINTER4 = "0x4444444444444444444444444444444444444444" as const;
    await impersonate(PAINTER4);
    await setUsdcBalance(PAINTER4, FUND);
    await setUsdcAllowance(PAINTER4, CONTRACT_ADDRESS, FUND);

    await fundAndApprove(PAINTER3, FUND);

    // Painter3 paints pixel 1 (unclaimed → BASE_PRICE)
    await paintPixels(PAINTER3, [1n], [0x0000FF], 50_000n);
    // Painter4 paints pixel 2 (unclaimed → BASE_PRICE)
    await paintPixels(PAINTER4, [2n], [0xFFFF00], 50_000n);

    // Warp block timestamp past seasonEndTime
    const warpTo = Number(seasonEndTime) + 10;
    await rpc("anvil_setNextBlockTimestamp", [warpTo]);
    await rpc("evm_mine", []);

    const data = encodeFunctionData({ abi: ABI, functionName: "endSeason", args: [] });
    // endSeason is nonReentrant but NOT onlyOwner — any address can call it after time passes
    const hash = await sendTx(DEPLOYER_ADDRESS, CONTRACT_ADDRESS, data);

    const [, , active] = await readSeason();
    if (active) throw new Error("Season still active after endSeason");

    log({ testName: "endSeason()", status: "PASS", detail: `tx ${hash} | season ended, active=false`, durationMs: Date.now() - t0 });
  } catch (e: unknown) {
    log({ testName: "endSeason()", status: "FAIL", detail: String(e), durationMs: Date.now() - t0 });
  }
}

async function test_startSeason() {
  const t0 = Date.now();
  try {
    const block = await publicClient.getBlock();
    const newEnd = block.timestamp + 7200n;

    const data = encodeFunctionData({ abi: ABI, functionName: "startSeason", args: [newEnd] });
    const hash = await sendTx(DEPLOYER_ADDRESS, CONTRACT_ADDRESS, data);

    const [endTime, , active] = await readSeason();
    if (!active)            throw new Error("Season not active after startSeason");
    if (endTime !== newEnd) throw new Error(`endTime=${endTime}, want ${newEnd}`);

    log({ testName: "startSeason(newEndTime)", status: "PASS", detail: `tx ${hash} | newEnd=${newEnd} active=${active}`, durationMs: Date.now() - t0 });
  } catch (e: unknown) {
    log({ testName: "startSeason(newEndTime)", status: "FAIL", detail: String(e), durationMs: Date.now() - t0 });
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const code = await publicClient.getCode({ address: CONTRACT_ADDRESS });
  if (!code || code === "0x") {
    console.error(JSON.stringify({ error: "Contract not deployed at predicted address", address: CONTRACT_ADDRESS }));
    process.exit(1);
  }

  await setup();

  // 1. getSeason initial state
  await test_getSeason();

  // 2. paintPixels — unclaimed pixel 0
  const paintOk = await test_paintPixels_unclaimed();

  // 3. getPixel(0) — verify state after paint
  if (paintOk) {
    await test_getPixel_after_paint(PAINTER1);
  } else {
    log({ testName: "getPixel(0) after paint", status: "SKIPPED", detail: "paintPixels unclaimed failed", durationMs: 0 });
  }

  // 4. getPixelCount(painter1)
  if (paintOk) {
    await test_getPixelCount(PAINTER1, 1n);
  } else {
    log({ testName: "getPixelCount(painter1)", status: "SKIPPED", detail: "paintPixels unclaimed failed", durationMs: 0 });
  }

  // 5. paintPixels — steal pixel 0 with painter2
  const stealOk = paintOk ? await test_paintPixels_steal() : false;
  if (!paintOk) log({ testName: "paintPixels — steal pixel 0", status: "SKIPPED", detail: "previous paint failed", durationMs: 0 });

  // 6. claimEarnings — painter1 claims
  if (stealOk) {
    await test_claimEarnings();
  } else {
    log({ testName: "claimEarnings()", status: "SKIPPED", detail: "steal test failed", durationMs: 0 });
  }

  // 7. getPendingWithdrawal — 0 after claim
  if (stealOk) {
    await test_getPendingWithdrawal_zero();
  } else {
    log({ testName: "getPendingWithdrawal — 0 after claim", status: "SKIPPED", detail: "steal/claim failed", durationMs: 0 });
  }

  // 8. setSeasonEndTime
  const newSeasonEnd = await test_setSeasonEndTime();

  // 9. endSeason (paint pixels 1+2 with more painters, warp time)
  if (newSeasonEnd > 0n) {
    await test_endSeason(newSeasonEnd);
  } else {
    log({ testName: "endSeason()", status: "SKIPPED", detail: "setSeasonEndTime failed", durationMs: 0 });
  }

  // 10. startSeason
  const [, , stillActive] = await readSeason();
  if (!stillActive) {
    await test_startSeason();
  } else {
    log({ testName: "startSeason(newEndTime)", status: "SKIPPED", detail: "Season still active — endSeason did not complete", durationMs: 0 });
  }

  const passed  = results.filter(r => r.status === "PASS").length;
  const failed  = results.filter(r => r.status === "FAIL").length;
  const skipped = results.filter(r => r.status === "SKIPPED").length;

  console.log(JSON.stringify({ summary: `${passed} passed, ${failed} failed, ${skipped} skipped` }));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(JSON.stringify({ fatal: String(err) }));
  process.exit(1);
});
