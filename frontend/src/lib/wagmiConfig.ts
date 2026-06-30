import { createConfig } from '@privy-io/wagmi'
import { fallback, http } from 'viem'
import { injectiveTestnet } from './chain'
import { INJ_TESTNET_RPC_URLS } from './rpc'

export const wagmiConfig = createConfig({
  chains: [injectiveTestnet],
  transports: {
    [injectiveTestnet.id]: fallback(
      INJ_TESTNET_RPC_URLS.map(url => http(url, { timeout: 20_000, retryCount: 1 })),
    ),
  },
})

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig
  }
}
