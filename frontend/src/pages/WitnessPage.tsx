import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { usePrivy } from '@privy-io/react-auth'
import { useAccount, useReadContract, useWriteContract, usePublicClient } from 'wagmi'
import { formatUnits } from 'viem'
import {
  NINJA_PACT_ABI, NINJA_PACT_ADDRESS, JUDGE_URL,
  STATE_LABEL, STATE_CLASS,
} from '../lib/contracts'
import { ZERO_ADDRESS } from '../lib/witness'
import { fetchTermsText, parseGoal } from '../lib/terms'
import { useToast } from '../lib/toast'

function short(a?: string) {
  return a ? `${a.slice(0, 6)}...${a.slice(-4)}` : ''
}

export function WitnessPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const { ready, authenticated, login } = usePrivy()
  const { address } = useAccount()
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()
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
  })
  const { data: policy } = useReadContract({
    abi: NINJA_PACT_ABI, address: NINJA_PACT_ADDRESS,
    functionName: 'getEvidencePolicy', args: [pactId],
  })
  const { data: parties } = useReadContract({
    abi: NINJA_PACT_ABI, address: NINJA_PACT_ADDRESS,
    functionName: 'getParties', args: [pactId],
  })

  useEffect(() => {
    let alive = true
    fetchTermsText(pactId).then(t => { if (alive) setGoal(parseGoal(t)) })
    return () => { alive = false }
  }, [pactId])

  // Fetch the latest verdict so the witness can review before disputing
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

  const witnessBound = witness && witness.toLowerCase() !== ZERO_ADDRESS
  const iAmWitness = witnessBound && address && witness.toLowerCase() === address.toLowerCase()

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
      await publicClient!.waitForTransactionReceipt({ hash })
      toast('已成为见证人 ', 'success')
      await refetch()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      toast(msg.includes('InvalidSecret') ? '邀请凭证无效或已被使用' : `失败：${msg.slice(0, 50)}`, 'error')
    } finally { setBusy(false) }
  }

  // Dispute the most recent judged day → triggers flagship AI re-review
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
      await publicClient!.waitForTransactionReceipt({ hash })
      localStorage.setItem(`pact_disputed_${pactId}`, '1')
      setDisputed(true)
      toast('已质疑，AI 旗舰模型复核中…', 'success')
      // Re-review lands a few seconds later; poll verdict + chain a couple times
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

  if (!exists) return (
    <div className="screen">
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>—</div>
        <p className="subtitle">找不到这个承诺</p>
      </div>
    </div>
  )

  return (
    <div className="screen">
      <div className="nav">
        <span className="title" style={{ fontSize: 18 }}>见证人</span>
        <span className={`state-badge ${STATE_CLASS[state]}`}>{STATE_LABEL[state]}</span>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="label" style={{ marginBottom: 4 }}>承诺 #{pactId.toString()} · {short(committer)}</div>
        <div style={{ fontWeight: 600, fontSize: 17, lineHeight: 1.4 }}>
          {goal ?? `承诺 #${pactId.toString()}`}
        </div>
        <div className="subtitle" style={{ marginTop: 8 }}>质押 {formatUnits(stake, 6)} mUSD</div>
      </div>

      {/* Progress (read-only) */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="label" style={{ marginBottom: 6 }}>打卡进度</div>
        <div className="progress-bar" style={{ marginBottom: 8 }}>
          <div className="progress-fill" style={{ width: `${Math.min(100, (totalVerdict / totalRequired) * 100)}%` }} />
        </div>
        <div className="stat-row">
          <span className="subtitle">完成</span>
          <span className="stat-value">{totalVerdict}/{totalRequired} 次</span>
        </div>
        <div className="stat-row">
          <span className="subtitle">通过 / 失败</span>
          <span className="stat-value">{verdictPass.toString()} / {verdictFail.toString()}</span>
        </div>
      </div>

      {/* Latest verdict — so the witness can review the evidence + AI verdict before disputing */}
      {iAmWitness && latestVerdict && (
        <div className="card" style={{ marginBottom: 16, borderColor: latestVerdict.pass ? 'var(--success)' : 'var(--fail)' }}>
          <div className="label" style={{ marginBottom: 8 }}>
            最近一次裁决（第 {totalVerdict} 次）{latestVerdict.reReview && ' · 已旗舰复核'}
          </div>
          <img
            src={`${JUDGE_URL}/verdict/${pactId}/${totalVerdict - 1}/photo`}
            alt="打卡证据"
            style={{ width: '100%', borderRadius: 8, marginBottom: 10, display: 'block' }}
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
          />
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {latestVerdict.pass ? 'AI 判：通过' : 'AI 判：未通过'}
          </div>
          <p className="subtitle" style={{ fontSize: 13 }}>{latestVerdict.reasoning}</p>
        </div>
      )}

      {/* Bind / status */}
      {iAmWitness ? (
        <div className="card" style={{ borderColor: 'var(--success)', textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 4 }}></div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>你正在见证这个承诺</div>
          <p className="subtitle" style={{ fontSize: 13 }}>每次裁决你都会看到。Ta 知道你在看着。</p>
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button className="btn btn-ghost" style={{ flex: 1, opacity: 0.6 }} disabled title="即将上线">拍一拍</button>
            <button
              className="btn btn-primary"
              style={{ flex: 1 }}
              onClick={handleDispute}
              disabled={busy || totalVerdict === 0 || disputed || !!latestVerdict?.reReview}
            >
              {busy ? <span className="spinner" /> : (disputed || latestVerdict?.reReview) ? '已质疑' : '⚖️ 质疑最近裁决'}
            </button>
          </div>
          <p className="label" style={{ marginTop: 8 }}>
            {(disputed || latestVerdict?.reReview) ? '已用过质疑（每约一次）；复核结果见上方裁决'
              : totalVerdict === 0 ? '暂无裁决可质疑'
              : '看过上方裁决后，若有疑义可质疑 → 触发 AI 旗舰模型复核（每约一次）'}
          </p>
        </div>
      ) : witnessBound ? (
        <div className="card" style={{ textAlign: 'center' }}>
          <p className="subtitle">该承诺已有见证人（{short(witness)}）</p>
        </div>
      ) : (
        <div className="card" style={{ borderColor: 'var(--accent)', textAlign: 'center' }}>
          <p className="subtitle" style={{ marginBottom: 14 }}>
            朋友邀请你见证 Ta 的承诺。绑定后你能旁观每日进度——你的注视就是 Ta 的动力。
          </p>
          <button className="btn btn-primary btn-block" onClick={handleBind} disabled={busy || !ready}>
            {busy ? <><span className="spinner" /> 处理中...</> : authenticated ? '绑定为见证人 ' : '登录并见证 →'}
          </button>
        </div>
      )}

      {authenticated && (
        <button className="btn btn-ghost btn-block" style={{ marginTop: 16 }} onClick={() => nav('/dashboard')}>
          去我的承诺
        </button>
      )}
    </div>
  )
}
