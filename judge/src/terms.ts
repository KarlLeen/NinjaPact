import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

// Off-chain store of commitment terms text, keyed by commitmentId.
// Chain holds only termsHash; this maps id → the original text for display.
// Tamper-proof: writes are gated by keccak256(text)==on-chain hash (see index.ts).

const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), 'data')
const TERMS_FILE = join(DATA_DIR, 'terms.json')

mkdirSync(DATA_DIR, { recursive: true })

let cache: Record<string, string> = {}
if (existsSync(TERMS_FILE)) {
  try { cache = JSON.parse(readFileSync(TERMS_FILE, 'utf8')) } catch { cache = {} }
}

export function getTerms(id: string): string | null {
  return cache[id] ?? null
}

export function saveTerms(id: string, termsText: string): void {
  cache[id] = termsText
  writeFileSync(TERMS_FILE, JSON.stringify(cache, null, 2))
}
