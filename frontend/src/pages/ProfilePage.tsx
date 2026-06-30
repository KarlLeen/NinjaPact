import { useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAccount, useReadContract, useReadContracts } from 'wagmi'
import type { Address } from 'viem'
import {
  NINJA_PACT_ABI, NINJA_PACT_ADDRESS, BADGE_ABI, BADGE_ADDRESS,
  STATE, STATE_LABEL, STATE_CLASS,
  REPUTATION_ABI, REPUTATION_REGISTRY_ADDRESS,
} from '../lib/contracts'
import { JUDGE_AGENT_ID, judgeScanUrl } from '../lib/contracts'
import { JUDGE_AGENT_ID_BN, computeReputation } from '../lib/reputation'

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

function beltRingClass(color: string) {
  if (color === '#2FBE9A') return 'is-green'
  if (color === '#E7C84B') return 'is-yellow'
  if (color === '#5B8DEF') return 'is-blue'
  return ''
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

  const { data: feedbackRaw } = useReadContract({
    abi: REPUTATION_ABI, address: REPUTATION_REGISTRY_ADDRESS, functionName: 'readAllFeedback',
    args: JUDGE_AGENT_ID_BN !== null ? [JUDGE_AGENT_ID_BN, [], '', '', false] : undefined,
    query: { enabled: JUDGE_AGENT_ID_BN !== null },
  })
  const judgeRep = useMemo(() => computeReputation(feedbackRaw as Parameters<typeof computeReputation>[0]), [feedbackRaw])

  const badges = Number(badgeBal ?? 0n)
  const { cur, next, toNext } = rank(badges)
  const ringClass = beltRingClass(cur.color)

  const beltProgress = next
    ? Math.min(100, Math.round(((badges - cur.min) / (next.min - cur.min)) * 100))
    : 100

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
    r.reverse()
    return { tally: t, rows: r }
  }, [commitments, ids])

  const concluded = tally.success + tally.failed
  const rate = concluded > 0 ? Math.round((tally.success / concluded) * 100) : null

  return (
    <div className="screen screen-narrow">
      <header className="top-nav top-nav--flat">
        <button type="button" className="nav-back" onClick={() => nav('/dashboard')}>
          ← 返回
        </button>
        <span className="top-nav-title">履约档案</span>
        <span className="nav-spacer" aria-hidden="true" />
      </header>

      <main className="profile-main">
        <section className="profile-hero" aria-label="段位与履约概览">
          <div className="profile-hero-glow" aria-hidden="true" />
          <div className="profile-hero-row">
            <div
              className={`profile-rank-ring ${ringClass}`}
              style={{
                borderColor: cur.color,
                background: cur.bg ?? 'rgba(0,0,0,0.2)',
                boxShadow: `0 0 0 4px ${cur.color}18`,
              }}
              aria-hidden="true"
            >
              <span className="profile-rank-mark" style={{ color: cur.color }}>忍</span>
            </div>
            <div className="profile-hero-meta">
              <p className="profile-rank-name" style={{ color: cur.color }}>{cur.name}</p>
              <p className="profile-rank-hint">
                {next
                  ? <>再得 <strong>{toNext}</strong> 枚守诺勋章晋级 {next.name}</>
                  : '已达最高段位'}
              </p>
              {next && (
                <>
                  <div
                    className="profile-rank-progress"
                    role="progressbar"
                    aria-valuenow={badges}
                    aria-valuemin={cur.min}
                    aria-valuemax={next.min}
                    aria-label="守诺勋章进度"
                  >
                    <div className="profile-rank-progress-fill" style={{ width: `${beltProgress}%` }} />
                  </div>
                  <p className="profile-rank-progress-label">
                    {badges} / {next.min} 枚守诺勋章
                  </p>
                </>
              )}
            </div>
          </div>
          <div className="profile-hero-metrics">
            <div className="profile-hero-metric">
              <span className="profile-hero-metric-val text-jade">{badges}</span>
              <span className="profile-hero-metric-label">守诺勋章</span>
              <span className="profile-hero-metric-sub">soulbound</span>
            </div>
            <div className="profile-hero-metric-divider" aria-hidden="true" />
            <div className="profile-hero-metric">
              <span className="profile-hero-metric-val">
                {rate === null ? '—' : `${rate}%`}
              </span>
              <span className="profile-hero-metric-label">履约率</span>
              <span className="profile-hero-metric-sub">
                {concluded > 0 ? `${tally.success} / ${concluded} 已完结` : '暂无完结记录'}
              </span>
            </div>
          </div>
        </section>

        <section className="card profile-tally-card" aria-labelledby="profile-tally-heading">
          <h2 id="profile-tally-heading" className="card-section-title">我发起的承诺</h2>
          <div className="profile-metric-grid">
            <div className="profile-metric-cell">
              <span className="profile-metric-cell-val">{tally.total}</span>
              <span className="profile-metric-cell-label">总数</span>
            </div>
            <div className="profile-metric-cell is-accent">
              <span className="profile-metric-cell-val text-jade">{tally.active}</span>
              <span className="profile-metric-cell-label">进行中</span>
            </div>
            <div className="profile-metric-cell is-pass">
              <span className="profile-metric-cell-val text-pass">{tally.success}</span>
              <span className="profile-metric-cell-label">已成功</span>
            </div>
            <div className="profile-metric-cell is-fail">
              <span className="profile-metric-cell-val text-fail">{tally.failed}</span>
              <span className="profile-metric-cell-label">失败/锁定</span>
            </div>
          </div>
        </section>

        {rows.length > 0 && (
          <section className="card profile-records-card" aria-labelledby="profile-records-heading">
            <h2 id="profile-records-heading" className="card-section-title">履约记录</h2>
            <ul className="profile-record-list">
              {rows.map(({ id, state }) => (
                <li key={id.toString()}>
                  <Link to={`/pact/${id}`} className="profile-record-item">
                    <span className="profile-record-id">承诺 #{id.toString()}</span>
                    <span className={`state-badge ${STATE_CLASS[state]}`}>{STATE_LABEL[state]}</span>
                    <svg className="profile-record-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="profile-judge-card" aria-labelledby="profile-judge-heading">
          <div className="profile-judge-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 3v18M3 12h18M6 6l12 12M18 6L6 18" />
            </svg>
          </div>
          <div className="profile-judge-body">
            <h2 id="profile-judge-heading" className="profile-judge-title">NinjaPact Judge</h2>
            <p className="profile-judge-desc">独立 AI 裁判 · 裁决上链可审计</p>
            <p className="profile-judge-rep">
              链上口碑{' '}
              <strong className="text-jade">
                {judgeRep.satisfactionPct === null ? '暂无评价' : `${judgeRep.satisfactionPct}%`}
              </strong>
              {judgeRep.count > 0 && (
                <span className="subtitle text-dim-sm">（{judgeRep.count} 位用户）</span>
              )}
            </p>
          </div>
          <button
            type="button"
            className="profile-judge-link"
            aria-label="查看 Judge 链上身份"
            onClick={() => nav('/judge')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </section>

        <a
          className="btn btn-ghost btn-block"
          style={{ fontSize: 13, marginTop: 4 }}
          href={judgeScanUrl}
          target="_blank"
          rel="noreferrer"
        >
          Blockscout · Agent #{JUDGE_AGENT_ID || '48'} →
        </a>
      </main>
    </div>
  )
}
