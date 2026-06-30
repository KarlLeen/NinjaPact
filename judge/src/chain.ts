import {
  createPublicClient,
  createWalletClient,
  http,
  fallback,
  defineChain,
  keccak256,
  stringToBytes,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const RPC_URLS = [
  process.env.RPC_URL,
  'https://testnet.sentry.chain.json-rpc.injective.network',
  'https://k8s.testnet.json-rpc.injective.network',
].filter(Boolean) as string[]

const rpcTransport = fallback(
  RPC_URLS.map(url => http(url, { timeout: 20_000, retryCount: 1 })),
)

const injectiveTestnet = defineChain({
  id: 1439,
  name: 'Injective EVM Testnet',
  nativeCurrency: { name: 'Injective', symbol: 'INJ', decimals: 18 },
  rpcUrls: {
    default: { http: RPC_URLS },
  },
})

const NINJAPACT_ADDRESS = (process.env.NINJAPACT_ADDRESS ?? '') as `0x${string}`

export const account = privateKeyToAccount(
  (process.env.JUDGE_PRIVATE_KEY ?? '0x0') as `0x${string}`
)

export const publicClient = createPublicClient({
  chain: injectiveTestnet,
  transport: rpcTransport,
})

export const walletClient = createWalletClient({
  account,
  chain: injectiveTestnet,
  transport: rpcTransport,
})

// Minimal ABI slices needed by the judge

const GET_COMMITMENT_ABI = {
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
} as const

const GET_POLICY_ABI = {
  type: 'function',
  name: 'getEvidencePolicy',
  inputs: [{ name: 'id', type: 'uint64' }],
  outputs: [
    {
      type: 'tuple',
      components: [
        { name: 'totalRequired', type: 'uint32' },
        { name: 'failThreshold', type: 'uint32' },
        { name: 'restCards', type: 'uint32' },
        { name: 'restCardsUsed', type: 'uint32' },
      ],
    },
  ],
  stateMutability: 'view',
} as const

const GET_PARTIES_ABI = {
  type: 'function',
  name: 'getParties',
  inputs: [{ name: 'id', type: 'uint64' }],
  outputs: [
    {
      type: 'tuple[]',
      components: [
        { name: 'addr', type: 'address' },
        { name: 'stake', type: 'uint256' },
        { name: 'role', type: 'uint8' },
        { name: 'funded', type: 'bool' },
      ],
    },
  ],
  stateMutability: 'view',
} as const

const GET_ESCROW_ABI = {
  type: 'function',
  name: 'getEscrow',
  inputs: [{ name: 'id', type: 'uint64' }],
  outputs: [
    {
      type: 'tuple',
      components: [
        { name: 'phase', type: 'uint8' },          // 0 None 1 InProgress 2 UnderReview 3 RevisionRequested 4 Arbitration
        { name: 'phaseDeadline', type: 'uint64' },
        { name: 'revisionsAllowed', type: 'uint32' },
        { name: 'revisionsUsed', type: 'uint32' },
        { name: 'deliveryHash', type: 'bytes32' },
        { name: 'disputeMsgHash', type: 'bytes32' },
      ],
    },
  ],
  stateMutability: 'view',
} as const

const ESCROW_DELIVERED_ABI = {
  type: 'function',
  name: 'escrowDelivered',
  inputs: [{ name: '', type: 'uint64' }],
  outputs: [{ name: '', type: 'bool' }],
  stateMutability: 'view',
} as const

const SUBMIT_VERDICT_ABI = {
  type: 'function',
  name: 'submitVerdict',
  inputs: [
    { name: 'id', type: 'uint64' },
    { name: 'dayIndex', type: 'uint32' },
    { name: 'pass', type: 'bool' },
    { name: 'useRestCard', type: 'bool' },
    { name: 'reasonHash', type: 'bytes32' },
    { name: 'signature', type: 'bytes' },
  ],
  outputs: [],
  stateMutability: 'nonpayable',
} as const

const VERDICT_UNDER_REVIEW_ABI = {
  type: 'event',
  name: 'VerdictUnderReview',
  inputs: [
    { name: 'id', type: 'uint64', indexed: true },
    { name: 'dayIndex', type: 'uint32', indexed: false },
    { name: 'witness', type: 'address', indexed: false },
  ],
} as const

const ARBITRATE_ABI = {
  type: 'function',
  name: 'arbitrate',
  inputs: [
    { name: 'id', type: 'uint64' },
    { name: 'pass', type: 'bool' },
    { name: 'reasonHash', type: 'bytes32' },
    { name: 'signature', type: 'bytes' },
  ],
  outputs: [],
  stateMutability: 'nonpayable',
} as const

const ARBITRATION_REQUESTED_ABI = {
  type: 'event',
  name: 'ArbitrationRequested',
  inputs: [{ name: 'id', type: 'uint64', indexed: true }],
} as const

const GET_SCHEDULE_ABI = {
  type: 'function',
  name: 'getSchedule',
  inputs: [{ name: 'id', type: 'uint64' }],
  outputs: [
    {
      type: 'tuple',
      components: [
        { name: 'startTime', type: 'uint64' },
        { name: 'endTime', type: 'uint64' },
        { name: 'windowStartHour', type: 'uint32' },
        { name: 'windowDurationH', type: 'uint32' },
      ],
    },
  ],
  stateMutability: 'view',
} as const

const RESOLVE_BET_ABI = {
  type: 'function',
  name: 'resolveBet',
  inputs: [
    { name: 'id', type: 'uint64' },
    { name: 'outcome', type: 'bool' },
    { name: 'reasonHash', type: 'bytes32' },
    { name: 'signature', type: 'bytes' },
  ],
  outputs: [],
  stateMutability: 'nonpayable',
} as const

// EIP-712 typed-data definition — must match NinjaPact's DOMAIN_SEPARATOR + VERDICT_TYPEHASH
const VERDICT_TYPES = {
  Verdict: [
    { name: 'commitmentId', type: 'uint64' },
    { name: 'dayIndex', type: 'uint32' },
    { name: 'pass', type: 'bool' },
    { name: 'useRestCard', type: 'bool' },
    { name: 'reasonHash', type: 'bytes32' },
  ],
} as const

export interface CommitmentInfo {
  judgeAddr: string
  termsHash: string
  mode: number // 0 SOLO, 1 DUO, 2 POOL, 3 MILESTONE, 4 DEPOSIT
  state: number
  verdictPass: number
  verdictFail: number
  restCards: number
  restCardsUsed: number
  parties: string[]
  nextDayIndex: number // next free evidence slot = pass + fail + restCardsUsed
}

export async function readCommitment(id: bigint): Promise<CommitmentInfo> {
  const [commitment, policy, parties] = await Promise.all([
    publicClient.readContract({
      abi: [GET_COMMITMENT_ABI],
      address: NINJAPACT_ADDRESS,
      functionName: 'getCommitment',
      args: [id],
    }),
    publicClient.readContract({
      abi: [GET_POLICY_ABI],
      address: NINJAPACT_ADDRESS,
      functionName: 'getEvidencePolicy',
      args: [id],
    }),
    publicClient.readContract({
      abi: [GET_PARTIES_ABI],
      address: NINJAPACT_ADDRESS,
      functionName: 'getParties',
      args: [id],
    }),
  ])

  const [, modeRaw, judgeAddr, , termsHash, stateRaw, verdictPass, verdictFail] = commitment

  const restCards = Number(policy.restCards)
  const restCardsUsed = Number(policy.restCardsUsed)
  const vPass = Number(verdictPass)
  const vFail = Number(verdictFail)

  return {
    judgeAddr: judgeAddr.toLowerCase(),
    termsHash: termsHash as string,
    mode: Number(modeRaw),
    state: Number(stateRaw),
    verdictPass: vPass,
    verdictFail: vFail,
    restCards,
    restCardsUsed,
    parties: parties.map(p => (p.addr as string).toLowerCase()),
    nextDayIndex: vPass + vFail + restCardsUsed,
  }
}

export interface EscrowInfo {
  phase: number          // 0 None 1 InProgress 2 UnderReview 3 RevisionRequested 4 Arbitration
  phaseDeadline: number
  revisionsAllowed: number
  revisionsUsed: number
  deliveryHash: string
  disputeMsgHash: string
  delivered: boolean     // settled in the deliverer's favor → source release unlocked
}

export async function readEscrow(id: bigint): Promise<EscrowInfo> {
  const [e, delivered] = await Promise.all([
    publicClient.readContract({
      abi: [GET_ESCROW_ABI], address: NINJAPACT_ADDRESS, functionName: 'getEscrow', args: [id],
    }),
    publicClient.readContract({
      abi: [ESCROW_DELIVERED_ABI], address: NINJAPACT_ADDRESS, functionName: 'escrowDelivered', args: [id],
    }),
  ])
  return {
    phase: Number(e.phase),
    phaseDeadline: Number(e.phaseDeadline),
    revisionsAllowed: Number(e.revisionsAllowed),
    revisionsUsed: Number(e.revisionsUsed),
    deliveryHash: e.deliveryHash as string,
    disputeMsgHash: e.disputeMsgHash as string,
    delivered: Boolean(delivered),
  }
}

export async function readSchedule(id: bigint): Promise<{ startTime: number; endTime: number }> {
  const s = await publicClient.readContract({
    abi: [GET_SCHEDULE_ABI], address: NINJAPACT_ADDRESS, functionName: 'getSchedule', args: [id],
  })
  return { startTime: Number(s.startTime), endTime: Number(s.endTime) }
}

export interface VerdictResult {
  txHash: `0x${string}`
  reasonHash: `0x${string}`
  signature: `0x${string}`
}

/// Sign the verdict with the Judge key (EIP-712) and broadcast submitVerdict.
/// The on-chain authority comes from the signature, not msg.sender.
export async function submitVerdict(
  commitmentId: bigint,
  dayIndex: number,
  pass: boolean,
  useRestCard: boolean,
  reasoning: string,
): Promise<VerdictResult> {
  const reasonHash = keccak256(stringToBytes(reasoning))

  const signature = await walletClient.signTypedData({
    account,
    domain: {
      name: 'NinjaPact',
      version: '1',
      chainId: 1439,
      verifyingContract: NINJAPACT_ADDRESS,
    },
    types: VERDICT_TYPES,
    primaryType: 'Verdict',
    message: {
      commitmentId,
      dayIndex,
      pass,
      useRestCard,
      reasonHash,
    },
  })

  const txHash = await walletClient.writeContract({
    abi: [SUBMIT_VERDICT_ABI],
    address: NINJAPACT_ADDRESS,
    functionName: 'submitVerdict',
    args: [commitmentId, dayIndex, pass, useRestCard, reasonHash, signature],
  })

  return { txHash, reasonHash, signature }
}

/// Watch for witness disputes by polling eth_getLogs over block ranges.
/// (Injective's RPC doesn't keep eth filters alive, so we avoid watchContractEvent.)
export function watchVerdictDisputes(
  handler: (commitmentId: bigint, dayIndex: number) => void,
): () => void {
  let lastBlock = 0n
  let stopped = false

  async function poll() {
    try {
      const latest = await publicClient.getBlockNumber()
      if (lastBlock === 0n) { lastBlock = latest; return } // first tick: baseline only
      if (latest < lastBlock + 1n) return

      const logs = await publicClient.getLogs({
        address: NINJAPACT_ADDRESS,
        event: VERDICT_UNDER_REVIEW_ABI,
        fromBlock: lastBlock + 1n,
        toBlock: latest,
      })
      lastBlock = latest
      for (const log of logs) {
        const args = log.args as { id?: bigint; dayIndex?: number }
        if (args?.id !== undefined) handler(args.id, Number(args.dayIndex))
      }
    } catch (e) {
      console.error('[dispute watcher] poll error:', String(e))
    }
  }

  const timer = setInterval(() => { if (!stopped) void poll() }, 8_000)
  void poll()
  return () => { stopped = true; clearInterval(timer) }
}

/// Terminal escrow arbitration: Judge signs (reusing the Verdict typed-data with
/// dayIndex=0) and calls arbitrate(id, pass). pass → deliverer; fail → payer refund.
export async function arbitrate(commitmentId: bigint, pass: boolean, reasoning: string): Promise<VerdictResult> {
  const reasonHash = keccak256(stringToBytes(reasoning))
  const signature = await walletClient.signTypedData({
    account,
    domain: { name: 'NinjaPact', version: '1', chainId: 1439, verifyingContract: NINJAPACT_ADDRESS },
    types: VERDICT_TYPES,
    primaryType: 'Verdict',
    message: { commitmentId, dayIndex: 0, pass, useRestCard: false, reasonHash },
  })
  const txHash = await walletClient.writeContract({
    abi: [ARBITRATE_ABI],
    address: NINJAPACT_ADDRESS,
    functionName: 'arbitrate',
    args: [commitmentId, pass, reasonHash, signature],
  })
  return { txHash, reasonHash, signature }
}

/// DUO public-event bet: Judge signs the outcome (reusing the Verdict typed-data with
/// dayIndex=0, pass=outcome) and calls resolveBet. The winning pre-fixed party takes the pot.
export async function resolveBet(commitmentId: bigint, outcome: boolean, reasoning: string): Promise<VerdictResult> {
  const reasonHash = keccak256(stringToBytes(reasoning))
  const signature = await walletClient.signTypedData({
    account,
    domain: { name: 'NinjaPact', version: '1', chainId: 1439, verifyingContract: NINJAPACT_ADDRESS },
    types: VERDICT_TYPES,
    primaryType: 'Verdict',
    message: { commitmentId, dayIndex: 0, pass: outcome, useRestCard: false, reasonHash },
  })
  const txHash = await walletClient.writeContract({
    abi: [RESOLVE_BET_ABI],
    address: NINJAPACT_ADDRESS,
    functionName: 'resolveBet',
    args: [commitmentId, outcome, reasonHash, signature],
  })
  return { txHash, reasonHash, signature }
}

/// Watch for escrow arbitration requests (ArbitrationRequested) by polling getLogs.
export function watchArbitrations(handler: (commitmentId: bigint) => void): () => void {
  let lastBlock = 0n
  let stopped = false
  async function poll() {
    try {
      const latest = await publicClient.getBlockNumber()
      if (lastBlock === 0n) { lastBlock = latest; return }
      if (latest < lastBlock + 1n) return
      const logs = await publicClient.getLogs({
        address: NINJAPACT_ADDRESS,
        event: ARBITRATION_REQUESTED_ABI,
        fromBlock: lastBlock + 1n,
        toBlock: latest,
      })
      lastBlock = latest
      for (const log of logs) {
        const args = log.args as { id?: bigint }
        if (args?.id !== undefined) handler(args.id)
      }
    } catch (e) {
      console.error('[arbitration watcher] poll error:', String(e))
    }
  }
  const timer = setInterval(() => { if (!stopped) void poll() }, 8_000)
  void poll()
  return () => { stopped = true; clearInterval(timer) }
}
