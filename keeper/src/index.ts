import 'dotenv/config'
import cron from 'node-cron'
import {
  account, publicClient, readCommitment, tryAction, State, Mode,
} from './chain.js'

const MAX_SCAN = 10_000 // safety cap
const JUDGE_URL = process.env.JUDGE_URL ?? 'http://localhost:3001'

/// Ask the Judge to resolve a DUO public-event bet. The Judge endpoint itself enforces
/// the event deadline (no-op 400 before it), so this is safe to call every tick.
async function triggerBetResolution(id: bigint): Promise<void> {
  try {
    const r = await fetch(`${JUDGE_URL}/resolve-bet/${id.toString()}`, { method: 'POST' })
    if (r.ok) {
      const j = await r.json() as { outcome?: boolean; txHash?: string }
      console.log(`  #${id} bet resolved outcome=${j.outcome} → ${j.txHash}`)
    }
    // non-ok (e.g. deadline not reached) is expected pre-deadline; stay quiet
  } catch (e) {
    console.error(`  #${id} resolve-bet ping failed: ${String(e)}`)
  }
}

/// One keeper pass: scan all commitments and act on any that are due.
async function tick() {
  const ts = new Date().toISOString()
  console.log(`[${ts}] keeper tick start`)

  let acted = 0
  for (let i = 1n; i <= BigInt(MAX_SCAN); i++) {
    let c
    try {
      c = await readCommitment(i)
    } catch (e) {
      console.error(`  read #${i} failed: ${String(e)}`)
      break
    }

    // id == 0 means this slot was never created → end of list
    if (c.id === 0n) break

    try {
      if (c.state === State.Created || c.state === State.AwaitingParties) {
        // joinDeadline passed & unfunded → cancel + refund
        const tx = await tryAction('cancelUnfunded', i)
        if (tx) { console.log(`  #${i} cancelUnfunded → ${tx}`); acted++ }
      } else if (c.state === State.Active) {
        if (c.mode === Mode.DUO) {
          // DUO bet: at/after the event deadline, ask the Judge (event oracle) to resolve.
          await triggerBetResolution(i)
          // safety net: if the Judge never resolves, settle refunds both sides past the grace window.
          const tx = await tryAction('settle', i)
          if (tx) { console.log(`  #${i} bet timeout settle (refund both) → ${tx}`); acted++ }
        } else {
          // schedule ended → settle (success/fail) / escrow timeout
          const tx = await tryAction('settle', i)
          if (tx) { console.log(`  #${i} settle → ${tx}`); acted++ }
        }
      } else if (c.state === State.Locked || c.state === State.Claimable) {
        // lock expired (or already claimable) → claim + refund to owner
        const tx = await tryAction('claim', i)
        if (tx) { console.log(`  #${i} claim → ${tx}`); acted++ }
      }
    } catch (e) {
      console.error(`  #${i} action failed: ${String(e)}`)
    }
  }

  console.log(`[${new Date().toISOString()}] keeper tick done — ${acted} action(s)`)
}

async function main() {
  const balance = await publicClient.getBalance({ address: account.address }).catch(() => 0n)
  console.log(`Keeper address: ${account.address}`)
  console.log(`Keeper INJ balance: ${(Number(balance) / 1e18).toFixed(4)} INJ`)

  if (process.argv.includes('--once')) {
    await tick()
    return
  }

  const schedule = process.env.CRON_SCHEDULE ?? '0 * * * *'
  console.log(`Scheduling keeper with cron "${schedule}"`)
  cron.schedule(schedule, () => { tick().catch(e => console.error('tick error:', e)) })

  // Run one pass immediately on startup
  await tick()
}

main().catch(e => { console.error(e); process.exit(1) })
