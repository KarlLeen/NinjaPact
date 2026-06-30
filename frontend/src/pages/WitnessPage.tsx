import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { usePrivy } from '@privy-io/react-auth'
import { useAccount, useReadContract, useWriteContract } from 'wagmi'
import { formatUnits } from 'viem'
import {
  NINJA_PACT_ABI, NINJA_PACT_ADDRESS, JUDGE_URL,
  STATE_LABEL, STATE_CLASS,
} from '../lib/contracts'
import { ZERO_ADDRESS } from '../lib/witness'
import { fetchTermsText, parseGoal } from '../lib/terms'
import { useToast } from '../lib/toast'
import { waitReceipt } from '../lib/tx'
import { DetailTopNav, CheckinTimeline } from '../components/PactUi'

const CHAIN_POLL_MS = 20_000
const CHAIN_POLL_QUERY = { refetchInterval: CHAIN_POLL_MS, refetchIntervalInBackground: false } as const

const PROGRESS_RING_R = 42
const PROGRESS_RING_C = 2 * Math.PI * PROGRESS_RING_R

function short(a?: string) {
  return a ? `${a.slice(0, 6)}...${a.slice(-4)}` : ''
}

function formatShortDate(ts: bigint): string {
  const d = new Date(Number(ts) * 1000)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${m}-${day}`
}

export function WitnessPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const { ready, authenticated, login } = usePrivy()
  const { address } = useAccount()
  const { writeContractAsync } = useWriteContract()
  const toast = useToast()

  const pactId = BigInt(id ?? '0')
  const secret = useMemo(() => {
    const h = window.location.hash
    return h.startsWith('#') ? h.slice(1) : h
  }, [])

  const [busy, setBusy] = useState(false)
  const [goal, setGoal] = useState<string | null>(null)
  const [latestVerdict, setLatestVerdict] = useState<{ pass: boolean; reasoning: string; reReview: boolean } | null>(null)
  const [disputed, setDisputed] = useState(() => !!localStorage.getItem(`pact_disputed_${pactId}`))

  const { data: commitment, refetch } = useReadContract({
    abi: NINJA_PACT_ABI, address: NINJA_PACT_ADDRESS,
    functionName: 'getCommitment', args: [pactId],
    query: CHAIN_POLL_QUERY,
  })
  const { data: policy } = useReadContract({
    abi: NINJA_PACT_ABI, address: NINJA_PACT_ADDRESS,
    functionName: 'getEvidencePolicy', args: [pactId],
    query: CHAIN_POLL_QUERY,
  })
  const { data: parties } = useReadContract({
    abi: NINJA_PACT_ABI, address: NINJA_PACT_ADDRESS,
    functionName: 'getParties', args: [pactId],
  })
  const { data: schedule } = useReadContract({
    abi: NINJA_PACT_ABI, address: NINJA_PACT_ADDRESS,
    functionName: 'getSchedule', args: [pactId],
  })

  useEffect(() => {
    let alive = true
    fetchTermsText(pactId).then(t => { if (alive) setGoal(parseGoal(t)) })
    return () => { alive = false }
  }, [pactId])

  useEffect(() => {
    if (!commitment) return
    const total = Number(commitment[6]) + Number(commitment[7]) + Number(policy?.restCardsUsed ?? 0)
    if (total === 0) { setLatestVerdict(null); return }
    let alive = true
    fetch(`${JUDGE_URL}/verdict/${pactId}/${total - 1}`)
      .then(r => (r.ok ? r.json() : null))
      .then((v: { pass: boolean; reasoning: string; reReview: boolean } | null) => {
        if (alive && v) setLatestVerdict({ pass: v.pass, reasoning: v.reasoning, reReview: v.reReview })
      })
      .catch(() => {})
    return () => { alive = false }
  }, [commitment, policy, pactId])

  async function handleBind() {
    if (!authenticated) { login(); return }
    if (!secret) { toast('邀请链接缺少凭证', 'error'); return }
    setBusy(true)
    try {
      toast('绑定为见证人...', 'info')
      const hash = await writeContractAsync({
        abi: NINJA_PACT_ABI, address: NINJA_PACT_ADDRESS,
        functionName: 'acceptWitness', args: [pactId, secret as `0x${string}`],
      })
      await waitReceipt(hash)
      toast('已成为见证人', 'success')
      await refetch()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      toast(msg.includes('InvalidSecret') ? '邀请凭证无效或已被使用' : `失败：${msg.slice(0, 50)}`, 'error')
    } finally { setBusy(false) }
  }

  async function handleDispute() {
    if (totalVerdict === 0) { toast('还没有裁决可质疑', 'error'); return }
    const dayIndex = totalVerdict - 1
    setBusy(true)
    try {
      toast('提交质疑...', 'info')
      const hash = await writeContractAsync({
        abi: NINJA_PACT_ABI, address: NINJA_PACT_ADDRESS,
        functionName: 'witnessDispute', args: [pactId, dayIndex],
      })
      await waitReceipt(hash)
      localStorage.setItem(`pact_disputed_${pactId}`, '1')
      setDisputed(true)
      toast('已质疑，AI 旗舰模型复核中…', 'success')
      const pollVerdict = () => fetch(`${JUDGE_URL}/verdict/${pactId}/${dayIndex}`)
        .then(r => (r.ok ? r.json() : null))
        .then((v: { pass: boolean; reasoning: string; reReview: boolean } | null) => {
          if (v) setLatestVerdict({ pass: v.pass, reasoning: v.reasoning, reReview: v.reReview })
        }).catch(() => {})
      setTimeout(() => { void pollVerdict(); void refetch() }, 7000)
      setTimeout(() => { void pollVerdict(); void refetch() }, 15000)
      await refetch()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('DisputeAlreadyUsed')) { setDisputed(true); toast('每个承诺只能质疑一次', 'error') }
      else if (msg.includes('NotWitness')) toast('只有见证人可质疑', 'error')
      else toast(`失败：${msg.slice(0, 50)}`, 'error')
    } finally { setBusy(false) }
  }

  if (!commitment) return (
    <div className="screen-full"><div className="spinner" /></div>
  )

  const [cid, , , witness, , stateRaw, verdictPass, verdictFail] = commitment
  const state = Number(stateRaw)
  const exists = Number(cid) !== 0
  const committer = parties?.[0]?.addr as string | undefined
  const stake = parties?.[0]?.stake ?? 0n
  const totalRequired = Number(policy?.totalRequired ?? 1)
  const restUsed = Number(policy?.restCardsUsed ?? 0)
  const totalVerdict = Number(verdictPass) + Number(verdictFail) + restUsed
  const pct = Math.min(100, (totalVerdict / totalRequired) * 100)
  const ringOffset = PROGRESS_RING_C * (1 - pct / 100)
  const daysLeft = schedule
    ? Math.max(0, Math.ceil((Number(schedule.endTime) * 1000 - Date.now()) / 86400000))
    : 0

  const witnessBound = witness && witness.toLowerCase() !== ZERO_ADDRESS
  const iAmWitness = witnessBound && address && witness.toLowerCase() === address.toLowerCase()
  const titleText = goal ?? `承诺 #${pactId.toString()}`

  if (!exists) return (
    <div className="app-shell screen screen-narrow">
      <DetailTopNav title="见证人" />
      <main className="status-panel" style={{ marginTop: 24 }}>
        <div className="status-mark">—</div>
        <h2>找不到这个承诺</h2>
        <p className="status-lede">链接可能已失效，或承诺尚未创建。</p>
      </main>
    </div>
  )

  return (
    <div className="app-shell screen screen-narrow screen-detail">
      <DetailTopNav
        title="见证人"
        badge={<span className={`state-badge ${STATE_CLASS[state]}`} role="status">{STATE_LABEL[state]}</span>}
      />

      <main className="witness-layout" aria-label="见证人视图">
        <div className="detail-hero">
          <div className="detail-hero-top">
            <div className="detail-meta-row">
              <span className="kind-tag mode-solo">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <circle cx="12" cy="12" r="4" />
                </svg>
                承诺 #{pactId.toString()} · {short(committer)}
              </span>
              <span className="stake-tag">{formatUnits(stake, 6)} mUSD</span>
            </div>
          </div>

          <h1 className="title">{titleText}</h1>

          <div className="progress-panel" role="group" aria-label="打卡进度">
            <div className="progress-ring-wrap" aria-hidden="true">
              <svg className="progress-ring" viewBox="0 0 100 100">
                <circle className="progress-ring-bg" cx="50" cy="50" r={PROGRESS_RING_R} />
                <circle
                  className="progress-ring-fill"
                  cx="50"
                  cy="50"
                  r={PROGRESS_RING_R}
                  strokeDasharray={PROGRESS_RING_C}
                  strokeDashoffset={ringOffset}
                />
              </svg>
              <div className="progress-ring-label">
                <span className="progress-ring-num">{totalVerdict}</span>
                <span className="progress-ring-den">/ {totalRequired}</span>
              </div>
            </div>

            <div className="progress-stats">
              <div className="progress-stats-head">
                <span className="label">打卡进度</span>
                <span className="mono text-muted-sm">剩余 {daysLeft} 天</span>
              </div>
              <div
                className="progress-bar-lg"
                role="progressbar"
                aria-valuenow={Math.round(pct)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`完成 ${pct.toFixed(0)}%`}
              >
                <div className="progress-fill" style={{ width: `${pct}%` }} />
              </div>
              <div className="progress-mini-stats">
                <div className="progress-mini-stat">
                  <span className="label">通过</span>
                  <span className="val jade">{verdictPass.toString()}</span>
                </div>
                <div className="progress-mini-stat">
                  <span className="label">失败</span>
                  <span className="val fail">{verdictFail.toString()}</span>
                </div>
                <div className="progress-mini-stat">
                  <span className="label">结束</span>
                  <span className="val text-dim-sm">
                    {schedule ? formatShortDate(schedule.endTime) : '—'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {totalVerdict > 0 ? (
          <CheckinTimeline pactId={pactId} total={totalVerdict} withPhotos={!!iAmWitness} />
        ) : state === 2 ? (
          <div className="checkin-history">
            <div className="checkin-history-head">
              <h2>打卡记录</h2>
            </div>
            <p className="subtitle text-subtle">
              暂无打卡。请确认链接中的承诺编号（#{pactId.toString()}）与承诺人正在打卡的编号一致。
            </p>
          </div>
        ) : null}

        {iAmWitness && latestVerdict && (
          <div className={`result-banner ${latestVerdict.pass ? 'is-pass' : 'is-fail'}`} role="status">
            <div className={`result-icon ${latestVerdict.pass ? 'pass' : 'fail'}`} aria-hidden="true">
              {latestVerdict.pass ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              )}
            </div>
            <div className="result-body">
              <p className="result-title">
                第 {totalVerdict} 次 · {latestVerdict.pass ? 'AI 判通过' : 'AI 判未通过'}
                {latestVerdict.reReview ? ' · 已旗舰复核' : ''}
              </p>
              {latestVerdict.reasoning && <p className="result-sub">{latestVerdict.reasoning}</p>}
            </div>
          </div>
        )}

        {iAmWitness && latestVerdict && (
          <div className="card card-evidence">
            <p className="label section-label">打卡证据</p>
            <img
              src={`${JUDGE_URL}/verdict/${pactId}/${totalVerdict - 1}/photo`}
              alt="打卡证据"
              className="evidence-photo"
              onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
            />
          </div>
        )}

        {iAmWitness ? (
          <div className="status-panel accent">
            <div className="status-mark jade" aria-hidden="true">见</div>
            <h2>你正在见证这个承诺</h2>
            <p className="status-lede">每次裁决你都会看到。Ta 知道你在看着。</p>
            <div className="witness-action-row">
              <button type="button" className="btn btn-ghost" disabled title="即将上线">
                拍一拍
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleDispute}
                disabled={busy || totalVerdict === 0 || disputed || !!latestVerdict?.reReview}
              >
                {busy ? (
                  <span className="spinner" />
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M12 3v18M3 12h18" />
                    </svg>
                    {(disputed || latestVerdict?.reReview) ? '已质疑' : '质疑最近裁决'}
                  </>
                )}
              </button>
            </div>
            <p className="label witness-hint">
              {(disputed || latestVerdict?.reReview)
                ? '已用过质疑（每约一次）；复核结果见上方裁决'
                : totalVerdict === 0
                  ? '暂无裁决可质疑'
                  : '看过上方裁决后，若有疑义可质疑 → 触发 AI 旗舰模型复核（每约一次）'}
            </p>
          </div>
        ) : witnessBound ? (
          <div className="status-panel">
            <div className="status-icon-lg" aria-hidden="true">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
              </svg>
            </div>
            <h2>已有见证人</h2>
            <p className="status-lede">该承诺的见证位已被占用 · {short(witness as string)}</p>
          </div>
        ) : (
          <div className="invite-card">
            <p className="invite-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={{ verticalAlign: -2, marginRight: 6 }}>
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              朋友邀请你见证
            </p>
            <p className="invite-lede">
              绑定后你能旁观每日进度——你的注视就是 Ta 的动力。争议时可触发 AI 旗舰复核。
            </p>
            <button type="button" className="btn btn-primary btn-block" onClick={handleBind} disabled={busy || !ready}>
              {busy ? (
                <>
                  <span className="spinner" /> 处理中...
                </>
              ) : authenticated ? (
                '绑定为见证人'
              ) : (
                '登录并见证'
              )}
            </button>
          </div>
        )}

        {authenticated && (
          <button type="button" className="btn btn-ghost btn-block witness-footer-cta" onClick={() => nav('/dashboard')}>
            去我的承诺
          </button>
        )}
      </main>
    </div>
  )
}
