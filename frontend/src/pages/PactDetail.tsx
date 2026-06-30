import { useState, useMemo, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAccount, useReadContract, useWriteContract, useSignMessage } from 'wagmi'
import { formatUnits, type Address } from 'viem'
import {
  NINJA_PACT_ABI, MOCK_USD_ABI, BADGE_ABI,
  NINJA_PACT_ADDRESS, MOCK_USD_ADDRESS, BADGE_ADDRESS,
  JUDGE_ADDRESS, JUDGE_URL,
  STATE, STATE_LABEL, STATE_CLASS, MODE,
} from '../lib/contracts'
import { Camera } from '../components/Camera'
import { RateJudge } from '../components/RateJudge'
import { useToast } from '../lib/toast'
import { fetchTermsText } from '../lib/terms'
import { fetchWithTimeout } from '../lib/fetch'
import { compressDataUrl } from '../lib/image'
import { getJudgeJwt, loadJwt } from '../lib/judgeAuth'
import { waitReceipt } from '../lib/tx'
import { getWitnessSecret, witnessLink, ZERO_ADDRESS } from '../lib/witness'
import { DetailTopNav, SoloKindTag, CheckinTimeline } from '../components/PactUi'
import { EscrowDetail } from './EscrowDetail'

function formatDate(ts: bigint): string {
  return new Date(Number(ts) * 1000).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatShortDate(ts: bigint): string {
  const d = new Date(Number(ts) * 1000)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${m}-${day}`
}

const PROGRESS_RING_R = 42
const PROGRESS_RING_C = 2 * Math.PI * PROGRESS_RING_R

function formatCountdown(lockUntil: bigint): string {
  const ms = Number(lockUntil) * 1000 - Date.now()
  if (ms <= 0) return '已解锁'
  const d = Math.floor(ms / 86400000)
  const h = Math.floor((ms % 86400000) / 3600000)
  return `${d} 天 ${h} 小时`
}

// Random challenge instruction for liveness verification
function makeChallenge(): string {
  const n = Math.floor(Math.random() * 9) + 1
  const actions = ['比出数字 ' + n, '竖起大拇指', '张开手掌', '比出 V 字', '握拳']
  return actions[Math.floor(Math.random() * actions.length)]
}

export function PactDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const { address } = useAccount()
  const { writeContractAsync } = useWriteContract()
  const { signMessageAsync } = useSignMessage()
  const toast = useToast()

  const pactId = BigInt(id ?? '0')

  const [showCamera, setShowCamera] = useState(false)
  const [busy, setBusy] = useState(false)
  const [aiResult, setAiResult] = useState<{ pass: boolean; reasoning: string } | null>(null)
  const [showRedeem, setShowRedeem] = useState(false)
  const [submittingChallenge, setSubmittingChallenge] = useState<string | null>(null)

  // Generate challenge once per camera session
  const [challenge, setChallenge] = useState(() => makeChallenge())

  // Terms text (off-chain): localStorage cache → Judge server fallback
  const [termsText, setTermsText] = useState(() => localStorage.getItem(`pact_terms_${pactId}`) ?? '')
  useEffect(() => {
    if (termsText) return
    let alive = true
    fetchTermsText(pactId).then(t => { if (alive && t) setTermsText(t) })
    return () => { alive = false }
  }, [pactId, termsText])
  // Human-readable goal parsed from the stored terms (for the header)
  const goalText = useMemo(() => {
    try { return (JSON.parse(termsText) as { goal?: string }).goal?.trim() || '' }
    catch { return '' }
  }, [termsText])

  const { data: commitment, refetch } = useReadContract({
    abi: NINJA_PACT_ABI,
    address: NINJA_PACT_ADDRESS,
    functionName: 'getCommitment',
    args: [pactId],
  })

  const { data: policy } = useReadContract({
    abi: NINJA_PACT_ABI,
    address: NINJA_PACT_ADDRESS,
    functionName: 'getEvidencePolicy',
    args: [pactId],
  })

  const { data: schedule } = useReadContract({
    abi: NINJA_PACT_ABI,
    address: NINJA_PACT_ADDRESS,
    functionName: 'getSchedule',
    args: [pactId],
  })

  const { data: parties } = useReadContract({
    abi: NINJA_PACT_ABI,
    address: NINJA_PACT_ADDRESS,
    functionName: 'getParties',
    args: [pactId],
  })

  const { data: badgeBalance } = useReadContract({
    abi: BADGE_ABI,
    address: BADGE_ADDRESS,
    functionName: 'balanceOf',
    args: address ? [address as Address] : undefined,
    query: { enabled: !!address },
  })

  const { data: userIds } = useReadContract({
    abi: NINJA_PACT_ABI,
    address: NINJA_PACT_ADDRESS,
    functionName: 'getUserCommitments',
    args: address ? [address as Address] : undefined,
    query: { enabled: !!address && showRedeem },
  })

  if (!commitment) return (
    <div className="screen-full">
      <div className="spinner" />
    </div>
  )

  // Escrow (DEPOSIT) commitments have a distinct payer-facing view.
  if (Number(commitment[1]) === MODE.DEPOSIT) return <EscrowDetail pactId={pactId} />

  const [, , judge, witness, , stateRaw, verdictPass, verdictFail, lockedUntil] = commitment
  const witnessBound = !!witness && witness.toLowerCase() !== ZERO_ADDRESS
  const witnessSecret = getWitnessSecret(pactId)
  const state = Number(stateRaw)
  const stake = parties?.[0]?.stake ?? 0n
  const restCards = policy?.restCards ?? 0
  const restUsed = policy?.restCardsUsed ?? 0
  const totalRequired = policy?.totalRequired ?? 1
  const failThreshold = policy?.failThreshold ?? 3
  const endTime = schedule?.endTime ?? 0n
  const now = BigInt(Math.floor(Date.now() / 1000))
  const canSettle = state === STATE.Active && now >= endTime

  // Verdicts are issued by the AI Judge service (signs + submits on-chain)
  const usesRealJudge = !JUDGE_ADDRESS || judge?.toLowerCase() === JUDGE_ADDRESS.toLowerCase()
  // User is a party → may submit evidence for judging
  const isParty = parties?.some(p => p.addr.toLowerCase() === address?.toLowerCase()) ?? false
  const canCheckin = state === STATE.Active && isParty

  // ── Checkin: upload evidence → Judge (GLM) verdict → signed on-chain ──────────
  async function handleCheckin(dataUrl: string) {
    setShowCamera(false)
    setBusy(true)
    setAiResult(null)
    setSubmittingChallenge(challenge)

    try {
      if (!loadJwt()) toast('需要签名验证身份（本会话仅一次）', 'info')
      const jwt = await getJudgeJwt(signMessageAsync, address)

      toast('压缩并上传证据…', 'info')
      const image = await compressDataUrl(dataUrl)

      toast('AI 裁决中（通常 10–30 秒）…', 'info')
      const resp = await fetchWithTimeout(`${JUDGE_URL}/evidence`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({
          commitmentId: pactId.toString(),
          image,
          termsText: termsText || `承诺 #${pactId} 的打卡验证`,
          challenge,
        }),
        timeoutMs: 120_000,
      })

      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({ error: resp.statusText })) as { error?: string }
        throw new Error(errBody.error ?? `服务错误 ${resp.status}`)
      }

      const result = await resp.json() as {
        pass: boolean
        useRestCard: boolean
        confidence: number
        reasoning: string
        txHash: string
      }

      setAiResult({ pass: result.pass, reasoning: result.reasoning })
      toast('等待上链确认…', 'info')
      await waitReceipt(result.txHash as `0x${string}`)

      toast(
        result.pass ? '打卡通过！' : result.useRestCard ? '已消耗免卡券' : '打卡失败',
        result.pass ? 'success' : 'error',
      )
      await refetch()
      setChallenge(makeChallenge()) // new challenge for next checkin
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('User rejected') || msg.includes('rejected')) {
        toast('已取消', 'error')
      } else {
        toast(`失败：${msg.slice(0, 60)}`, 'error')
      }
    } finally {
      setBusy(false)
      setSubmittingChallenge(null)
    }
  }

  // ── Settle ────────────────────────────────────────────────────────────────────
  async function handleSettle() {
    setBusy(true)
    try {
      toast('结算中...', 'info')
      const hash = await writeContractAsync({
        abi: NINJA_PACT_ABI,
        address: NINJA_PACT_ADDRESS,
        functionName: 'settle',
        args: [pactId],
      })
      await waitReceipt(hash)
      toast('结算成功', 'success')
      await refetch()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      toast(`失败：${msg.slice(0, 50)}`, 'error')
    } finally { setBusy(false) }
  }

  // ── Claim ─────────────────────────────────────────────────────────────────────
  async function handleClaim() {
    setBusy(true)
    try {
      toast('领取中...', 'info')
      const hash = await writeContractAsync({
        abi: NINJA_PACT_ABI,
        address: NINJA_PACT_ADDRESS,
        functionName: 'claim',
        args: [pactId],
      })
      await waitReceipt(hash)
      toast('已领取资金', 'success')
      await refetch()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      toast(`失败：${msg.slice(0, 50)}`, 'error')
    } finally { setBusy(false) }
  }

  // ── Redeem ────────────────────────────────────────────────────────────────────
  async function handleRedeem(successId: bigint) {
    setBusy(true)
    setShowRedeem(false)
    try {
      toast('救赎中...', 'info')
      const hash = await writeContractAsync({
        abi: NINJA_PACT_ABI,
        address: NINJA_PACT_ADDRESS,
        functionName: 'redeemLock',
        args: [pactId, successId],
      })
      await waitReceipt(hash)
      toast('救赎成功！可领取资金', 'success')
      await refetch()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      toast(`失败：${msg.slice(0, 50)}`, 'error')
    } finally { setBusy(false) }
  }

  // ── Fund (补救：createCommitment 成功但 fund 失败时用) ────────────────────────
  async function handleFund() {
    if (!address) return
    setBusy(true)
    try {
      toast('步骤 1/2：授权代币...', 'info')
      const approveTx = await writeContractAsync({
        abi: MOCK_USD_ABI,
        address: MOCK_USD_ADDRESS,
        functionName: 'approve',
        args: [NINJA_PACT_ADDRESS, stake],
      })
      await waitReceipt(approveTx)

      toast('步骤 2/2：质押资金...', 'info')
      const fundTx = await writeContractAsync({
        abi: NINJA_PACT_ABI,
        address: NINJA_PACT_ADDRESS,
        functionName: 'fund',
        args: [pactId],
      })
      await waitReceipt(fundTx)
      toast('质押成功，承诺已激活！', 'success')
      await refetch()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      toast(msg.includes('User rejected') ? '已取消' : `失败：${msg.slice(0, 60)}`, 'error')
    } finally { setBusy(false) }
  }

  // ── Mint test tokens ──────────────────────────────────────────────────────────
  async function handleMintTestTokens() {
    if (!address) return
    setBusy(true)
    try {
      toast('领取测试代币...', 'info')
      const hash = await writeContractAsync({
        abi: MOCK_USD_ABI,
        address: MOCK_USD_ADDRESS,
        functionName: 'mint',
        args: [address as Address, parseUnits('1000', 6)],
      })
      await waitReceipt(hash)
      toast('已领取 1000 mUSD', 'success')
    } catch {
      toast('领取失败', 'error')
    } finally { setBusy(false) }
  }

  // ── Fund (Created) ───────────────────────────────────────────────────────────
  if (state === STATE.Created) {
    const titleText = goalText || `承诺 #${pactId.toString()}`
    return (
      <div className="app-shell screen screen-detail">
        <DetailTopNav
          onBack={() => nav('/dashboard')}
          badge={<span className={`state-badge ${STATE_CLASS[state]}`}>{STATE_LABEL[state]}</span>}
        />
        <div className="summary-card">
          <SoloKindTag pactId={pactId} />
          <h1 className="title">{titleText}</h1>
          <div className="divider" style={{ margin: 'var(--sp-3) 0' }} />
          <dl className="contract-dl">
            <div className="contract-row">
              <dt className="subtitle">需质押</dt>
              <dd className="mono-gold">{formatUnits(stake, 6)} mUSD</dd>
            </div>
            <div className="contract-row">
              <dt className="subtitle">打卡次数</dt>
              <dd>{totalRequired.toString()} 次</dd>
            </div>
            <div className="contract-row">
              <dt className="subtitle">判负阈值</dt>
              <dd>{failThreshold.toString()} 次失败</dd>
            </div>
          </dl>
        </div>

        <div className="status-panel accent">
          <div className="status-mark gold">质</div>
          <h2>承诺已创建，质押尚未完成</h2>
          <p className="status-lede">确认质押后承诺才生效，Judge 才会开始计次。测试网可先领取 mUSD。</p>
          <button
            type="button"
            className="btn btn-ghost btn-block"
            onClick={handleMintTestTokens}
            disabled={busy}
            style={{ marginBottom: 'var(--sp-2)' }}
          >
            领取测试 mUSD（1000）
          </button>
          <button type="button" className="btn btn-primary btn-block" onClick={handleFund} disabled={busy}>
            {busy ? (
              <>
                <span className="spinner" /> 处理中...
              </>
            ) : (
              `确认质押 ${formatUnits(stake, 6)} mUSD`
            )}
          </button>
        </div>
      </div>
    )
  }

  // ── Success panel ─────────────────────────────────────────────────────────────
  if (state === STATE.Success || state === STATE.Settled) {
    return (
      <div className="app-shell screen screen-detail">
        <DetailTopNav onBack={() => nav('/dashboard')} badge={<span className={`state-badge ${STATE_CLASS[state]}`}>{STATE_LABEL[state]}</span>} />
        <div className="status-panel accent">
          <div className="status-mark jade">成</div>
          <h2>承诺已完成</h2>
          <p className="status-lede">质押 {formatUnits(stake, 6)} mUSD 已退还 · 守诺勋章已铸造</p>
          {badgeBalance !== undefined && (
            <p className="subtitle text-jade">持有勋章：{badgeBalance.toString()} 枚</p>
          )}
          <RateJudge id={pactId} scene="habit" outcome="success" />
          <button type="button" className="btn btn-primary btn-block" style={{ marginTop: 16 }} onClick={() => nav('/create')}>再立新约</button>
        </div>
        <div className="summary-card">
          <span className="kind-tag mode-solo">自律打卡 · 承诺 #{pactId.toString()}</span>
          <h2 className="title" style={{ fontSize: 16, marginTop: 8 }}>{goalText || `承诺 #${pactId.toString()}`}</h2>
        </div>
      </div>
    )
  }

  // ── Locked panel ──────────────────────────────────────────────────────────────
  if (state === STATE.Locked) {
    return (
      <div className="app-shell screen screen-detail">
        <DetailTopNav onBack={() => nav('/dashboard')} badge={<span className={`state-badge ${STATE_CLASS[state]}`}>{STATE_LABEL[state]}</span>} />
        <div className="status-panel fail">
          <div className="status-mark">锁</div>
          <h2>承诺未完成</h2>
          <p className="status-lede">{formatUnits(stake, 6)} mUSD 锁定 6 个月 · 解锁倒计时 {formatCountdown(lockedUntil)}</p>
          <div className="sidebar-card" style={{ marginTop: 16, textAlign: 'left' }}>
            <p className="label section-label">救赎之道</p>
            <p className="subtitle text-subtle">完成一个新承诺，用它救赎这个失败——立即解锁，无需等待 6 个月。</p>
            <button type="button" className="btn btn-primary btn-block" style={{ marginTop: 12 }} onClick={() => setShowRedeem(true)} disabled={busy}>用已成功的承诺救赎</button>
          </div>
          {showRedeem && (
            <div className="sidebar-card" style={{ marginTop: 12, textAlign: 'left' }}>
              <p className="label">选择一个已完成的承诺</p>
              {userIds?.filter(sid => sid !== pactId).length === 0 && (
                <p className="subtitle">没有可用的成功承诺，先去完成一个新约吧！</p>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                {userIds?.filter(sid => sid !== pactId).map(sid => (
                  <RedeemOption key={sid.toString()} successId={sid} onRedeem={handleRedeem} />
                ))}
              </div>
              <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 12 }} onClick={() => setShowRedeem(false)}>取消</button>
            </div>
          )}
          <RateJudge id={pactId} scene="habit" outcome="fail" />
        </div>
      </div>
    )
  }

  if (state === STATE.Claimable) {
    return (
      <div className="app-shell screen screen-detail">
        <DetailTopNav onBack={() => nav('/dashboard')} badge={<span className={`state-badge ${STATE_CLASS[state]}`}>{STATE_LABEL[state]}</span>} />
        <div className="status-panel">
          <div className="status-mark">解</div>
          <h2>可以领取了</h2>
          <p className="status-lede">{formatUnits(stake, 6)} mUSD 已解锁，可原路退还</p>
          <button type="button" className="btn btn-primary btn-block" onClick={handleClaim} disabled={busy}>
            {busy ? <><span className="spinner" /> 领取中...</> : `领取 ${formatUnits(stake, 6)} mUSD`}
          </button>
          <RateJudge id={pactId} scene="habit" outcome="fail" />
        </div>
      </div>
    )
  }

  // ── Active / main checkin panel ───────────────────────────────────────────────
  const totalVerdict = Number(verdictPass) + Number(verdictFail) + Number(restUsed)
  const pct = Math.min(100, (totalVerdict / Number(totalRequired)) * 100)
  const ringOffset = PROGRESS_RING_C * (1 - pct / 100)
  const daysLeft = schedule
    ? Math.max(0, Math.ceil((Number(schedule.endTime) * 1000 - Date.now()) / 86400000))
    : 0
  const titleText = goalText || `承诺 #${pactId.toString()}`
  const showMobileBar = !showCamera && canCheckin && !busy
  const progressPct = Math.min(100, (totalVerdict / Number(totalRequired)) * 100)

  // ── Wait Judge (submitted, AI reviewing) ──────────────────────────────────────
  if (busy && !showCamera && state === STATE.Active) {
    return (
      <div className="app-shell screen screen-detail">
        <DetailTopNav
          onBack={() => nav('/dashboard')}
          badge={<span className="state-badge s-phase">裁决中</span>}
        />
        <div className="summary-card">
          <SoloKindTag pactId={pactId} />
          <h1 className="title">{titleText}</h1>
          <div className="progress-bar" style={{ marginTop: 'var(--sp-3)' }}>
            <div className="progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
          <p className="label label-normal" style={{ marginTop: 'var(--sp-2)' }}>
            打卡 {totalVerdict}/{totalRequired.toString()} · 通过 {verdictPass.toString()} · 失败 {verdictFail.toString()}
          </p>
        </div>

        <div className="status-panel">
          <div className="status-icon-lg" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
          </div>
          <h2>等待 Judge 裁决</h2>
          <p className="status-lede">
            你刚提交了今日打卡，AI Judge 正在对照承诺条款审核照片与动作挑战。通常 10–30 秒；测试网 RPC 慢时可能更久。
          </p>
          <p className="label witness-hint">裁决由 AI Judge 签名上链，无需再次确认交易</p>
        </div>

        <div className="result-banner">
          <div className="result-icon pending" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
          </div>
          <div className="result-body">
            <p className="result-title">已提交 · 刚刚</p>
            <p className="result-sub">
              {submittingChallenge ? `动作挑战：${submittingChallenge} · 照片已上传` : '照片已上传 · AI 审核中'}
            </p>
          </div>
        </div>
      </div>
    )
  }

  const checkinBtn = (
    <button
      type="button"
      className="btn btn-primary btn-block"
      onClick={() => setShowCamera(true)}
      disabled={busy}
    >
      {busy ? (
        <>
          <span className="spinner" /> 处理中...
        </>
      ) : (
        <>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M4 7h4l2-3 4 8 2-5h4v11H4z" />
          </svg>
          今日打卡
        </>
      )}
    </button>
  )

  return (
    <>
      <div className="app-shell screen screen-detail">
        <DetailTopNav onBack={() => nav('/dashboard')} badge={<span className={`state-badge ${STATE_CLASS[state]}`} role="status">{STATE_LABEL[state]}</span>} />

        {showCamera ? (
          <Camera challenge={challenge} onCapture={handleCheckin} onCancel={() => setShowCamera(false)} />
        ) : (
          <main className="detail-layout" aria-label="承诺详情">
            <div className="detail-main">
              <div className="detail-hero">
                <div className="detail-hero-top">
                  <div className="detail-meta-row">
                    <SoloKindTag pactId={pactId} />
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
                      <span className="progress-ring-den">/ {totalRequired.toString()}</span>
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

              {aiResult && (
                <div
                  className={`result-banner ${aiResult.pass ? 'is-pass' : 'is-fail'}`}
                  role="status"
                  aria-live="polite"
                >
                  <div className={`result-icon ${aiResult.pass ? 'pass' : 'fail'}`} aria-hidden="true">
                    {aiResult.pass ? (
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
                    <p className="result-title">{aiResult.pass ? '今日打卡通过' : '今日打卡未通过'}</p>
                    {aiResult.reasoning && <p className="result-sub">{aiResult.reasoning}</p>}
                  </div>
                </div>
              )}

              {canCheckin && (
                <>
                  <p className="label witness-hint" style={{ marginBottom: 'var(--sp-3)' }}>
                    裁决由 AI Judge 签名上链，无需再次确认交易
                  </p>
                  <div className="bottom-bar desktop-inline">{checkinBtn}</div>
                </>
              )}

              {state === STATE.Active && !canCheckin && (
                <div className="status-panel">
                  <div className="status-icon-lg" aria-hidden="true">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 7v5l3 2" />
                    </svg>
                  </div>
                  <h2>等待 Judge 裁决</h2>
                  <p className="status-lede">本承诺由其他参与方提交证据，Judge 审核中。</p>
                </div>
              )}

              {canSettle && (
                <button type="button" className="btn btn-success btn-block" onClick={handleSettle} disabled={busy}>
                  {busy ? (
                    <>
                      <span className="spinner" /> 结算中...
                    </>
                  ) : (
                    '结算承诺'
                  )}
                </button>
              )}

              <CheckinTimeline pactId={pactId} total={totalVerdict} />

              {!witnessBound && witnessSecret && (
                <div className="witness-card mobile-only witness-card--tail">
                  <WitnessInvite link={witnessLink(pactId, witnessSecret)} pactId={pactId} compact />
                </div>
              )}
            </div>

            <aside className="detail-sidebar desktop-only" aria-label="侧栏信息">
              <div className="sidebar-card">
                <p className="label section-label">统计</p>
                <div className="sidebar-stat-row">
                  <div className="sidebar-stat">
                    <p className="label">通过</p>
                    <p className="value mono text-jade">{verdictPass.toString()}</p>
                  </div>
                  <div className="sidebar-stat">
                    <p className="label">失败</p>
                    <p className="value mono text-fail">{verdictFail.toString()}</p>
                  </div>
                  <div className="sidebar-stat">
                    <p className="label">结束</p>
                    <p className="value text-dim-sm">{schedule ? formatShortDate(schedule.endTime) : '—'}</p>
                  </div>
                  <div className="sidebar-stat">
                    <p className="label">裁判</p>
                    <p className="value mono text-dim-xs">{usesRealJudge ? '#48' : '—'}</p>
                  </div>
                </div>
              </div>

              {!witnessBound && witnessSecret && (
                <div className="witness-card">
                  <WitnessInvite link={witnessLink(pactId, witnessSecret)} pactId={pactId} />
                </div>
              )}

              <div className="sidebar-card">
                <p className="label section-label">合约摘要</p>
                <dl className="contract-dl">
                  <div className="contract-row">
                    <dt>质押</dt>
                    <dd className="mono-gold">{formatUnits(stake, 6)} mUSD</dd>
                  </div>
                  <div className="contract-row">
                    <dt>开始</dt>
                    <dd className="mono text-dim-sm">
                      {schedule?.startTime ? formatShortDate(schedule.startTime) : '—'}
                    </dd>
                  </div>
                  <div className="contract-row">
                    <dt>周期</dt>
                    <dd>
                      {totalRequired.toString()} 次 · 每日 1 次
                    </dd>
                  </div>
                  <div className="contract-row">
                    <dt>免卡券</dt>
                    <dd>
                      {Number(restCards) - Number(restUsed)}/{restCards.toString()} 剩余
                    </dd>
                  </div>
                  <div className="contract-row">
                    <dt>判负阈值</dt>
                    <dd>{failThreshold.toString()} 次失败</dd>
                  </div>
                  <div className="contract-row">
                    <dt>结束时间</dt>
                    <dd className="mono text-dim-sm">{schedule ? formatDate(schedule.endTime) : '—'}</dd>
                  </div>
                  <div className="contract-row">
                    <dt>裁判</dt>
                    <dd>{usesRealJudge ? 'AI Judge #48' : '自裁（演示）'}</dd>
                  </div>
                  <div className="contract-row">
                    <dt>见证人</dt>
                    <dd className="mono text-dim-xs">
                      {witnessBound
                        ? `${witness.slice(0, 6)}…${witness.slice(-4)}`
                        : witnessSecret
                          ? '待绑定'
                          : '无'}
                    </dd>
                  </div>
                </dl>
              </div>
            </aside>
          </main>
        )}
      </div>

      {showMobileBar && canCheckin && (
        <div className="bottom-bar mobile-only">{checkinBtn}</div>
      )}
    </>
  )
}

function parseUnits(s: string, d: number): bigint {
  const [int, dec = ''] = s.split('.')
  const padded = dec.padEnd(d, '0').slice(0, d)
  return BigInt(int) * BigInt(10 ** d) + BigInt(padded)
}

function WitnessInvite({ link, compact, pactId }: { link: string; compact?: boolean; pactId: bigint }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try { await navigator.clipboard.writeText(link) } catch { /* ignore */ }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  if (compact) {
    return (
      <>
        <p className="title-line">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          见证人邀请
        </p>
        <p className="subtitle text-subtle">承诺 #{pactId.toString()} · 一位好友可监督 AI 裁决，争议时触发旗舰复核。</p>
        <button type="button" className={`btn btn-ghost btn-block btn-sm${copied ? ' is-copied' : ''}`} onClick={copy}>
          {copied ? '已复制链接' : '复制邀请链接'}
        </button>
      </>
    )
  }
  return (
    <>
      <p className="title-line">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
        见证人邀请
      </p>
      <p className="subtitle text-subtle">
        承诺 #{pactId.toString()} · 把链接发给一位朋友，Ta 绑定后可旁观你的进度。凭证只在链接里，不经服务器。
      </p>
      <button type="button" className={`btn btn-ghost btn-block btn-sm${copied ? ' is-copied' : ''}`} onClick={copy}>
        {copied ? '已复制链接' : '复制邀请链接'}
      </button>
    </>
  )
}

function RedeemOption({ successId, onRedeem }: { successId: bigint; onRedeem: (id: bigint) => void }) {
  const { data } = useReadContract({
    abi: NINJA_PACT_ABI,
    address: NINJA_PACT_ADDRESS,
    functionName: 'getCommitment',
    args: [successId],
  })
  if (!data) return null
  const [, , , , , stateRaw] = data
  if (Number(stateRaw) !== STATE.Success) return null
  return (
    <button
      className="btn btn-success btn-block"
      onClick={() => onRedeem(successId)}
    >
      承诺 #{successId.toString()} （已成功）
    </button>
  )
}
