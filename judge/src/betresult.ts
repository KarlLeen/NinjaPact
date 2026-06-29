import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

// Off-chain record of a DUO bet's Judge ruling (reasoning + outcome + tx), keyed by
// commitmentId. The chain holds outcome/winner/pot (BetResolved event) + the reasonHash;
// this maps id → the human-readable reasoning the Judge produced, for the detail page.

const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), 'data')
const FILE = join(DATA_DIR, 'betresults.json')

mkdirSync(DATA_DIR, { recursive: true })

export interface BetResult {
  outcome: boolean
  confidence: number
  reasoning: string
  txHash: string
  resolvedAt: number
}

let cache: Record<string, BetResult> = {}
if (existsSync(FILE)) {
  try { cache = JSON.parse(readFileSync(FILE, 'utf8')) } catch { cache = {} }
}

export function getBetResult(id: string): BetResult | null {
  return cache[id] ?? null
}

export function saveBetResult(id: string, r: BetResult): void {
  cache[id] = r
  writeFileSync(FILE, JSON.stringify(cache, null, 2))
}
