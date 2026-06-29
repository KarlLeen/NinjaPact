import type { Address } from 'viem'

export const NINJA_PACT_ADDRESS = (import.meta.env.VITE_NINJAPACT_ADDRESS ?? '') as Address
export const BADGE_ADDRESS       = (import.meta.env.VITE_BADGE_ADDRESS ?? '') as Address
export const MOCK_USD_ADDRESS    = (import.meta.env.VITE_MOCKUSD_ADDRESS ?? '') as Address
export const JUDGE_ADDRESS       = (import.meta.env.VITE_JUDGE_ADDRESS ?? '') as Address
export const JUDGE_URL           = (import.meta.env.VITE_JUDGE_URL ?? 'http://localhost:3001') as string

// Judge's ERC-8004 on-chain agent identity (registered on Injective testnet's
// canonical IdentityRegistry). 8004scan.io has not indexed chain 1439 agents yet
// (their /agent/eip155:… URL 404s); link to Blockscout NFT instance instead.
export const JUDGE_AGENT_ID      = (import.meta.env.VITE_JUDGE_AGENT_ID ?? '') as string
const ERC8004_TESTNET_REGISTRY   = '0x8004A818BFB912233c491871b3d84c89A494BD9e'
export const judgeScanUrl        = JUDGE_AGENT_ID
  ? `https://testnet.blockscout.injective.network/token/${ERC8004_TESTNET_REGISTRY}/instance/${JUDGE_AGENT_ID}`
  : ''

// ERC-8004 ReputationRegistry (Injective testnet, canonical). Users give feedback on
// the Judge agent here (client → agent). Address verified against the agent-sdk's
// packages/sdk/src/config.ts TESTNET config — do NOT use the staging/mainnet addresses.
export const REPUTATION_REGISTRY_ADDRESS = (
  import.meta.env.VITE_REPUTATION_REGISTRY ?? '0x8004B663056A597Dffe9eCcC1965A193B7388713'
) as Address

// ─── State enum (mirrors Solidity) ───────────────────────────────────────────
export const STATE = {
  Created:        0,
  AwaitingParties:1,
  Active:         2,
  Success:        3,
  Fail:           4,
  Locked:         5,
  Claimable:      6,
  Settled:        7,
  Cancelled:      8,
} as const

export type CommitmentState = typeof STATE[keyof typeof STATE]

// ─── Mode enum (mirrors Solidity: SOLO, DUO, POOL, MILESTONE, DEPOSIT) ────────
export const MODE = {
  SOLO:      0,
  DUO:       1,
  POOL:      2,
  MILESTONE: 3,
  DEPOSIT:   4,
} as const

// ─── Escrow phase (DEPOSIT code-delivery sub-state) ──────────────────────────
export const ESCROW_PHASE = {
  None:              0,
  InProgress:        1,
  UnderReview:       2,
  RevisionRequested: 3,
  Arbitration:       4,
} as const

export const ESCROW_PHASE_LABEL: Record<number, string> = {
  0: '—',
  1: '等待交付',
  2: '验收中',
  3: '修改中',
  4: '终局裁决中',
}

export const STATE_LABEL: Record<number, string> = {
  0: '待资金',
  1: '等待入伙',
  2: '进行中',
  3: '已成功',
  4: '失败',
  5: '锁定中',
  6: '可领取',
  7: '已结算',
  8: '已取消',
}

export const STATE_CLASS: Record<number, string> = {
  0: 's-funding',
  1: 's-funding',
  2: 's-active',
  3: 's-success',
  4: 's-fail',
  5: 's-locked',
  6: 's-claim',
  7: 's-settled',
  8: 's-cancel',
}

// ─── NinjaPact ABI ────────────────────────────────────────────────────────────
export const NINJA_PACT_ABI = [
  {
    type: 'constructor',
    inputs: [
      { name: '_token', type: 'address' },
      { name: '_badge', type: 'address' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'createCommitment',
    inputs: [
      { name: 'mode', type: 'uint8' },
      { name: 'judge', type: 'address' },
      { name: 'termsHash', type: 'bytes32' },
      {
        name: 'policy',
        type: 'tuple',
        components: [
          { name: 'totalRequired', type: 'uint32' },
          { name: 'failThreshold', type: 'uint32' },
          { name: 'restCards', type: 'uint32' },
          { name: 'restCardsUsed', type: 'uint32' },
        ],
      },
      {
        name: 'schedule',
        type: 'tuple',
        components: [
          { name: 'startTime', type: 'uint64' },
          { name: 'endTime', type: 'uint64' },
          { name: 'windowStartHour', type: 'uint32' },
          { name: 'windowDurationH', type: 'uint32' },
        ],
      },
      { name: 'stake', type: 'uint256' },
      { name: 'witnessInviteHash', type: 'bytes32' },
      { name: 'duoInviteHash', type: 'bytes32' },
      { name: 'duoRequiredStake', type: 'uint256' },
    ],
    outputs: [{ name: 'id', type: 'uint64' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'createBet',
    inputs: [
      { name: 'judge', type: 'address' },
      { name: 'termsHash', type: 'bytes32' },
      {
        name: 'schedule',
        type: 'tuple',
        components: [
          { name: 'startTime', type: 'uint64' },
          { name: 'endTime', type: 'uint64' },
          { name: 'windowStartHour', type: 'uint32' },
          { name: 'windowDurationH', type: 'uint32' },
        ],
      },
      { name: 'stake', type: 'uint256' },
      { name: 'opponentInviteHash', type: 'bytes32' },
      { name: 'creatorBetsYes', type: 'bool' },
    ],
    outputs: [{ name: 'id', type: 'uint64' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'fund',
    inputs: [{ name: 'id', type: 'uint64' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
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
  },
  {
    type: 'function',
    name: 'settle',
    inputs: [{ name: 'id', type: 'uint64' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'joinCommitment',
    inputs: [
      { name: 'id', type: 'uint64' },
      { name: 'secret', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'acceptWitness',
    inputs: [
      { name: 'id', type: 'uint64' },
      { name: 'secret', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'witnessDispute',
    inputs: [
      { name: 'id', type: 'uint64' },
      { name: 'dayIndex', type: 'uint32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'claim',
    inputs: [{ name: 'id', type: 'uint64' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'cancelUnfunded',
    inputs: [{ name: 'id', type: 'uint64' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  // ── DEPOSIT code-delivery escrow ──
  {
    type: 'function',
    name: 'submitDelivery',
    inputs: [
      { name: 'id', type: 'uint64' },
      { name: 'deliveryHash', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'confirmDelivery',
    inputs: [{ name: 'id', type: 'uint64' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'requestRevision',
    inputs: [
      { name: 'id', type: 'uint64' },
      { name: 'disputeMsgHash', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'requestArbitration',
    inputs: [{ name: 'id', type: 'uint64' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  // ── DUO public-event bet ──
  {
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
  },
  {
    type: 'function',
    name: 'getCreatorBetsYes',
    inputs: [{ name: 'id', type: 'uint64' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getEscrow',
    inputs: [{ name: 'id', type: 'uint64' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'phase', type: 'uint8' },
          { name: 'phaseDeadline', type: 'uint64' },
          { name: 'revisionsAllowed', type: 'uint32' },
          { name: 'revisionsUsed', type: 'uint32' },
          { name: 'deliveryHash', type: 'bytes32' },
          { name: 'disputeMsgHash', type: 'bytes32' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'escrowDelivered',
    inputs: [{ name: '', type: 'uint64' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'redeemLock',
    inputs: [
      { name: 'lockedId', type: 'uint64' },
      { name: 'successId', type: 'uint64' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
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
  {
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
  },
  {
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
  },
  {
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
  },
  {
    type: 'function',
    name: 'getUserCommitments',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint64[]' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'CommitmentCreated',
    inputs: [
      { name: 'id', type: 'uint64', indexed: true },
      { name: 'creator', type: 'address', indexed: true },
      { name: 'mode', type: 'uint8', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'CommitmentSettled',
    inputs: [
      { name: 'id', type: 'uint64', indexed: true },
      { name: 'outcome', type: 'uint8', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'BetResolved',
    inputs: [
      { name: 'id', type: 'uint64', indexed: true },
      { name: 'outcome', type: 'bool', indexed: false },
      { name: 'winner', type: 'address', indexed: true },
      { name: 'pot', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'VerdictSubmitted',
    inputs: [
      { name: 'id', type: 'uint64', indexed: true },
      { name: 'dayIndex', type: 'uint32', indexed: false },
      { name: 'pass', type: 'bool', indexed: false },
      { name: 'reasonHash', type: 'bytes32', indexed: false },
      { name: 'signer', type: 'address', indexed: false },
      { name: 'passTotal', type: 'uint32', indexed: false },
      { name: 'failTotal', type: 'uint32', indexed: false },
    ],
  },
] as const

// ─── MockUSD ABI ──────────────────────────────────────────────────────────────
export const MOCK_USD_ABI = [
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'allowance',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'mint',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'decimals',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
  },
] as const

// ─── Badge ABI ────────────────────────────────────────────────────────────────
export const BADGE_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'ownerOf',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
] as const

// ─── ERC-8004 ReputationRegistry ABI (minimal) ───────────────────────────────
// Copied verbatim from injective-agent-sdk packages/sdk/src/abi/ReputationRegistry.json.
// giveFeedback: msg.sender (the client) rates the agent; readAllFeedback aggregates.
export const REPUTATION_ABI = [
  {
    type: 'function',
    name: 'giveFeedback',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'value', type: 'int128' },
      { name: 'valueDecimals', type: 'uint8' },
      { name: 'tag1', type: 'string' },
      { name: 'tag2', type: 'string' },
      { name: 'endpoint', type: 'string' },
      { name: 'feedbackURI', type: 'string' },
      { name: 'feedbackHash', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'readAllFeedback',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'clientAddresses', type: 'address[]' },
      { name: 'tag1', type: 'string' },
      { name: 'tag2', type: 'string' },
      { name: 'includeRevoked', type: 'bool' },
    ],
    outputs: [
      { name: 'clients', type: 'address[]' },
      { name: 'feedbackIndexes', type: 'uint64[]' },
      { name: 'values', type: 'int128[]' },
      { name: 'valueDecimals', type: 'uint8[]' },
      { name: 'tag1s', type: 'string[]' },
      { name: 'tag2s', type: 'string[]' },
      { name: 'revokedStatuses', type: 'bool[]' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getClients',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getLastIndex',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'clientAddress', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint64' }],
    stateMutability: 'view',
  },
] as const
