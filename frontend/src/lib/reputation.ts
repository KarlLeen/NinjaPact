import { keccak256, stringToBytes } from 'viem'
import { JUDGE_AGENT_ID } from './contracts'

// ERC-8004 reputation helpers (Model A: the user/client rates the Judge agent).
// The write goes to the canonical ReputationRegistry's giveFeedback(); the read
// aggregates readAllFeedback(). Binary score: 100 = 裁决公正/满意, 0 = 不满意/有争议.

export type Scene = 'habit' | 'escrow'
export type Outcome = 'success' | 'fail'

/// Judge agent id as bigint (uint256), or null when not configured (hides the UI).
export const JUDGE_AGENT_ID_BN: bigint | null = (() => {
  if (!JUDGE_AGENT_ID) return null
  try { return BigInt(JUDGE_AGENT_ID) } catch { return null }
})()

/// Anchors a feedback to a specific commitment + outcome (auditable, off-chain-derivable).
export function feedbackHashFor(id: bigint | string, outcome: Outcome): `0x${string}` {
  return keccak256(stringToBytes(`ninjapact:${id.toString()}:${outcome}`))
}

/// Build the giveFeedback() args tuple. value is int128 (bigint), valueDecimals=0.
/// tag1=scene, tag2=outcome; endpoint/feedbackURI left empty.
export function feedbackArgs(opts: {
  id: bigint | string
  scene: Scene
  outcome: Outcome
  satisfied: boolean
}): readonly [bigint, bigint, number, string, string, string, string, `0x${string}`] {
  const agentId = JUDGE_AGENT_ID_BN ?? 0n
  const value = opts.satisfied ? 100n : 0n
  return [agentId, value, 0, opts.scene, opts.outcome, '', '', feedbackHashFor(opts.id, opts.outcome)] as const
}

// ─── Local one-rating-per-commitment guard ────────────────────────────────────
// The registry doesn't bind feedback to a commitmentId, so we gate repeat ratings
// client-side (keyed by commitment id). Honest UX nudge, not a security boundary.

export function hasRated(id: bigint | string): boolean {
  return localStorage.getItem(`np_rated_${id.toString()}`) === '1'
}

export function markRated(id: bigint | string): void {
  localStorage.setItem(`np_rated_${id.toString()}`, '1')
}

// ─── Read aggregation (mirrors the SDK's getReputation) ───────────────────────
// Input is the raw readAllFeedback(...) tuple. Score = mean(value / 10^decimals)
// over non-revoked entries; with the binary 0/100 schema that mean IS a percent.

export interface ReputationSummary {
  count: number
  satisfactionPct: number | null // null when there's no feedback yet
}

type FeedbackTuple = readonly [
  readonly `0x${string}`[], // clients
  readonly bigint[],        // feedbackIndexes
  readonly bigint[],        // values (int128)
  readonly number[],        // valueDecimals (uint8)
  readonly string[],        // tag1s
  readonly string[],        // tag2s
  readonly boolean[],       // revokedStatuses
]

export function computeReputation(raw: FeedbackTuple | undefined): ReputationSummary {
  if (!raw) return { count: 0, satisfactionPct: null }
  const values = raw[2] ?? []
  const decimals = raw[3] ?? []
  const revoked = raw[6] ?? []

  let sum = 0
  let count = 0
  for (let i = 0; i < values.length; i++) {
    if (revoked[i]) continue
    const dec = Number(decimals[i] ?? 0)
    sum += Number(values[i]) / Math.pow(10, dec)
    count++
  }
  if (count === 0) return { count: 0, satisfactionPct: null }
  return { count, satisfactionPct: Math.round(sum / count) }
}
