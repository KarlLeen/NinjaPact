import { JUDGE_URL } from './contracts'

// Client for the Judge's code-delivery escrow endpoints (B2/B3).

export interface DeliveryMeta {
  demoLink: string
  sourceHash: string
  filename: string
  size: number
  submittedAt: string
}

export interface DisputeRecord {
  message: string
  round: number
  at: string
  advisory?: { inSpec: boolean; reasoning: string }
}

async function errOf(r: Response): Promise<string> {
  const b = await r.json().catch(() => ({})) as { error?: string }
  return b.error ?? `服务错误 ${r.status}`
}

/// Deliverer uploads source (held encrypted) + demo link → returns sourceHash to anchor.
/// multipart/form-data so the binary isn't base64-inflated (~33%). The browser sets the
/// multipart Content-Type + boundary — do NOT set it manually.
export async function uploadDelivery(
  jwt: string, commitmentId: bigint | string, file: File, demoLink: string,
): Promise<{ sourceHash: `0x${string}` }> {
  const fd = new FormData()
  fd.append('commitmentId', commitmentId.toString())
  fd.append('demoLink', demoLink)
  fd.append('filename', file.name)
  fd.append('source', file, file.name)
  const r = await fetch(`${JUDGE_URL}/deliver`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
    body: fd,
  })
  if (!r.ok) throw new Error(await errOf(r))
  return r.json()
}

export async function fetchDeliveryMeta(id: bigint): Promise<DeliveryMeta | null> {
  const r = await fetch(`${JUDGE_URL}/deliver/${id}/meta`)
  return r.ok ? r.json() : null
}

/// Payer downloads the released source (gated server-side: only after delivered settlement).
export async function downloadSource(jwt: string, id: bigint, filename: string): Promise<void> {
  const r = await fetch(`${JUDGE_URL}/deliver/${id}/source`, { headers: { Authorization: `Bearer ${jwt}` } })
  if (!r.ok) throw new Error(await errOf(r))
  const blob = await r.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/// Store the payer's complaint text (hash-gated against on-chain disputeMsgHash); returns AI advisory.
export async function postDispute(
  commitmentId: bigint | string, message: string,
): Promise<{ advisory?: { inSpec: boolean; reasoning: string } }> {
  const r = await fetch(`${JUDGE_URL}/dispute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commitmentId: commitmentId.toString(), message }),
  })
  if (!r.ok) throw new Error(await errOf(r))
  return r.json()
}

export async function fetchDispute(id: bigint): Promise<DisputeRecord | null> {
  const r = await fetch(`${JUDGE_URL}/dispute/${id}`)
  return r.ok ? r.json() : null
}

/// Normalize a user-entered demo link into a safe absolute http(s) URL.
/// Deliverers often type "my-app.vercel.app" (no scheme) — without this the browser
/// treats it as a path relative to the current origin and the link "won't open".
/// Non-http schemes (javascript:, data:, etc.) are rejected.
export function safeExternalUrl(raw?: string): string {
  let s = (raw ?? '').trim()
  if (!s) return ''
  if (/^https?:\/\//i.test(s)) return s
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return '' // some other scheme → block
  s = s.replace(/^\/+/, '')                     // strip leading slashes ("//host")
  return `https://${s}`
}
