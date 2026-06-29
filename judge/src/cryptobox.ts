import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'

// AES-256-GCM at-rest encryption shared by the escrow source custody (custody.ts) and
// evidence photos (storage.ts). On-chain stores only sha256(plaintext) — the raw bytes
// (deliverable source,打卡照片) are held encrypted at rest (CLAUDE.md 铁律 #10).
// Key derived from a server secret (CUSTODY_KEY preferred; falls back to JWT_SECRET so a
// dev box works out of the box). 32 bytes via scrypt.
const KEY = scryptSync(
  process.env.CUSTODY_KEY ?? process.env.JWT_SECRET ?? 'ninjapact-dev-custody',
  'ninjapact-custody-salt',
  32,
)

/// Encrypt → blob laid out as iv(12) | authTag(16) | ciphertext.
export function encryptBlob(plaintext: Buffer): Buffer {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', KEY, iv)
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), enc])
}

/// Decrypt a blob produced by encryptBlob (throws on tamper / wrong key / non-blob).
export function decryptBlob(blob: Buffer): Buffer {
  const iv = blob.subarray(0, 12)
  const tag = blob.subarray(12, 28)
  const ct = blob.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', KEY, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()])
}

/// Best-effort decrypt: returns plaintext if the blob is GCM-encrypted, else the blob
/// as-is. Back-compat for evidence photos written before at-rest encryption landed
/// (GCM auth fails on a raw image → we return the original bytes).
export function decryptBlobOrRaw(blob: Buffer): Buffer {
  try { return decryptBlob(blob) } catch { return blob }
}
