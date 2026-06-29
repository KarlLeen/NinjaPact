import { defineChain } from 'viem'

export const injectiveTestnet = defineChain({
  id: 1439,
  name: 'Injective EVM Testnet',
  nativeCurrency: { name: 'INJ', symbol: 'INJ', decimals: 18 },
  rpcUrls: {
    default: {
      http: ['https://testnet.sentry.chain.json-rpc.injective.network'],
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
