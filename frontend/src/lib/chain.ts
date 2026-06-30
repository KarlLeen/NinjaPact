import { defineChain } from 'viem'
import { INJ_TESTNET_RPC_URLS } from './rpc'

export const injectiveTestnet = defineChain({
  id: 1439,
  name: 'Injective EVM Testnet',
  nativeCurrency: { name: 'INJ', symbol: 'INJ', decimals: 18 },
  rpcUrls: {
    default: {
      http: [...INJ_TESTNET_RPC_URLS],
    },
  },
  blockExplorers: {
    default: {
      name: 'Injective Testnet Explorer',
      url: 'https://testnet.explorer.injective.network/transaction',
    },
  },
  testnet: true,
})
