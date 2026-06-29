import { createConfig } from '@privy-io/wagmi'
import { http } from 'wagmi'
import { injectiveTestnet } from './chain'

export const wagmiConfig = createConfig({
  chains: [injectiveTestnet],
  transports: {
    [injectiveTestnet.id]: http(),
  },
})

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig
  }
}
