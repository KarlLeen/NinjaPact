import { createPublicClient, createWalletClient, http, defineChain } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const injectiveTestnet = defineChain({
  id: 1439,
  name: 'Injective EVM Testnet',
  nativeCurrency: { name: 'Injective', symbol: 'INJ', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.RPC_URL ?? 'https://testnet.sentry.chain.json-rpc.injective.network'] },
  },
})

export const NINJAPACT_ADDRESS = (process.env.NINJAPACT_ADDRESS ?? '') as `0x${string}`

export const account = privateKeyToAccount(
  (process.env.KEEPER_PRIVATE_KEY ?? '0x0') as `0x${string}`
)

export const publicClient = createPublicClient({ chain: injectiveTestnet, transport: http() })
export const walletClient = createWalletClient({ account, chain: injectiveTestnet, transport: http() })

export const KEEPER_ABI = [
  {
    type: 'function',
    name: 'getCommitment',
    inputs: [{ name: 'id', type: 'uint64' }],
    outputs: [
      { name: '', type: 'uint64' },
      { name: '', type: 'uint8' },   // mode
      { name: '', type: 'address' }, // judge
      { name: '', type: 'address' }, // witness
      { name: '', type: 'bytes32' }, // termsHash
      { name: '', type: 'uint8' },   // state
      { name: '', type: 'uint32' },  // verdictPass
      { name: '', type: 'uint32' },  // verdictFail
      { name: '', type: 'uint64' },  // lockedUntil
    ],
    stateMutability: 'view',
  },
  { type: 'function', name: 'cancelUnfunded', inputs: [{ name: 'id', type: 'uint64' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'settle', inputs: [{ name: 'id', type: 'uint64' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'claim', inputs: [{ name: 'id', type: 'uint64' }], outputs: [], stateMutability: 'nonpayable' },
] as const

// State enum (mirrors Solidity)
export const State = {
  Created: 0,
  AwaitingParties: 1,
  Active: 2,
  Success: 3,
  Fail: 4,
  Locked: 5,
  Claimable: 6,
  Settled: 7,
  Cancelled: 8,
} as const

export interface CommitmentView {
  id: bigint
  mode: number   // 0 SOLO, 1 DUO, 2 POOL, 3 MILESTONE, 4 DEPOSIT
  state: number
}

export const Mode = { SOLO: 0, DUO: 1, POOL: 2, MILESTONE: 3, DEPOSIT: 4 } as const

export async function readCommitment(id: bigint): Promise<CommitmentView> {
  const c = await publicClient.readContract({
    abi: KEEPER_ABI,
    address: NINJAPACT_ADDRESS,
    functionName: 'getCommitment',
    args: [id],
  })
  return { id: c[0], mode: Number(c[1]), state: Number(c[5]) }
}

type Action = 'cancelUnfunded' | 'settle' | 'claim'

/// Simulate first; only broadcast if it would succeed. Avoids wasting gas on
/// premature calls (e.g. settle before endTime, claim before lock expiry).
export async function tryAction(action: Action, id: bigint): Promise<`0x${string}` | null> {
  try {
    await publicClient.simulateContract({
      account,
      abi: KEEPER_ABI,
      address: NINJAPACT_ADDRESS,
      functionName: action,
      args: [id],
    })
  } catch {
    return null // not yet actionable (would revert)
  }

  const hash = await walletClient.writeContract({
    abi: KEEPER_ABI,
    address: NINJAPACT_ADDRESS,
    functionName: action,
    args: [id],
  })
  await publicClient.waitForTransactionReceipt({ hash })
  return hash
}
