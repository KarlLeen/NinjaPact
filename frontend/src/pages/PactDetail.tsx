import { useState, useMemo, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAccount, useReadContract, useWriteContract, usePublicClient, useSignMessage } from 'wagmi'
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
import { getWitnessSecret, witnessLink, ZERO_ADDRESS } from '../lib/witness'
import { EscrowDetail } from './EscrowDetail'

function formatDate(ts: bigint): string {
  return new Date(Number(ts) * 1000).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

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

// ─── SIWE-style JWT helpers ───────────────────────────────────────────────────

async function fetchNonce(): Promise<string> {
  const r = await fetch(`${JUDGE_URL}/nonce`)
  if (!r.ok) throw new Error('无法获取 nonce')
  const { nonce } = await r.json() as { nonce: string }
  return nonce
}

interface StoredJwt { token: string; exp: number }

function loadJwt(): string | null {
  try {
    const raw = sessionStorage.getItem('judge_jwt')
    if (!raw) return null
    const { token, exp } = JSON.parse(raw) as StoredJwt
    if (Date.now() > exp - 60_000) return null  // 1-min buffer
    return token
  } catch { return null }
}

function saveJwt(token: string, expiresAt: number) {
  sessionStorage.setItem('judge_jwt', JSON.stringify({ token, exp: expiresAt }))
}

export function PactDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const { address } = useAccount()
  const { writeContractAsync } = useWriteContract()
  const { signMessageAsync } = useSignMessage()
  const publicClient = usePublicClient()
  const toast = useToast()

  const pactId = BigInt(id ?? '0')

  const [showCamera, setShowCamera] = useState(false)
  const [busy, setBusy] = useState(false)
  const [aiResult, setAiResult] = useState<{ pass: boolean; reasoning: string } | null>(null)
  const [showRedeem, setShowRedeem] = useState(false)

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

  // ── Get or refresh JWT ────────────────────────────────────────────────────────
  async function getJwt(): Promise<string> {
    const cached = loadJwt()
    if (cached) return cached

    toast('需要签名验证身份（本会话仅一次）', 'info')
    const nonce = await fetchNonce()
    const message = `NinjaPact 打卡认证\n\nnonce: ${nonce}\ntimestamp: ${Date.now()}`
    const signature = await signMessageAsync({ message })

    const r = await fetch(`${JUDGE_URL}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, signature, address }),
    })
    if (!r.ok) {
      const err = await r.json() as { error?: string }
      throw new Error(err.error ?? '认证失败')
    }
    const { token, expiresAt } = await r.json() as { token: string; expiresAt: number }
    saveJwt(token, expiresAt)
    return token
  }

  // ── Checkin: upload evidence → Judge (GLM) verdict → signed on-chain ──────────
  async function handleCheckin(dataUrl: string) {
    setShowCamera(false)
    setBusy(true)
    setAiResult(null)

    try {
      const jwt = await getJwt()

      toast('AI 裁决中...', 'info')
      const resp = await fetch(`${JUDGE_URL}/evidence`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({
          commitmentId: pactId.toString(),
          image: dataUrl,
          termsText: termsText || `承诺 #${pactId} 的打卡验证`,
          challenge,
        }),
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
      toast('等待上链确认...', 'info')
      await publicClient!.waitForTransactionReceipt({ hash: result.txHash as `0x${string}` })

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
      await publicClient!.waitForTransactionReceipt({ hash })
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
      await publicClient!.waitForTransactionReceipt({ hash })
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
      await publicClient!.waitForTransactionReceipt({ hash })
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
      await publicClient!.waitForTransactionReceipt({ hash: approveTx })

      toast('步骤 2/2：质押资金...', 'info')
      const fundTx = await writeContractAsync({
        abi: NINJA_PACT_ABI,
        address: NINJA_PACT_ADDRESS,
        functionName: 'fund',
        args: [pactId],
      })
      await publicClient!.waitForTransactionReceipt({ hash: fundTx })
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
      await publicClient!.waitForTransactionReceipt({ hash })
      toast('已领取 1000 mUSD', 'success')
    } catch {
      toast('领取失败', 'error')
    } finally { setBusy(false) }
  }

  // ── Success panel ─────────────────────────────────────────────────────────────
  if (state === STATE.Success || state === STATE.Settled) {
    return (
      <div className="screen">
        <div className="nav">
          <button className="nav-back" onClick={() => nav('/dashboard')}>← 返回</button>
        </div>
        <div style={{ textAlign: 'center', paddingTop: 40 }}>
          <div className="badge-display" style={{ margin: '0 auto 24px' }}>忍</div>
          <h2 style={{ marginBottom: 8, fontSize: 24, color: 'var(--success)' }}>承诺已完成！</h2>
          <p className="subtitle" style={{ marginBottom: 24 }}>
            质押 {formatUnits(stake, 6)} mUSD 已退还
          </p>
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>守诺勋章</div>
            <div className="subtitle">soulbound 勋章已铸造 · 不可转让</div>
            {badgeBalance !== undefined && (
              <div style={{ marginTop: 8, color: 'var(--accent)', fontWeight: 600 }}>
                持有勋章：{badgeBalance.toString()} 枚
              </div>
            )}
          </div>
          <RateJudge id={pactId} scene="habit" outcome="success" />
          <button className="btn btn-primary btn-block" style={{ marginTop: 16 }} onClick={() => nav('/create')}>
            再立新约 
          </button>
        </div>
      </div>
    )
  }

  // ── Locked panel ──────────────────────────────────────────────────────────────
  if (state === STATE.Locked) {
    return (
      <div className="screen">
        <div className="nav">
          <button className="nav-back" onClick={() => nav('/dashboard')}>← 返回</button>
          <span className={`state-badge ${STATE_CLASS[state]}`}>{STATE_LABEL[state]}</span>
        </div>
        <div style={{ textAlign: 'center', paddingTop: 20 }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>锁</div>
          <h2 style={{ marginBottom: 8, color: 'var(--locked)' }}>承诺未完成</h2>
          <p className="subtitle" style={{ marginBottom: 24 }}>
            {formatUnits(stake, 6)} mUSD 锁定 6 个月
          </p>
          <div className="card" style={{ marginBottom: 24, textAlign: 'left' }}>
            <div className="stat-row">
              <span className="subtitle">解锁倒计时</span>
              <span className="stat-value">{formatCountdown(lockedUntil)}</span>
            </div>
            <div className="stat-row">
              <span className="subtitle">解锁时间</span>
              <span className="stat-value" style={{ fontSize: 14 }}>{formatDate(lockedUntil)}</span>
            </div>
          </div>
          <div className="card" style={{ marginBottom: 16, borderColor: 'var(--accent)', textAlign: 'left' }}>
            <div style={{ fontWeight: 600, marginBottom: 8, color: 'var(--accent)' }}>救赎之道</div>
            <p className="subtitle" style={{ marginBottom: 16 }}>
              完成一个新承诺，用它救赎这个失败——立即解锁，无需等待 6 个月。
            </p>
            <button className="btn btn-primary btn-block" onClick={() => setShowRedeem(true)} disabled={busy}>
              用已成功的承诺救赎
            </button>
          </div>
          {showRedeem && (
            <div className="card" style={{ marginBottom: 16, textAlign: 'left' }}>
              <div style={{ fontWeight: 600, marginBottom: 12 }}>选择一个已完成的承诺</div>
              {userIds?.filter(sid => sid !== pactId).length === 0 && (
                <p className="subtitle">没有可用的成功承诺，先去完成一个新约吧！</p>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {userIds?.filter(sid => sid !== pactId).map(sid => (
                  <RedeemOption key={sid.toString()} successId={sid} onRedeem={handleRedeem} />
                ))}
              </div>
              <button className="btn btn-ghost btn-block" style={{ marginTop: 12 }} onClick={() => setShowRedeem(false)}>
                取消
              </button>
            </div>
          )}
          <RateJudge id={pactId} scene="habit" outcome="fail" />
        </div>
      </div>
    )
  }

  // ── Claimable panel ───────────────────────────────────────────────────────────
  if (state === STATE.Claimable) {
    return (
      <div className="screen">
        <div className="nav">
          <button className="nav-back" onClick={() => nav('/dashboard')}>← 返回</button>
          <span className={`state-badge ${STATE_CLASS[state]}`}>{STATE_LABEL[state]}</span>
        </div>
        <div style={{ textAlign: 'center', paddingTop: 40 }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>解</div>
          <h2 style={{ marginBottom: 8 }}>可以领取了</h2>
          <p className="subtitle" style={{ marginBottom: 32 }}>
            {formatUnits(stake, 6)} mUSD 已解锁，可原路退还
          </p>
          <button className="btn btn-primary btn-block" onClick={handleClaim} disabled={busy}>
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

  return (
    <div className="screen">
      <div className="nav">
        <button className="nav-back" onClick={() => nav('/dashboard')}>← 返回</button>
        <span className="state-badge s-active" style={{ marginRight: 8 }}>自律打卡</span>
        <span className={`state-badge ${STATE_CLASS[state]}`}>{STATE_LABEL[state]}</span>
      </div>

      {/* Goal header */}
      {goalText && (
        <h2 style={{ fontSize: 18, marginBottom: 16, lineHeight: 1.4 }}>{goalText}</h2>
      )}

      {/* AI result banner */}
      {aiResult && (
        <div className="card" style={{
          marginBottom: 16,
          borderColor: aiResult.pass ? 'var(--success)' : 'var(--fail)',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 36, marginBottom: 4 }}>{aiResult.pass ? '已' : '未'}</div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {aiResult.pass ? 'AI 裁决：通过！' : 'AI 裁决：未通过'}
          </div>
          {aiResult.reasoning && (
            <div className="subtitle" style={{ fontSize: 13 }}>{aiResult.reasoning}</div>
          )}
        </div>
      )}

      {/* Camera */}
      {showCamera ? (
        <Camera
          challenge={challenge}
          onCapture={handleCheckin}
          onCancel={() => setShowCamera(false)}
        />
      ) : (
        <>
          {/* Stats */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ marginBottom: 14 }}>
              <div className="label" style={{ marginBottom: 6 }}>打卡进度</div>
              <div className="progress-bar" style={{ marginBottom: 8 }}>
                <div className="progress-fill" style={{ width: `${pct}%` }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="label">{totalVerdict}/{totalRequired} 次</span>
                <span className="label">{pct.toFixed(0)}%</span>
              </div>
            </div>
            <div className="divider" style={{ margin: '12px 0' }} />
            <div className="stat-row">
              <span className="subtitle">通过</span>
              <span className="stat-value" style={{ color: 'var(--success)' }}>{verdictPass.toString()}</span>
            </div>
            <div className="stat-row">
              <span className="subtitle">失败</span>
              <span className="stat-value" style={{ color: 'var(--fail)' }}>{verdictFail.toString()}</span>
            </div>
            <div className="stat-row">
              <span className="subtitle">免卡券</span>
              <span className="stat-value">
                {Number(restCards) - Number(restUsed)}/{restCards.toString()} 剩余
              </span>
            </div>
            <div className="stat-row">
              <span className="subtitle">注意：判负阈值</span>
              <span className="stat-value">{failThreshold.toString()} 次失败</span>
            </div>
            <div className="stat-row">
              <span className="subtitle">结束时间</span>
              <span className="stat-value" style={{ fontSize: 13 }}>{schedule ? formatDate(schedule.endTime) : '—'}</span>
            </div>
            <div className="stat-row">
              <span className="subtitle">裁判</span>
              <span className="stat-value" style={{ fontSize: 12 }}>
                {usesRealJudge ? 'AI Judge' : '自裁（演示）'}
              </span>
            </div>
            <div className="stat-row">
              <span className="subtitle">见证人</span>
              <span className="stat-value" style={{ fontSize: 12 }}>
                {witnessBound ? `${witness.slice(0, 6)}...${witness.slice(-4)}` : witnessSecret ? '待绑定' : '无'}
              </span>
            </div>
          </div>

          {/* Witness invite link (owner only, while unbound) */}
          {!witnessBound && witnessSecret && (
            <WitnessInvite link={witnessLink(pactId, witnessSecret)} />
          )}

          {/* Actions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {canCheckin && (
              <button className="btn btn-primary btn-block" onClick={() => setShowCamera(true)} disabled={busy}>
                {busy ? <><span className="spinner" /> 处理中...</> : '今日打卡 '}
              </button>
            )}

            {state === STATE.Active && !canCheckin && (
              <div className="card" style={{ textAlign: 'center' }}>
                <p className="subtitle">等待 Judge 裁决</p>
              </div>
            )}

            {canSettle && (
              <button className="btn btn-success btn-block" onClick={handleSettle} disabled={busy}>
                {busy ? <><span className="spinner" /> 结算中...</> : '结算承诺'}
              </button>
            )}

            {state === STATE.Created && (
              <div className="card" style={{ textAlign: 'left' }}>
                <p className="subtitle" style={{ marginBottom: 12, textAlign: 'center' }}>
                  承诺已创建，质押尚未完成
                </p>
                <button
                  className="btn btn-ghost btn-block"
                  onClick={handleMintTestTokens}
                  disabled={busy}
                  style={{ marginBottom: 8 }}
                >
                  先领取测试 mUSD
                </button>
                <button
                  className="btn btn-primary btn-block"
                  onClick={handleFund}
                  disabled={busy}
                >
                  {busy ? <><span className="spinner" /> 处理中...</> : `确认质押 ${formatUnits(stake, 6)} mUSD `}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function parseUnits(s: string, d: number): bigint {
  const [int, dec = ''] = s.split('.')
  const padded = dec.padEnd(d, '0').slice(0, d)
  return BigInt(int) * BigInt(10 ** d) + BigInt(padded)
}

function WitnessInvite({ link }: { link: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try { await navigator.clipboard.writeText(link) } catch { /* ignore */ }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="card" style={{ borderColor: 'var(--accent)', marginBottom: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--accent)' }}>见证人邀请</div>
      <p className="subtitle" style={{ fontSize: 13, marginBottom: 12 }}>
        把链接发给一位朋友，Ta 绑定后可旁观你的进度。凭证只在链接里（# 后），不经服务器。
      </p>
      <button className="btn btn-primary btn-block" onClick={copy}>
        {copied ? '已复制链接' : '复制邀请链接'}
      </button>
    </div>
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
