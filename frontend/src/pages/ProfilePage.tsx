import { useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAccount, useReadContract, useReadContracts } from 'wagmi'
import type { Address } from 'viem'
import {
  NINJA_PACT_ABI, NINJA_PACT_ADDRESS, BADGE_ABI, BADGE_ADDRESS,
  STATE, STATE_LABEL, STATE_CLASS, JUDGE_AGENT_ID, judgeScanUrl,
  REPUTATION_ABI, REPUTATION_REGISTRY_ADDRESS,
} from '../lib/contracts'
import { JUDGE_AGENT_ID_BN, computeReputation } from '../lib/reputation'

// 段位 = 守诺勋章数(成功履约次数)。通用带色,无专有名词。
const BELTS = [
  { min: 0, name: '白带', color: '#E8ECF2' },
  { min: 1, name: '黄带', color: '#E7C84B' },
  { min: 3, name: '绿带', color: '#2FBE9A' },
  { min: 6, name: '蓝带', color: '#5B8DEF' },
  { min: 10, name: '棕带', color: '#A06A3C' },
  { min: 20, name: '黑带', color: '#7E8AA0', bg: '#0E1118' },
]
function rank(badges: number) {
  let i = 0
  for (let k = 0; k < BELTS.length; k++) if (badges >= BELTS[k].min) i = k
  return { cur: BELTS[i], next: BELTS[i + 1] ?? null, toNext: BELTS[i + 1] ? BELTS[i + 1].min - badges : 0 }
}

export function ProfilePage() {
  const nav = useNavigate()
  const { address } = useAccount()

  const { data: ids } = useReadContract({
    abi: NINJA_PACT_ABI, address: NINJA_PACT_ADDRESS, functionName: 'getUserCommitments',
    args: address ? [address as Address] : undefined, query: { enabled: !!address },
  })
  const { data: badgeBal } = useReadContract({
    abi: BADGE_ABI, address: BADGE_ADDRESS, functionName: 'balanceOf',
    args: address ? [address as Address] : undefined, query: { enabled: !!address },
  })
  const { data: commitments } = useReadContracts({
    contracts: (ids ?? []).map(id => ({
      abi: NINJA_PACT_ABI, address: NINJA_PACT_ADDRESS, functionName: 'getCommitment', args: [id],
    })),
    query: { enabled: !!ids && ids.length > 0 },
  })

  // Judge's live ERC-8004 reputation: aggregate all client feedback (readAllFeedback).
  const { data: feedbackRaw } = useReadContract({
    abi: REPUTATION_ABI, address: REPUTATION_REGISTRY_ADDRESS, functionName: 'readAllFeedback',
    args: JUDGE_AGENT_ID_BN !== null ? [JUDGE_AGENT_ID_BN, [], '', '', false] : undefined,
    query: { enabled: JUDGE_AGENT_ID_BN !== null },
  })
  const judgeRep = useMemo(() => computeReputation(feedbackRaw as Parameters<typeof computeReputation>[0]), [feedbackRaw])

  const badges = Number(badgeBal ?? 0n)
  const { cur, next, toNext } = rank(badges)

  const { tally, rows } = useMemo(() => {
    const t = { total: 0, active: 0, success: 0, failed: 0 }
    const r: { id: bigint; state: number }[] = []
    for (let i = 0; i < (commitments?.length ?? 0); i++) {
      const item = commitments![i] as { status: string; result?: readonly unknown[] }
      if (item.status !== 'success' || !item.result) continue
      const state = Number(item.result[5])
      const id = ids![i]
      r.push({ id, state })
      t.total++
      if (state === STATE.Active || state === STATE.AwaitingParties || state === STATE.Created) t.active++
      else if (state === STATE.Success || state === STATE.Settled) t.success++
      else if (state === STATE.Fail || state === STATE.Locked || state === STATE.Claimable) t.failed++
    }
    r.reverse() // newest first
    return { tally: t, rows: r }
  }, [commitments, ids])

  const concluded = tally.success + tally.failed
  const rate = concluded > 0 ? Math.round((tally.success / concluded) * 100) : null

  return (
    <div className="screen">
      <div className="nav">
        <button className="nav-back" onClick={() => nav('/dashboard')}>← 返回</button>
        <span className="title" style={{ fontSize: 18 }}>履约档案</span>
      </div>

      {/* 段位 */}
      <div className="card card-gold" style={{ textAlign: 'center', marginBottom: 16 }}>
        <div style={{
          width: 84, height: 84, borderRadius: '50%', margin: '4px auto 12px',
          border: `4px solid ${cur.color}`,
          background: cur.bg ?? 'transparent',
          color: cur.color,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 34, fontWeight: 800,
        }}>忍</div>
        <div style={{ fontWeight: 700, fontSize: 22, color: cur.color }}>{cur.name}</div>
        <div className="subtitle" style={{ fontSize: 13, marginTop: 4 }}>
          {next ? `再得 ${toNext} 枚守诺勋章晋级 ${next.name}` : '已达最高段位 '}
        </div>
      </div>

      {/* 守诺勋章 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="stat-row">
          <span className="subtitle">守诺勋章（soulbound）</span>
          <span className="stat-value" style={{ color: 'var(--accent)', fontSize: 18 }}>{badges} 枚</span>
        </div>
        <div className="stat-row">
          <span className="subtitle">履约率</span>
          <span className="stat-value">{rate === null ? '—' : `${rate}%`}{concluded > 0 && <span className="subtitle" style={{ fontSize: 12 }}> （{tally.success}/{concluded}）</span>}</span>
        </div>
      </div>

      {/* 立约统计 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="label" style={{ marginBottom: 10 }}>我发起的承诺</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', textAlign: 'center' }}>
          <Stat n={tally.total} label="总数" />
          <Stat n={tally.active} label="进行中" color="var(--accent)" />
          <Stat n={tally.success} label="已成功" color="var(--success)" />
          <Stat n={tally.failed} label="失败/锁定" color="var(--fail)" />
        </div>
      </div>

      {/* 履约记录 */}
      {rows.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="label" style={{ marginBottom: 10 }}>履约记录</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rows.map(({ id, state }) => (
              <Link key={id.toString()} to={`/pact/${id}`} style={{ textDecoration: 'none' }}>
                <div className="stat-row" style={{ cursor: 'pointer' }}>
                  <span className="subtitle">承诺 #{id.toString()}</span>
                  <span className={`state-badge ${STATE_CLASS[state]}`} style={{ fontSize: 11 }}>{STATE_LABEL[state]}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Judge's ERC-8004 on-chain identity — the validator behind every verdict */}
      <div className="card" style={{ marginTop: 4 }}>
        <div className="label" style={{ marginBottom: 6 }}>⚖️ 验收方</div>
        <div style={{ fontWeight: 600 }}>NinjaPact Judge</div>
        <p className="subtitle" style={{ fontSize: 12, marginTop: 2 }}>
          独立 AI 裁判,裁决全程上链可审计(裁判 / 托管 / 受益人三权分立)。
        </p>
        <div className="stat-row" style={{ marginTop: 10 }}>
          <span className="subtitle">链上口碑（裁决公正率）</span>
          <span className="stat-value" style={{ color: 'var(--accent)' }}>
            {judgeRep.satisfactionPct === null
              ? '暂无评价'
              : <>{judgeRep.satisfactionPct}% <span className="subtitle" style={{ fontSize: 12 }}>（{judgeRep.count} 位真实用户）</span></>}
          </span>
        </div>
        {JUDGE_AGENT_ID && (
          <a href={judgeScanUrl} target="_blank" rel="noreferrer"
            className="btn btn-ghost btn-block" style={{ marginTop: 10, fontSize: 13 }}>
            🆔 ERC-8004 链上身份 #{JUDGE_AGENT_ID} →
          </a>
        )}
      </div>
    </div>
  )
}

function Stat({ n, label, color }: { n: number; label: string; color?: string }) {
  return (
    <div>
      <div style={{ fontWeight: 700, fontSize: 22, color: color ?? 'var(--text)' }}>{n}</div>
      <div className="subtitle" style={{ fontSize: 12 }}>{label}</div>
    </div>
  )
}
