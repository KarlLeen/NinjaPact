import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { usePrivy } from '@privy-io/react-auth'
import { useAccount, useReadContract, useWriteContract } from 'wagmi'
import { formatUnits } from 'viem'
import {
  NINJA_PACT_ABI, NINJA_PACT_ADDRESS, MOCK_USD_ABI, MOCK_USD_ADDRESS, JUDGE_URL,
  STATE, STATE_LABEL, STATE_CLASS,
} from '../lib/contracts'
import { ZERO_ADDRESS } from '../lib/witness'
import { fetchTermsText } from '../lib/terms'
import { betLink, getBetSecret } from '../lib/bet'
import { AcceptList, DetailTopNav, InviteCardBlock, StatRow, StatusPanel, SummaryCard, WaitUserIcon, WaitSpinnerIcon } from '../components/PactUi'
import { useToast } from '../lib/toast'
import { waitReceipt } from '../lib/tx'

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
      await waitReceipt(approveTx)

      toast('接受对赌并押注...', 'info')
      const hash = await writeContractAsync({
        abi: NINJA_PACT_ABI, address: NINJA_PACT_ADDRESS,
        functionName: 'joinCommitment', args: [pactId, secret as `0x${string}`],
      })
      await waitReceipt(hash)
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

  const creatorSideLabel = yesIsCreator ? 'YES · 会发生' : 'NO · 不会发生'
  const opponentSideLabel = yesIsCreator ? 'NO · 不会发生' : 'YES · 会发生'
  const mySideYes = iAmCreator ? yesIsCreator : !yesIsCreator
  const endDateStr = endTime > 0 ? new Date(endTime * 1000).toLocaleDateString('zh-CN') : '—'

  const ruleItems = [
    '事件必须可客观查证（公开数据源、链上指标等）',
    '截止日由 AI 裁判对照公开事实裁定 YES 或 NO',
    '赢家通吃双方质押；裁判超时则各退各（安全网）',
  ]

  if (state === STATE.Settled && result) {
    const settledHeroClass = iWon ? 'detail-hero--settled-win' : 'detail-hero--settled-loss'
    const markChar = iWon ? '胜' : '负'
    const amountClass = iWon ? 'win-amount' : 'loss-amount'
    const amountPrefix = iWon ? '+' : '−'
    return (
      <>
        <div className="app-shell screen screen-detail">
          <DetailTopNav onBack={() => nav('/dashboard')} badge={<span className={`state-badge ${STATE_CLASS[state]}`}>{STATE_LABEL[state]}</span>} />
          <main className="detail-layout" aria-label="对赌结算">
            <div className="detail-main">
              <div className={`detail-hero ${settledHeroClass}`}>
                <div className={`settle-${iWon ? 'win' : 'loss'}-mark`} aria-hidden="true">{markChar}</div>
                <p className="label">裁定 {result.outcome ? 'YES' : 'NO'}</p>
                <h1 className="title">{iWon ? '你赢了' : '你输了'}</h1>
                <p className={`${amountClass} mono`} aria-live="polite">{amountPrefix}{formatUnits(iWon ? pot : stake, 6)} mUSD</p>
                <p className="evidence-lede">{question}</p>
                <div className="bet-sides">
                  <div className={`bet-side yes${mySideYes ? (iWon ? ' is-winner' : ' is-loser') : (!iWon ? ' is-winner' : ' is-loser')}`}>
                    <p className="label">{iAmCreator ? '发起方 · 我' : '发起方'}</p>
                    <p className="bet-side-label">{creatorSideLabel}</p>
                    <p className="bet-side-stake mono">{formatUnits(stake, 6)} mUSD</p>
                  </div>
                  <div className="bet-vs" aria-hidden="true">VS</div>
                  <div className={`bet-side no${!mySideYes ? (iWon ? ' is-winner' : ' is-loser') : (!iWon ? ' is-winner' : ' is-loser')}`}>
                    <p className="label">{iAmOpponent ? '对手 · 我' : '对手'}</p>
                    <p className="bet-side-label">{opponentSideLabel}</p>
                    <p className="bet-side-stake mono">{formatUnits(stake, 6)} mUSD</p>
                  </div>
                </div>
              </div>
              <div className={`result-banner ${iWon ? 'is-win' : 'is-fail'}`} role="status">
                <p className="result-title">链上已结算 · {new Date(result.resolvedAt).toLocaleString('zh-CN')}</p>
                <p className="result-sub">{result.reasoning}</p>
              </div>
              <section className="checklist-card" aria-label="结算流水">
                <div className="checkin-history-head"><h2>结算流水</h2></div>
                <ol className="timeline-v2">
                  <li className="timeline-v2-item pass"><div className="timeline-v2-body"><p className="timeline-v2-desc">发起对赌 · {formatUnits(stake, 6)} mUSD</p></div><span className="timeline-v2-status pass">已押注</span></li>
                  <li className="timeline-v2-item pass"><div className="timeline-v2-body"><p className="timeline-v2-desc">对手加入 · {formatUnits(stake, 6)} mUSD</p></div><span className="timeline-v2-status pass">已满员</span></li>
                  <li className="timeline-v2-item pass"><div className="timeline-v2-body"><p className="timeline-v2-desc">裁定 {result.outcome ? 'YES' : 'NO'} · {result.reasoning.slice(0, 40)}…</p></div><span className={`timeline-v2-status ${iWon ? 'pass' : 'fail'}`}>{iWon ? '你赢了' : '你输了'}</span></li>
                </ol>
              </section>
            </div>
            <aside className="detail-sidebar desktop-only">
              <div className="sidebar-card">
                <p className="label section-label">结算摘要</p>
                <dl className="contract-dl">
                  <div className="contract-row"><dt>裁定结果</dt><dd className={`mono ${result.outcome ? 'text-jade' : 'text-fail'}`}>{result.outcome ? 'YES' : 'NO'}</dd></div>
                  <div className="contract-row"><dt>奖池</dt><dd className="mono-gold">{formatUnits(pot, 6)} mUSD</dd></div>
                  <div className="contract-row"><dt>截止日</dt><dd className="mono text-dim">{endDateStr}</dd></div>
                </dl>
              </div>
              <div className="sidebar-actions">
                <a href={`https://testnet.blockscout.injective.network/tx/${result.txHash}`} target="_blank" rel="noreferrer" className="btn btn-ghost btn-block btn-sm">查看裁决交易</a>
                <button type="button" className="btn btn-primary btn-block btn-sm" onClick={() => nav('/create')}>再发起对赌</button>
              </div>
            </aside>
          </main>
        </div>
        <div className="bottom-bar mobile-only">
          <button type="button" className="btn btn-primary btn-block" onClick={() => nav('/create')}>再发起对赌</button>
        </div>
      </>
    )
  }

  const isWaitOpponent = iAmCreator && state === STATE.AwaitingParties && !!inviteSecret
  const isJoinBet = state === STATE.AwaitingParties && !opponentBound && !iAmCreator
  const isActiveBet = state === STATE.Active && opponentBound

  function renderBetSides(opponentEmpty = false) {
    return (
      <div className="bet-sides">
        <div className={`bet-side yes${iAmCreator ? ' highlight' : ''}`}>
          <p className="label">{iAmCreator ? '发起方 · 我' : '发起方'}</p>
          <p className="bet-side-label">{creatorSideLabel}</p>
          <p className="bet-side-stake mono">{formatUnits(stake, 6)} mUSD</p>
        </div>
        <div className="bet-vs" aria-hidden="true">VS</div>
        <div className={`bet-side no${opponentEmpty ? ' empty' : ''}${iAmOpponent ? ' highlight' : ''}`}>
          <p className="label">{opponentEmpty ? '对手' : iAmOpponent ? '对手 · 我' : short(opponent)}</p>
          <p className="bet-side-label">{opponentEmpty ? '待加入' : opponentSideLabel}</p>
          <p className="bet-side-stake mono">{opponentEmpty ? '—' : `${formatUnits(stake, 6)} mUSD`}</p>
        </div>
      </div>
    )
  }

  if (isWaitOpponent || isJoinBet || isActiveBet) {
    return (
      <div className="app-shell screen screen-wait">
        <DetailTopNav onBack={() => nav('/dashboard')} badge={<span className={`state-badge ${STATE_CLASS[state]}`}>{STATE_LABEL[state]}</span>} />
        <main className="wait-layout" aria-label="对赌详情">
          <SummaryCard>
            <span className="kind-tag mode-bet">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2" /><circle cx="9" cy="9" r="1" fill="currentColor" /><circle cx="15" cy="15" r="1" fill="currentColor" /></svg>
              公共事件对赌 · #{pactId.toString()}
            </span>
            <h1 className="title">{question || `对赌 #${pactId.toString()}`}</h1>
            {renderBetSides(isWaitOpponent)}
            {isJoinBet && (
              <>
                <StatRow label="裁定截止" value={endDateStr} />
                <StatRow label="赢家通吃" value={`${formatUnits(pot, 6)} mUSD`} valueClass="text-gold" />
              </>
            )}
          </SummaryCard>

          {isWaitOpponent && inviteSecret && (
            <InviteCardBlock
              title="对手邀请"
              lede={`把链接发给对手。对方押等额 ${formatUnits(stake, 6)} mUSD 接受后，对赌才生效。到期由 AI 裁判裁定 YES/NO。`}
              buttonLabel="复制邀请链接"
              copiedLabel="已复制"
              onCopy={copyInvite}
              copied={copied}
            />
          )}

          {isWaitOpponent && (
            <StatusPanel
              icon={<WaitUserIcon />}
              title="等待对手加入"
              lede={`你已押 ${yesIsCreator ? 'YES' : 'NO'} 并锁定 ${formatUnits(stake, 6)} mUSD。对手接受并押 ${yesIsCreator ? 'NO' : 'YES'} 后，奖池变为 ${formatUnits(pot, 6)} mUSD。`}
            />
          )}

          {isJoinBet && (
            <StatusPanel
              variant="accent"
              lede={`对方押「${creatorSideLabel}」并锁定了 ${formatUnits(stake, 6)} mUSD。你押「${opponentSideLabel}」，押等额 ${formatUnits(stake, 6)} mUSD 接受。到期由 AI 裁判查证结果，赢家拿走奖池。`}
            >
              <button type="button" className="btn btn-primary btn-block" onClick={handleJoin} disabled={busy || !ready}>
                {busy ? <><span className="spinner" /> 处理中...</> : authenticated ? `押 ${formatUnits(stake, 6)} mUSD 接受` : '登录并接受'}
              </button>
            </StatusPanel>
          )}

          {isActiveBet && (
            <>
              <div className="result-banner is-bet-wait" role="status">
                <div className="result-icon">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                </div>
                <div>
                  <p className="result-title">{deadlinePassed ? 'AI 裁判正在查证并裁定' : '双方已押注，等待裁定'}</p>
                  <p className="result-sub">截止 {endDateStr} · 到期由 AI 裁判查证 YES/NO 并链上结算</p>
                </div>
              </div>
              <StatusPanel
                icon={<WaitSpinnerIcon />}
                lede="事件结果将在截止日后由 AI 裁判对照公开数据源裁定。裁判超时则各退各（安全网）。"
              />
            </>
          )}

          <section className="checklist-card" aria-label="对赌规则">
            <div className="checkin-history-head"><h2>裁定规则</h2></div>
            <AcceptList items={ruleItems} numbered />
          </section>
        </main>
      </div>
    )
  }

  return (
    <div className="app-shell screen screen-detail">
      <DetailTopNav onBack={() => nav('/dashboard')} badge={<span className={`state-badge ${STATE_CLASS[state]}`}>{STATE_LABEL[state]}</span>} />

      <main className="detail-layout" aria-label="对赌详情">
        <div className="detail-main">
          <div className="detail-hero mode-bet-hero">
            <div className="detail-meta-row">
              <span className="kind-tag mode-bet">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2" /><circle cx="9" cy="9" r="1" fill="currentColor" /><circle cx="15" cy="15" r="1" fill="currentColor" /></svg>
                公共事件对赌 · #{pactId.toString()}
              </span>
              <span className="stake-tag">奖池 {formatUnits(opponentBound ? pot : stake, 6)} mUSD</span>
            </div>
            <h1 className="title">{question || `对赌 #${pactId.toString()}`}</h1>
            <div className="bet-sides">
              <div className={`bet-side yes${iAmCreator ? ' highlight' : ''}`}>
                <p className="label">{iAmCreator ? '发起方 · 我' : '发起方'}</p>
                <p className="bet-side-label">{creatorSideLabel}</p>
                <p className="bet-side-stake mono">{formatUnits(stake, 6)} mUSD</p>
              </div>
              <div className="bet-vs" aria-hidden="true">VS</div>
              <div className={`bet-side no${iAmOpponent ? ' highlight' : ''}`}>
                <p className="label">{opponentBound ? (iAmOpponent ? '对手 · 我' : short(opponent)) : '对手'}</p>
                <p className="bet-side-label">{opponentSideLabel}</p>
                <p className="bet-side-stake mono">{opponentBound ? `${formatUnits(stake, 6)} mUSD` : '待加入'}</p>
              </div>
            </div>
          </div>

          {state === STATE.Settled && !result && (
            <div className="status-panel">
              <div className="status-mark">终</div>
              <h2>对赌已结束</h2>
              <p className="status-lede">裁判未在期限内裁定，本金已原路退回双方。</p>
            </div>
          )}

          <section className="checklist-card" aria-label="对赌规则">
            <div className="checkin-history-head"><h2>裁定规则</h2></div>
            <AcceptList items={ruleItems} numbered />
          </section>
        </div>

        <aside className="detail-sidebar desktop-only">
          <div className="sidebar-card">
            <p className="label section-label">对赌信息</p>
            <dl className="contract-dl">
              <div className="contract-row"><dt>单方押注</dt><dd className="mono-gold">{formatUnits(stake, 6)} mUSD</dd></div>
              <div className="contract-row"><dt>奖池</dt><dd className="mono-gold">{formatUnits(opponentBound ? pot : stake * 2n, 6)} mUSD</dd></div>
              <div className="contract-row"><dt>裁定截止</dt><dd className="mono text-dim">{endDateStr}</dd></div>
            </dl>
          </div>
        </aside>
      </main>
    </div>
  )
}
