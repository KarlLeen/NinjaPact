import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PrivyProvider } from '@privy-io/react-auth'
import { WagmiProvider } from '@privy-io/wagmi'
import { type ReactNode } from 'react'
import { wagmiConfig } from './lib/wagmiConfig'
import { injectiveTestnet } from './lib/chain'
import { ToastProvider } from './lib/toast'

const queryClient = new QueryClient()

const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID ?? 'clmbwu7na00iyl60fgwwyp5a9'

export function Providers({ children }: { children: ReactNode }) {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ['email', 'google'],
        appearance: {
          theme: 'dark',
          accentColor: '#2FBE9A',
        },
        defaultChain: injectiveTestnet,
        supportedChains: [injectiveTestnet],
        embeddedWallets: {
          ethereum: {
            createOnLogin: 'users-without-wallets',
          },
        },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>
          <ToastProvider>
            {children}
          </ToastProvider>
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  )
}
