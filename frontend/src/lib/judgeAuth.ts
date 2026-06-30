import { JUDGE_URL } from './contracts'
import { fetchWithTimeout } from './fetch'

// SIWE-style auth against the Judge service: sign a nonce → JWT (cached in
// sessionStorage for ~1h). Shared by check-in (habit) and delivery (escrow) flows.

interface StoredJwt { token: string; exp: number }

export function loadJwt(): string | null {
  try {
    const raw = sessionStorage.getItem('judge_jwt')
    if (!raw) return null
    const { token, exp } = JSON.parse(raw) as StoredJwt
    if (Date.now() > exp - 60_000) return null // 1-min buffer
    return token
  } catch { return null }
}

function saveJwt(token: string, expiresAt: number) {
  sessionStorage.setItem('judge_jwt', JSON.stringify({ token, exp: expiresAt }))
}

async function fetchNonce(): Promise<string> {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetchWithTimeout(`${JUDGE_URL}/nonce`, { timeoutMs: 12_000 })
      if (!r.ok) throw new Error('无法获取 nonce')
      const { nonce } = await r.json() as { nonce: string }
      return nonce
    } catch (e) {
      lastError = e
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 800 * (attempt + 1)))
    }
  }
  throw lastError instanceof Error ? lastError : new Error('无法获取 nonce')
}

type SignFn = (args: { message: string }) => Promise<string>

/// Get a cached JWT or run the sign→auth handshake to mint a new one.
export async function getJudgeJwt(signMessageAsync: SignFn, address?: string): Promise<string> {
  const cached = loadJwt()
  if (cached) return cached

  const nonce = await fetchNonce()
  const message = `NinjaPact 打卡认证\n\nnonce: ${nonce}\ntimestamp: ${Date.now()}`
  const signature = await signMessageAsync({ message })

  const r = await fetchWithTimeout(`${JUDGE_URL}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, signature, address }),
    timeoutMs: 15_000,
  })
  if (!r.ok) {
    const err = await r.json().catch(() => ({})) as { error?: string }
    throw new Error(err.error ?? '认证失败')
  }
  const { token, expiresAt } = await r.json() as { token: string; expiresAt: number }
  saveJwt(token, expiresAt)
  return token
}
