/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { arcTestnet } from 'viem/chains'
import { injected, coinbaseWallet } from 'wagmi/connectors'
import { registerChain } from './tracing'

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(arcTestnet.id, arcTestnet.rpcUrls.default.http[0])

export const config = createConfig({
  chains: [arcTestnet, mainnet], // mainnet needed for ENS resolution
  // injected: MetaMask, Rabby, Brave, etc.  coinbaseWallet: Coinbase Wallet (also works without extension via QR)
  connectors: [
    injected(),
    coinbaseWallet({ appName: 'PixelWar', appLogoUrl: 'https://studio.arc.io/favicon.ico' }),
  ],
  transports: {
    [arcTestnet.id]: http('https://rpc.testnet.arc.io'),
    [mainnet.id]: http(),
  },
})
