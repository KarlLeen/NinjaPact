import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { usePrivy } from '@privy-io/react-auth'
import { useAccount, useReadContract, useWriteContract, usePublicClient } from 'wagmi'
import { formatUnits } from 'viem'
import {
  NINJA_PACT_ABI, NINJA_PACT_ADDRESS, MOCK_USD_ABI, MOCK_USD_ADDRESS, JUDGE_URL,
  STATE, STATE_LABEL, STATE_CLASS,
} from '../lib/contracts'
import { ZERO_ADDRESS } from '../lib/witness'
import { fetchTermsText } from '../lib/terms'
import { betLink, getBetSecret } from '../lib/bet'
import { useToast } from '../lib/toast'

function short(a?: string) {
  return a ? `${a.slice(0, 6)}...${a.slice(-4)}` : ''
}

interface BetResult {
  outcome: boolean
  confidence: number
  reasoning: string
  txHash: string
  resolvedAt: number
}

export function BetPage() {
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
  const [question, setQuestion] = useState('')
  const [result, setResult] = useState<BetResult | null>(null)
  const [copied, setCopied] = useState(false)

  const { data: commitment, refetch } = useReadContract({
    abi: NINJA_PACT_ABI, address: NINJA_PACT_ADDRESS, functionName: 'getCommitment', args: [pactId],
  })
  const { data: parties, refetch: refetchParties } = useReadContract({
    abi: NINJA_PACT_ABI, address: NINJA_PACT_ADDRESS, functionName: 'getParties', args: [pactId],
  })
  const { data: schedule } = useReadContract({
    abi: NINJA_PACT_ABI, address: NINJA_PACT_ADDRESS, functionName: 'getSchedule', args: [pactId],
  })
  const { data: creatorBetsYes } = useReadContract({
    abi: NINJA_PACT_ABI, address: NINJA_PACT_ADDRESS, functionName: 'getCreatorBetsYes', args: [pactId],
  })

  useEffect(() => {
    let alive = true
    fetchTermsText(pactId).then(t => {
      if (!alive || !t) return
      try { setQuestion((JSON.parse(t) as { goal?: string }).goal ?? t) } catch { setQuestion(t) }
    })
    return () => { alive = false }
  }, [pactId])

  const state = Number(commitment?.[5] ?? 0)

  // Once settled, pull the Judge's recorded ruling (404 = timeout refund, no ruling)
  useEffect(() => {
    if (state !== STATE.Settled) return
    let alive = true
    fetch(`${JUDGE_URL}/bet-result/${pactId.toString()}`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (alive && j) setResult(j as BetResult) })
      .catch(() => {})
    return () => { alive = false }
  }, [state, pactId])

  function refetchAll() { void refetch(); void refetchParties() }

  if (!commitment) return <div className="screen-full"><div className="spinner" /></div>

  const cid = commitment[0]
  const exists = Number(cid) !== 0
  const creator = parties?.[0]?.addr as string | undefined
  const stake = parties?.[0]?.stake ?? 0n
  const opponent = parties?.[1]?.addr as string | undefined
  const opponentBound = !!opponent && opponent.toLowerCase() !== ZERO_ADDRESS
  const iAmCreator = !!creator && !!address && creator.toLowerCase() === address.toLowerCase()
  const iAmOpponent = opponentBound && !!address && opponent!.toLowerCase() === address.toLowerCase()
  const yesIsCreator = Boolean(creatorBetsYes)
  const endTime = Number(schedule?.endTime ?? 0)
  const deadlinePassed = endTime > 0 && Date.now() / 1000 >= endTime
  const pot = stake * 2n
  const inviteSecret = iAmCreator ? getBetSecret(pactId) : null

  // Resolved winner (chain truth): the side matching the outcome wins.
  const winner = result ? (result.outcome === yesIsCreator ? creator : opponent) : undefined
  const iWon = !!winner && !!address && winner.toLowerCase() === address.toLowerCase()

  function copyInvite() {
    if (!inviteSecret) return
    navigator.clipboard.writeText(betLink(pactId, inviteSecret))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleJoin() {
    if (!authenticated) { login(); return }
    if (!secret) { toast('邀请链接缺少凭证', 'error'); return }
    setBusy(true)
    try {
      toast('授权押注代币...', 'info')
      const approveTx = await writeContractAsync({
        abi: MOCK_USD_ABI, address: MOCK_USD_ADDRESS, functionName: 'approve',
        args: [NINJA_PACT_ADDRESS, stake],
      })
      await publicClient!.waitForTransactionReceipt({ hash: approveTx })

      toast('接受对赌并押注...', 'info')
      const hash = await writeContractAsync({
        abi: NINJA_PACT_ABI, address: NINJA_PACT_ADDRESS,
        functionName: 'joinCommitment', args: [pactId, secret as `0x${string}`],
      })
      await publicClient!.waitForTransactionReceipt({ hash })
      toast('已加入对赌 等待裁定', 'success')
      refetchAll()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      toast(msg.includes('InvalidSecret') ? '邀请凭证无效或已被使用' : `失败：${msg.slice(0, 50)}`, 'error')
    } finally { setBusy(false) }
  }

  if (!exists) return (
    <div className="screen">
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>—</div>
        <p className="subtitle">找不到这个对赌</p>
      </div>
    </div>
  )

  const creatorSideLabel = yesIsCreator ? 'YES 会发生' : 'NO 不会发生'
  const opponentSideLabel = yesIsCreator ? 'NO 不会发生' : 'YES 会发生'

  return (
    <div className="screen">
      <div className="nav">
        <span className="title" style={{ fontSize: 18 }}>公共事件对赌</span>
        <span className={`state-badge ${STATE_CLASS[state]}`}>{STATE_LABEL[state]}</span>
      </div>

      {/* Question + sides */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="label" style={{ marginBottom: 4 }}>对赌 #{pactId.toString()}</div>
        <div style={{ fontWeight: 600, fontSize: 17, lineHeight: 1.4 }}>{question || `对赌 #${pactId.toString()}`}</div>
        <div className="divider" style={{ margin: '12px 0' }} />
        <div className="stat-row">
          <span className="subtitle">发起方 {short(creator)}{iAmCreator ? '（我）' : ''}</span>
          <span className="stat-value" style={{ color: 'var(--success)' }}>{creatorSideLabel}</span>
        </div>
        <div className="stat-row">
          <span className="subtitle">对手 {opponentBound ? short(opponent) : '待加入'}{iAmOpponent ? '（我）' : ''}</span>
          <span className="stat-value" style={{ color: 'var(--fail)' }}>{opponentSideLabel}</span>
        </div>
        <div className="stat-row">
          <span className="subtitle">奖池（赢家通吃）</span>
          <span className="stat-value" style={{ color: 'var(--accent)', fontSize: 18 }}>{formatUnits(pot, 6)} mUSD</span>
        </div>
        {endTime > 0 && (
          <div className="stat-row">
            <span className="subtitle">裁定截止</span>
            <span className="stat-value">{new Date(endTime * 1000).toLocaleString('zh-CN')}</span>
          </div>
        )}
      </div>

      {/* Creator: invite link to share with the opponent */}
      {iAmCreator && state === STATE.AwaitingParties && inviteSecret && (
        <div className="card" style={{ borderColor: 'var(--accent)', marginBottom: 16 }}>
          <div className="label" style={{ marginBottom: 8 }}>把对手邀请链接发出去（押 {formatUnits(stake, 6)} mUSD 接受）</div>
          <button className="btn btn-primary btn-block" onClick={copyInvite}>
            {copied ? '已复制' : '复制邀请链接'}
          </button>
        </div>
      )}

      {/* Opponent: accept + stake */}
      {state === STATE.AwaitingParties && !opponentBound && !iAmCreator && (
        <div className="card" style={{ borderColor: 'var(--accent)', textAlign: 'center' }}>
          <p className="subtitle" style={{ marginBottom: 14 }}>
            对方押「{creatorSideLabel}」并锁定了 {formatUnits(stake, 6)} mUSD。你押「{opponentSideLabel}」,
            押等额 {formatUnits(stake, 6)} mUSD 接受。到期由 AI 裁判查证结果,赢家拿走 {formatUnits(pot, 6)} mUSD。
          </p>
          <button className="btn btn-primary btn-block" onClick={handleJoin} disabled={busy || !ready}>
            {busy ? <><span className="spinner" /> 处理中...</> : authenticated ? `押 ${formatUnits(stake, 6)} mUSD 接受 ` : '登录并接受 →'}
          </button>
        </div>
      )}

      {/* Active: waiting for resolution */}
      {state === STATE.Active && (
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 28, marginBottom: 6 }}>⏳</div>
          <p className="subtitle">
            {deadlinePassed
              ? 'AI 裁判正在查证事件结果并裁定…（稍后刷新查看）'
              : '双方已押注。到截止日由 AI 裁判(事件预言机)查证 YES/NO 并签名上链结算。'}
          </p>
        </div>
      )}

      {/* Settled: result */}
      {state === STATE.Settled && (
        result ? (
          <div className="card" style={{ textAlign: 'center', borderColor: iWon ? 'var(--success)' : 'var(--border)' }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>{iWon ? '胜' : '负'}</div>
            <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 4 }}>
              裁定结果：{result.outcome ? 'YES（发生）' : 'NO（未发生）'}
            </div>
            <div style={{ marginBottom: 10 }}>
              赢家 {short(winner)}{iWon ? '（我）' : ''} 获得 {formatUnits(pot, 6)} mUSD
            </div>
            <p className="subtitle" style={{ fontSize: 13, whiteSpace: 'pre-wrap', textAlign: 'left' }}>
              ⚖️ 裁判理由：{result.reasoning}
            </p>
            <a
              href={`https://testnet.blockscout.injective.network/tx/${result.txHash}`}
              target="_blank" rel="noreferrer"
              className="subtitle" style={{ fontSize: 12, display: 'inline-block', marginTop: 10, color: 'var(--accent)' }}
            >
              查看裁决交易 ↗
            </a>
          </div>
        ) : (
          <div className="card" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>终</div>
            <div style={{ fontWeight: 600 }}>对赌已结束</div>
            <p className="subtitle" style={{ fontSize: 13, marginTop: 6 }}>
              裁判未在期限内裁定，本金已原路退回双方（失败不罚没的安全网）。
            </p>
          </div>
        )
      )}

      {authenticated && (
        <button className="btn btn-ghost btn-block" style={{ marginTop: 16 }} onClick={() => nav('/dashboard')}>
          去我的承诺
        </button>
      )}
    </div>
  )
}
