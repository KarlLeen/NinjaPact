import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import { encryptBlob, decryptBlobOrRaw } from './cryptobox.js'

const EVIDENCE_DIR = process.env.EVIDENCE_DIR ?? join(process.cwd(), 'evidence')

mkdirSync(EVIDENCE_DIR, { recursive: true })

export interface VerdictArchive {
  commitmentId: string
  dayIndex: number
  pass: boolean
  useRestCard: boolean
  confidence: number
  reasoning: string
  challenge: string
  termsText: string
  imageSha256: string
  reasonHash: string
  signature: string
  txHash: string
  submittedBy: string
  timestamp: string
  reReview?: boolean // true if this verdict came from a witness-dispute flagship re-review
}

function decodeDataUrl(dataUrl: string): { buffer: Buffer; ext: string } {
  const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/)
  if (!match) return { buffer: Buffer.from(dataUrl, 'base64'), ext: 'bin' }
  return { buffer: Buffer.from(match[2], 'base64'), ext: match[1] }
}

/// Persist the photo to disk (encrypted at rest, AES-256-GCM via cryptobox — 铁律 #10)
/// and return sha256 of the *plaintext* (the hash anchored on-chain is keccak256(reasoning);
/// the plaintext image sha256 is recorded in the reasoning archive). Filename keeps the
/// original image ext (contents are ciphertext); reads decrypt transparently.
export function saveImage(commitmentId: string, dayIndex: number, imageDataUrl: string): {
  imageSha256: string
  imagePath: string
} {
  const { buffer, ext } = decodeDataUrl(imageDataUrl)
  const imageSha256 = createHash('sha256').update(buffer).digest('hex')
  const imagePath = join(EVIDENCE_DIR, `c${commitmentId}_d${dayIndex}_${imageSha256.slice(0, 12)}.${ext}`)
  writeFileSync(imagePath, encryptBlob(buffer))
  return { imageSha256, imagePath }
}

/// Archive the full reasoning + verdict metadata as JSON (auditable record).
export function saveVerdictArchive(archive: VerdictArchive): string {
  const path = join(EVIDENCE_DIR, `c${archive.commitmentId}_d${archive.dayIndex}_verdict.json`)
  writeFileSync(path, JSON.stringify(archive, null, 2))
  return path
}

/// Reload the stored photo for (commitmentId, dayIndex) as a data URL (for re-review).
export function loadImage(commitmentId: string, dayIndex: number): string | null {
  const prefix = `c${commitmentId}_d${dayIndex}_`
  const file = readdirSync(EVIDENCE_DIR).find(f => f.startsWith(prefix) && !f.endsWith('.json'))
  if (!file) return null
  const ext = file.split('.').pop() || 'jpeg'
  const b64 = decryptBlobOrRaw(readFileSync(join(EVIDENCE_DIR, file))).toString('base64')
  return `data:image/${ext};base64,${b64}`
}

/// Reload the raw photo bytes for serving to a witness (image/<ext>).
export function loadImageRaw(commitmentId: string, dayIndex: number): { buffer: Buffer; contentType: string } | null {
  const prefix = `c${commitmentId}_d${dayIndex}_`
  const file = readdirSync(EVIDENCE_DIR).find(f => f.startsWith(prefix) && !f.endsWith('.json'))
  if (!file) return null
  const ext = (file.split('.').pop() || 'jpeg').replace('jpg', 'jpeg')
  return { buffer: decryptBlobOrRaw(readFileSync(join(EVIDENCE_DIR, file))), contentType: `image/${ext}` }
}

/// Reload the verdict archive (terms, challenge, reasoning) for re-review context.
export function loadVerdictArchive(commitmentId: string, dayIndex: number): VerdictArchive | null {
  const path = join(EVIDENCE_DIR, `c${commitmentId}_d${dayIndex}_verdict.json`)
  if (!existsSync(path)) return null
  try { return JSON.parse(readFileSync(path, 'utf8')) as VerdictArchive } catch { return null }
}
