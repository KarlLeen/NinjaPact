import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/@privy-io/')) return 'privy'
          if (id.includes('node_modules/viem') || id.includes('node_modules/wagmi') || id.includes('node_modules/@wagmi')) {
            return 'viem-wagmi'
          }
        },
      },
    },
  },
})
