import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAccount, useReadContract, useWriteContract, usePublicClient, useSignMessage } from 'wagmi'
import { formatUnits, keccak256, stringToBytes } from 'viem'
import {
  NINJA_PACT_ABI, MOCK_USD_ABI, NINJA_PACT_ADDRESS, MOCK_USD_ADDRESS,
  STATE, STATE_LABEL, STATE_CLASS, ESCROW_PHASE, ESCROW_PHASE_LABEL,
} from '../lib/contracts'
import { ZERO_ADDRESS } from '../lib/witness'
import { getDeliverSecret, deliverLink } from '../lib/deliver'
import { fetchTermsText } from '../lib/terms'
import { getJudgeJwt } from '../lib/judgeAuth'
import { fetchDeliveryMeta, downloadSource, postDispute, safeExternalUrl, type DeliveryMeta } from '../lib/escrow'
import { RateJudge } from '../components/RateJudge'
import { useToast } from '../lib/toast'

function short(a?: string) {
  return a ? `${a.slice(0, 6)}...${a.slice(-4)}` : ''
}

/// Payer-facing view of a DEPOSIT (code-delivery escrow) commitment.
export function EscrowDetail({ pactId }: { pactId: bigint }) {
  const nav = useNavigate()
  const { address } = useAccount()
  const { writeContractAsync } = useWriteContract()
  const { signMessageAsync } = useSignMessage()
  const publicClient = usePublicClient()
  const toast = useToast()

  const [busy, setBusy] = useState(false)
  const [terms, setTerms] = useState<{ goal?: string; evidence?: string }>({})
  const [meta, setMeta] = useState<DeliveryMeta | null>(null)
  const [complaint, setComplaint] = useState('')
  const [showRevise, setShowRevise] = useState(false)

  const { data: commitment, refetch } = useReadContract({
    abi: NINJA_PACT_ABI, address: NINJA_PACT_ADDRESS, functionName: 'getCommitment', args: [pactId],
  })
  const { data: parties } = useReadContract({
    abi: NINJA_PACT_ABI, address: NINJA_PACT_ADDRESS, functionName: 'getParties', args: [pactId],
  })
  const { data: escrow, refetch: refetchEscrow } = useReadContract({
    abi: NINJA_PACT_ABI, address: NINJA_PACT_ADDRESS, functionName: 'getEscrow', args: [pactId],
  })
  const { data: delivered, refetch: refetchDelivered } = useReadContract({
    abi: NINJA_PACT_ABI, address: NINJA_PACT_ADDRESS, functionName: 'escrowDelivered', args: [pactId],
  })

  useEffect(() => {
    let alive = true
    fetchTermsText(pactId).then(t => {
      if (!alive || !t) return
      try { setTerms(JSON.parse(t) as { goal?: string; evidence?: string }) } catch { setTerms({ goal: t }) }
    })
    return () => { alive = false }
  }, [pactId])

  const phase = Number(escrow?.phase ?? 0)

  // Pull the latest delivery (demo link) whenever there's something to review
  useEffect(() => {
    if (phase === ESCROW_PHASE.None || phase === ESCROW_PHASE.InProgress) { return }
    let alive = true
    fetchDeliveryMeta(pactId).then(m => { if (alive) setMeta(m) })
    return () => { alive = false }
  }, [phase, pactId])

  const secret = useMemo(() => getDeliverSecret(pactId), [pactId])

  function refetchAll() { void refetch(); void refetchEscrow(); void refetchDelivered() }

  if (!commitment) return <div className="screen-full"><div className="spinner" /></div>

  const [, , , , , stateRaw] = commitment
  const state = Number(stateRaw)
  const escrowAmt = parties?.[0]?.stake ?? 0n
  const deliverer = parties?.[1]?.addr as string | undefined
  const delivererBound = !!deliverer && deliverer.toLowerCase() !== ZERO_ADDRESS
  const revAllowed = Number(escrow?.revisionsAllowed ?? 0)
  const revUsed = Number(escrow?.revisionsUsed ?? 0)
  const revisionsLeft = revAllowed - revUsed

  async function write(fn: string, args: unknown[], pending: string, ok: string) {
    setBusy(true)
    try {
      toast(pending, 'info')
      const hash = await writeContractAsync({
        abi: NINJA_PACT_ABI, address: NINJA_PACT_ADDRESS, functionName: fn, args,
      } as Parameters<typeof writeContractAsync>[0])
      await publicClient!.waitForTransactionReceipt({ hash })
      toast(ok, 'success')
      refetchAll()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      toast(msg.includes('rejected') ? '已取消' : `失败：${msg.slice(0, 50)}`, 'error')
    } finally { setBusy(false) }
  }

  const handleConfirm = () => write('confirmDelivery', [pactId], '确认放款中...', '已放款，款项已给交付方')
  const handleArbitrate = () => write('requestArbitration', [pactId], '申请终局裁决...', '已提交，AI 旗舰裁决中…')

  // Revision: anchor the complaint hash on-chain, then store the text on the Judge
  async function handleRevise() {
    if (!complaint.trim()) { toast('请写明需要修改的地方', 'error'); return }
    setBusy(true)
    try {
      const msgHash = keccak256(stringToBytes(complaint.trim()))
      toast('提交修改意见上链...', 'info')
      const hash = await writeContractAsync({
        abi: NINJA_PACT_ABI, address: NINJA_PACT_ADDRESS, functionName: 'requestRevision', args: [pactId, msgHash],
      })
      await publicClient!.waitForTransactionReceipt({ hash })
      try { await postDispute(pactId, complaint.trim()) } catch { /* text store is best-effort */ }
      toast('已提交，等待交付方修改', 'success')
      setComplaint(''); setShowRevise(false)
      refetchAll()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      toast(msg.includes('rejected') ? '已取消' : `失败：${msg.slice(0, 50)}`, 'error')
    } finally { setBusy(false) }
  }

  async function handleFund() {
    setBusy(true)
    try {
      toast('步骤 1/2：授权代币...', 'info')
      const a = await writeContractAsync({
        abi: MOCK_USD_ABI, address: MOCK_USD_ADDRESS, functionName: 'approve', args: [NINJA_PACT_ADDRESS, escrowAmt],
      })
      await publicClient!.waitForTransactionReceipt({ hash: a })
      toast('步骤 2/2：托管资金...', 'info')
      const f = await writeContractAsync({
        abi: NINJA_PACT_ABI, address: NINJA_PACT_ADDRESS, functionName: 'fund', args: [pactId],
      })
      await publicClient!.waitForTransactionReceipt({ hash: f })
      toast('资金已托管', 'success')
      refetchAll()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      toast(msg.includes('rejected') ? '已取消' : `失败：${msg.slice(0, 60)}`, 'error')
    } finally { setBusy(false) }
  }

  async function handleDownload() {
    setBusy(true)
    try {
      const jwt = await getJudgeJwt(signMessageAsync, address)
      toast('下载源码中...', 'info')
      await downloadSource(jwt, pactId, meta?.filename ?? `source-${pactId}.zip`)
      toast('源码已下载', 'success')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      toast(`失败：${msg.slice(0, 50)}`, 'error')
    } finally { setBusy(false) }
  }

  return (
    <div className="screen">
      <div className="nav">
        <button className="nav-back" onClick={() => nav('/dashboard')}>← 返回</button>
        <span className={`state-badge ${STATE_CLASS[state]}`}>
          {state === STATE.Active ? ESCROW_PHASE_LABEL[phase] : STATE_LABEL[state]}
        </span>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="label" style={{ marginBottom: 4 }}>代码交付托管 · 委托 #{pactId.toString()}</div>
        <div style={{ fontWeight: 600, fontSize: 17, lineHeight: 1.4 }}>{terms.goal ?? `委托 #${pactId.toString()}`}</div>
        {terms.evidence && <p className="subtitle" style={{ marginTop: 8, fontSize: 13 }}>验收标准：{terms.evidence}</p>}
        <div className="divider" style={{ margin: '12px 0' }} />
        <div className="stat-row">
          <span className="subtitle">托管金额</span>
          <span className="stat-value" style={{ color: 'var(--accent)' }}>{formatUnits(escrowAmt, 6)} mUSD</span>
        </div>
        <div className="stat-row">
          <span className="subtitle">交付方</span>
          <span className="stat-value" style={{ fontSize: 13 }}>{delivererBound ? short(deliverer) : '待接受'}</span>
        </div>
        {revAllowed > 0 && (
          <div className="stat-row">
            <span className="subtitle">修改次数</span>
            <span className="stat-value">{revUsed}/{revAllowed} 已用</span>
          </div>
        )}
      </div>

      {/* Settled outcome */}
      {state === STATE.Settled && (
        <>
          <div className="card" style={{ textAlign: 'center', borderColor: delivered ? 'var(--success)' : 'var(--border)' }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>{delivered ? '已' : '返'}</div>
            <div style={{ fontWeight: 600, marginBottom: delivered ? 14 : 0 }}>
              {delivered ? `交付已验收，${formatUnits(escrowAmt, 6)} mUSD 已支付` : `已退款，${formatUnits(escrowAmt, 6)} mUSD 已退回`}
            </div>
            {delivered && (
              <button className="btn btn-primary btn-block" onClick={handleDownload} disabled={busy}>
                {busy ? <span className="spinner" /> : '下载源码'}
              </button>
            )}
          </div>
          <RateJudge id={pactId} scene="escrow" outcome={delivered ? 'success' : 'fail'} />
        </>
      )}

      {/* Created: fund recovery */}
      {state === STATE.Created && (
        <div className="card">
          <p className="subtitle" style={{ marginBottom: 12, textAlign: 'center' }}>委托已创建，资金尚未托管</p>
          <button className="btn btn-primary btn-block" onClick={handleFund} disabled={busy}>
            {busy ? <span className="spinner" /> : `托管 ${formatUnits(escrowAmt, 6)} mUSD`}
          </button>
        </div>
      )}

      {/* AwaitingParties: share the deliverer invite link */}
      {state === STATE.AwaitingParties && (
        secret ? <DeliverInvite link={deliverLink(pactId, secret)} /> : (
          <div className="card" style={{ textAlign: 'center' }}>
            <p className="subtitle">等待交付方接受委托（邀请链接在创建此委托的设备上）</p>
          </div>
        )
      )}

      {/* InProgress: waiting for first delivery */}
      {state === STATE.Active && phase === ESCROW_PHASE.InProgress && (
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 28, marginBottom: 6 }}>⏳</div>
          <p className="subtitle">交付方已接受，等待 Ta 交付源码 + demo</p>
        </div>
      )}

      {/* UnderReview: test the demo → confirm / revise / arbitrate */}
      {state === STATE.Active && phase === ESCROW_PHASE.UnderReview && (
        <div className="card" style={{ borderColor: 'var(--accent)' }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>验收：测试 demo</div>
          {meta?.demoLink ? (
            <a href={safeExternalUrl(meta.demoLink)} target="_blank" rel="noreferrer noopener"
              className="btn btn-ghost btn-block" style={{ marginBottom: 6 }}>
              打开 demo 实测 →
            </a>
          ) : <p className="subtitle" style={{ fontSize: 13 }}>正在获取 demo 链接…</p>}
          <p className="label" style={{ marginBottom: 14 }}>
            对照验收标准实测；满意就放款，有问题就提修改意见。源码已托管，放款后才可下载。
          </p>

          {!showRevise ? (
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-primary" style={{ flex: 2 }} onClick={handleConfirm} disabled={busy}>
                {busy ? <span className="spinner" /> : '满意，放款'}
              </button>
              {revisionsLeft > 0 ? (
                <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setShowRevise(true)} disabled={busy}>
                  提修改
                </button>
              ) : (
                <button className="btn btn-ghost" style={{ flex: 1 }} onClick={handleArbitrate} disabled={busy}>
                  ⚖️ 裁决
                </button>
              )}
            </div>
          ) : (
            <div>
              <textarea
                className="input" rows={3} placeholder="具体说明哪里不符合验收标准…"
                value={complaint} onChange={e => setComplaint(e.target.value)}
                style={{ width: '100%', resize: 'vertical', marginBottom: 10 }}
              />
              <p className="label" style={{ marginBottom: 10 }}>剩余修改次数：{revisionsLeft}（提交将用掉 1 次）</p>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => { setShowRevise(false); setComplaint('') }} disabled={busy}>
                  取消
                </button>
                <button className="btn btn-primary" style={{ flex: 2 }} onClick={handleRevise} disabled={busy}>
                  {busy ? <span className="spinner" /> : '提交修改意见'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* RevisionRequested: waiting for deliverer to resubmit */}
      {state === STATE.Active && phase === ESCROW_PHASE.RevisionRequested && (
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="empty-icon" style={{ width: 40, height: 40, margin: '0 auto 6px', fontSize: 14 }} aria-hidden="true">改</div>
          <p className="subtitle">修改意见已发出，等待交付方重新交付</p>
        </div>
      )}

      {/* Arbitration */}
      {state === STATE.Active && phase === ESCROW_PHASE.Arbitration && (
        <div className="card" style={{ textAlign: 'center', borderColor: 'var(--locked)' }}>
          <div style={{ fontSize: 28, marginBottom: 6 }}>⚖️</div>
          <p className="subtitle">AI 旗舰正对照原始验收标准做终局裁决（达标放款 / 不达标退款）…</p>
        </div>
      )}
    </div>
  )
}

function DeliverInvite({ link }: { link: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try { await navigator.clipboard.writeText(link) } catch { /* ignore */ }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="card" style={{ borderColor: 'var(--accent)' }}>
      <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--accent)' }}>交付方邀请</div>
      <p className="subtitle" style={{ fontSize: 13, marginBottom: 12 }}>
        把链接发给交付方。Ta 接受后交付源码 + 可测 demo，你验收通过托管金才放款。凭证只在链接里（# 后）。
      </p>
      <button className="btn btn-primary btn-block" onClick={copy}>
        {copied ? '已复制链接' : '复制交付邀请链接'}
      </button>
    </div>
  )
}
