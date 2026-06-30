import { JUDGE_URL } from './contracts'
import { fetchWithTimeout } from './fetch'

// Commitment terms text (JSON {goal, evidence}) lives off-chain.
// localStorage is the fast/offline cache; the Judge server is the cross-device source.

function lsKey(id: bigint | string) {
  return `pact_terms_${id.toString()}`
}

export function parseGoal(termsText: string | null): string | null {
  if (!termsText) return null
  try {
    const goal = (JSON.parse(termsText) as { goal?: string }).goal
    return goal?.trim() || null
  } catch {
    return null
  }
}

async function syncTermsToServer(id: bigint, termsText: string): Promise<void> {
  const r = await fetchWithTimeout(`${JUDGE_URL}/terms/${id.toString()}`, { timeoutMs: 8_000 })
  if (r.ok) return
  if (r.status !== 404) return
  await fetchWithTimeout(`${JUDGE_URL}/terms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commitmentId: id.toString(), termsText }),
    timeoutMs: 12_000,
  })
}

/// localStorage first; on miss, fetch from Judge and cache. Returns terms JSON string.
export async function fetchTermsText(id: bigint): Promise<string | null> {
  const local = localStorage.getItem(lsKey(id))
  if (local) {
    syncTermsToServer(id, local).catch(() => {})
    return local
  }
  try {
    const r = await fetchWithTimeout(`${JUDGE_URL}/terms/${id.toString()}`, { timeoutMs: 8_000 })
    if (!r.ok) return null
    const { termsText } = await r.json() as { termsText?: string }
    if (termsText) localStorage.setItem(lsKey(id), termsText)
    return termsText ?? null
  } catch {
    return null
  }
}

/// Persist terms both locally and to the Judge server (server gates on hash match).
export async function saveTerms(id: bigint, termsText: string): Promise<void> {
  localStorage.setItem(lsKey(id), termsText)
  try {
    await fetchWithTimeout(`${JUDGE_URL}/terms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commitmentId: id.toString(), termsText }),
      timeoutMs: 12_000,
    })
  } catch {
    // server unreachable → localStorage still holds it; non-fatal
  }
}
