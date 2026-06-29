import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import { encryptBlob, decryptBlob } from './cryptobox.js'

// Code-delivery escrow custody: the deliverer's source is the *asset* — held encrypted
// at rest (AES-256-GCM via cryptobox) and released to the payer ONLY after on-chain
// settlement in the deliverer's favor (gate enforced in index.ts via escrowDelivered).
// The demo link is the *proof* the payer tests. On-chain stores only sha256(source).
// (Path A: deliverer self-hosts the demo; Path B will build it from this source.)

const CUSTODY_DIR = process.env.CUSTODY_DIR ?? join(process.cwd(), 'custody')
mkdirSync(CUSTODY_DIR, { recursive: true })

export interface DeliveryMeta {
  demoLink: string
  sourceHash: string  // 0x-prefixed sha256 of the plaintext source (anchored on-chain)
  filename: string
  size: number
  submittedAt: string
}

function srcPath(id: string) { return join(CUSTODY_DIR, `c${id}_source.enc`) }
function metaPath(id: string) { return join(CUSTODY_DIR, `c${id}_delivery.json`) }
function disputePath(id: string) { return join(CUSTODY_DIR, `c${id}_dispute.json`) }

/// Encrypt + persist the source bundle; return sha256(plaintext) as a 0x bytes32 hash.
export function saveSource(commitmentId: string, plaintext: Buffer): { sourceHash: string } {
  writeFileSync(srcPath(commitmentId), encryptBlob(plaintext)) // iv(12)|tag(16)|ct
  const sourceHash = '0x' + createHash('sha256').update(plaintext).digest('hex')
  return { sourceHash }
}

/// Decrypt + return the source bundle (caller must enforce the on-chain release gate).
export function loadSource(commitmentId: string): Buffer | null {
  const p = srcPath(commitmentId)
  if (!existsSync(p)) return null
  return decryptBlob(readFileSync(p))
}

export function saveDeliveryMeta(commitmentId: string, meta: DeliveryMeta): void {
  writeFileSync(metaPath(commitmentId), JSON.stringify(meta, null, 2))
}

export function loadDeliveryMeta(commitmentId: string): DeliveryMeta | null {
  const p = metaPath(commitmentId)
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, 'utf8')) as DeliveryMeta } catch { return null }
}

export interface DisputeRecord {
  message: string
  round: number
  at: string
  advisory?: { inSpec: boolean; reasoning: string } // AI in-spec referee (advisory, off-chain)
}

/// Append a complaint to the dispute history (one entry per revision round).
export function saveDispute(
  commitmentId: string, message: string, round: number,
  advisory?: { inSpec: boolean; reasoning: string },
): void {
  const history = loadDisputeHistory(commitmentId)
  history.push({ message, round, at: new Date().toISOString(), advisory })
  writeFileSync(disputePath(commitmentId), JSON.stringify(history))
}

/// Full dispute history (for the terminal arbiter — every round matters).
export function loadDisputeHistory(commitmentId: string): DisputeRecord[] {
  const p = disputePath(commitmentId)
  if (!existsSync(p)) return []
  try {
    const data = JSON.parse(readFileSync(p, 'utf8'))
    return Array.isArray(data) ? data as DisputeRecord[] : [data as DisputeRecord] // tolerate legacy single-object
  } catch { return [] }
}

/// Latest complaint (for the deliverer — what to fix now).
export function loadDispute(commitmentId: string): DisputeRecord | null {
  const h = loadDisputeHistory(commitmentId)
  return h.length ? h[h.length - 1] : null
}
