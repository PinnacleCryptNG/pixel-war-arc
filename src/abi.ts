export const PIXEL_WAR_ADDRESS = '0xf6b7e56b1b440262cf77098aff39abad7c537cf5' as const;
export const PIXEL_WAR_CHAIN_ID = 5042002; // Arc Testnet

export const PIXEL_WAR_ABI = [
  { type: 'function', name: 'BASE_PRICE', inputs: [], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'GRID_SIZE', inputs: [], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'MAX_BATCH', inputs: [], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'getSeason', inputs: [], outputs: [{ name: 'endTime', type: 'uint256' }, { name: 'prizePool', type: 'uint256' }, { name: 'active', type: 'bool' }], stateMutability: 'view' },
  { type: 'function', name: 'getPixel', inputs: [{ name: 'pixelId', type: 'uint256' }], outputs: [{ name: 'owner', type: 'address' }, { name: 'color', type: 'uint24' }, { name: 'price', type: 'uint128' }], stateMutability: 'view' },
  { type: 'function', name: 'getPixels', inputs: [{ name: 'pixelIds', type: 'uint256[]' }], outputs: [{ name: 'pixelData', type: 'tuple[]', components: [{ name: 'owner', type: 'address' }, { name: 'color', type: 'uint24' }, { name: 'price', type: 'uint128' }] }], stateMutability: 'view' },
  { type: 'function', name: 'getPixelCount', inputs: [{ name: 'user', type: 'address' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'getPendingWithdrawal', inputs: [{ name: 'user', type: 'address' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'getEarnings', inputs: [{ name: 'user', type: 'address' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'getAllOwnersCount', inputs: [], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'paintPixels', inputs: [{ name: 'pixelIds', type: 'uint256[]' }, { name: 'colors', type: 'uint24[]' }, { name: 'totalApproved', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'claimEarnings', inputs: [], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'endSeason', inputs: [], outputs: [], stateMutability: 'nonpayable' },
  { type: 'event', name: 'PixelPainted', inputs: [{ name: 'pixelId', type: 'uint256', indexed: true }, { name: 'newOwner', type: 'address', indexed: true }, { name: 'previousOwner', type: 'address', indexed: true }, { name: 'color', type: 'uint24', indexed: false }, { name: 'price', type: 'uint128', indexed: false }, { name: 'prizeContribution', type: 'uint128', indexed: false }] },
  { type: 'event', name: 'SeasonEnded', inputs: [{ name: 'winners', type: 'address[3]', indexed: false }, { name: 'payouts', type: 'uint256[3]', indexed: false }] },
] as const;

export const USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as const;
export const EXPLORER_BASE = 'https://explorer.testnet.arc.io';
