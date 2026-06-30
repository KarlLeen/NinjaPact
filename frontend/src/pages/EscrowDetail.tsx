import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAccount, useReadContract, useWriteContract, useSignMessage } from 'wagmi'
import { formatUnits, keccak256, stringToBytes } from 'viem'
import {
  NINJA_PACT_ABI, MOCK_USD_ABI, NINJA_PACT_ADDRESS, MOCK_USD_ADDRESS,
  STATE, STATE_LABEL, STATE_CLASS, ESCROW_PHASE, ESCROW_PHASE_LABEL,
} from '../lib/contracts'
import { ZERO_ADDRESS } from '../lib/witness'

const CHAIN_POLL_MS = 20_000
const CHAIN_POLL_QUERY = { refetchInterval: CHAIN_POLL_MS, refetchIntervalInBackground: false } as const

import { getDeliverSecret, deliverLink } from '../lib/deliver'
import { fetchTermsText } from '../lib/terms'
import { getJudgeJwt } from '../lib/judgeAuth'
import { fetchDeliveryMeta, downloadSource, postDisputeWithRetry, safeExternalUrl, type DeliveryMeta } from '../lib/escrow'
import { AcceptList, DetailTopNav, InviteCardBlock, StatRow, StatusPanel, WaitSpinnerIcon, WaitTeamIcon, escrowPayerPhases, parseAcceptanceLines, PhaseTrack } from '../components/PactUi'
import { RateJudge } from '../components/RateJudge'
import { useToast } from '../lib/toast'
import { waitReceipt } from '../lib/tx'

function short(a?: string) {
  return a ? `${a.slice(0, 6)}...${a.slice(-4)}` : ''
}

/// Payer-facing view of a DEPOSIT (code-delivery escrow) commitment.
export function EscrowDetail({ pactId }: { pactId: bigint }) {
  const nav = useNavigate()
  const { address } = useAccount()
  const { writeContractAsync } = useWriteContract()
  const { signMessageAsync } = useSignMessage()
  const toast = useToast()

  const [busy, setBusy] = useState(false)
  const [terms, setTerms] = useState<{ goal?: string; evidence?: string }>({})
  const [meta, setMeta] = useState<DeliveryMeta | null>(null)
  const [complaint, setComplaint] = useState('')
  const [showRevise, setShowRevise] = useState(false)

  const { data: commitment, refetch } = useReadContract({
    abi: NINJA_PACT_ABI, address: NINJA_PACT_ADDRESS, functionName: 'getCommitment', args: [pactId],
    query: CHAIN_POLL_QUERY,
  })
  const { data: parties } = useReadContract({
    abi: NINJA_PACT_ABI, address: NINJA_PACT_ADDRESS, functionName: 'getParties', args: [pactId],
    query: CHAIN_POLL_QUERY,
  })
  const { data: escrow, refetch: refetchEscrow } = useReadContract({
    abi: NINJA_PACT_ABI, address: NINJA_PACT_ADDRESS, functionName: 'getEscrow', args: [pactId],
    query: CHAIN_POLL_QUERY,
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

  // Pull demo link whenever delivery exists; poll until meta lands on Judge
  useEffect(() => {
    if (phase === ESCROW_PHASE.None || phase === ESCROW_PHASE.InProgress) {
      setMeta(null)
      return
    }
    let alive = true
    const load = () => {
      fetchDeliveryMeta(pactId).then(m => { if (alive && m) setMeta(m) })
    }
    load()
    const timer = setInterval(load, CHAIN_POLL_MS)
    return () => { alive = false; clearInterval(timer) }
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
      await waitReceipt(hash)
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
      await waitReceipt(hash)
      try {
        await postDisputeWithRetry(pactId, complaint.trim())
        toast('已提交，等待交付方修改', 'success')
      } catch {
        toast('链上已记录，但修改意见文字同步失败—请稍后刷新；交付方可能暂时看不到详情', 'error')
      }
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
      await waitReceipt(a)
      toast('步骤 2/2：托管资金...', 'info')
      const f = await writeContractAsync({
        abi: NINJA_PACT_ABI, address: NINJA_PACT_ADDRESS, functionName: 'fund', args: [pactId],
      })
      await waitReceipt(f)
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

  const acceptItems = parseAcceptanceLines(terms.evidence)
  const phaseSteps = escrowPayerPhases(phase)
  const badgeLabel = state === STATE.Active ? ESCROW_PHASE_LABEL[phase] : STATE_LABEL[state]
  const isWaitDeliverer = state === STATE.AwaitingParties && !!secret
  const isWaitDelivery = state === STATE.Active && phase === ESCROW_PHASE.InProgress

  if (isWaitDeliverer || isWaitDelivery) {
    return (
      <div className="app-shell screen screen-detail">
        <DetailTopNav onBack={() => nav('/dashboard')} badge={<span className={`state-badge ${STATE_CLASS[state]}`}>{badgeLabel}</span>} />
        <main className="detail-layout wait-detail" aria-label="托管详情">
          <div className="detail-main">
            <div className="detail-hero mode-escrow-hero">
              <div className="detail-meta-row">
                <span className="kind-tag mode-escrow">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="M8 12h8M12 8v8" /><rect x="4" y="6" width="16" height="12" rx="2" /></svg>
                  交付托管 · 委托 #{pactId.toString()}
                </span>
                <span className="stake-tag">{formatUnits(escrowAmt, 6)} mUSD</span>
              </div>
              <h1 className="title">{terms.goal ?? `委托 #${pactId.toString()}`}</h1>
              <PhaseTrack steps={phaseSteps} label="托管阶段" />
              <div className="hero-stat-grid">
                {isWaitDeliverer && (
                  <>
                    <StatRow label="交付方" value="待接受" valueClass="text-muted" />
                    <StatRow label="托管金额" value={`${formatUnits(escrowAmt, 6)} mUSD`} valueClass="text-gold" />
                  </>
                )}
                {isWaitDelivery && (
                  <>
                    <StatRow label="交付方" value={short(deliverer)} />
                    <StatRow label="托管金额" value={`${formatUnits(escrowAmt, 6)} mUSD`} valueClass="text-gold" />
                  </>
                )}
              </div>
            </div>

            {isWaitDeliverer && secret && (
              <div className="mobile-only">
                <DeliverInvite link={deliverLink(pactId, secret)} pactId={pactId} />
              </div>
            )}

            {isWaitDeliverer && (
              <StatusPanel
                className="status-panel--row-desktop"
                icon={<WaitTeamIcon />}
                title="等待交付方接受委托"
                lede="对方接受后进入编写阶段，你会收到链上通知。"
              />
            )}

            {isWaitDelivery && (
              <StatusPanel
                className="status-panel--row-desktop"
                icon={<WaitSpinnerIcon />}
                title="交付方已接受，等待交付"
                lede="交付方正在编写并准备源码 zip + 可测 demo 链接。提交后你会进入验收阶段。"
              />
            )}

            {acceptItems.length > 0 && (
              <section className="checklist-card" aria-label="验收清单">
                <div className="checkin-history-head"><h2>可测验收清单</h2><span className="label label-normal">链上锚定</span></div>
                <AcceptList items={acceptItems} />
              </section>
            )}
          </div>

          <aside className="detail-sidebar desktop-only" aria-label="侧栏操作">
            {isWaitDeliverer && secret && (
              <div className="witness-card invite-sidebar">
                <DeliverInvite link={deliverLink(pactId, secret)} pactId={pactId} compact />
              </div>
            )}
            <div className="sidebar-card">
              <p className="label section-label">委托摘要</p>
              <dl className="contract-dl">
                <div className="contract-row"><dt>托管金额</dt><dd className="mono-gold">{formatUnits(escrowAmt, 6)} mUSD</dd></div>
                <div className="contract-row"><dt>交付方</dt><dd className="mono text-dim-sm">{delivererBound ? short(deliverer) : '待接受'}</dd></div>
                <div className="contract-row"><dt>当前阶段</dt><dd>{isWaitDeliverer ? '等待接单' : '等待交付'}</dd></div>
              </dl>
            </div>
            {isWaitDeliverer && (
              <div className="sidebar-card sidebar-tip">
                <p className="label section-label">下一步</p>
                <p className="sidebar-tip-text">复制邀请链接发给交付方。对方通过链接接受后，托管进入编写阶段。</p>
              </div>
            )}
            {isWaitDelivery && (
              <div className="sidebar-card sidebar-tip">
                <p className="label section-label">下一步</p>
                <p className="sidebar-tip-text">交付方提交源码 zip 与 demo 后，你会收到通知并进入验收阶段。</p>
              </div>
            )}
          </aside>
        </main>
      </div>
    )
  }

  return (
    <div className="app-shell screen screen-detail">
      <DetailTopNav onBack={() => nav('/dashboard')} badge={<span className={`state-badge ${STATE_CLASS[state]}`}>{badgeLabel}</span>} />

      <main className="detail-layout" aria-label="托管详情">
        <div className="detail-main">
          <div className="detail-hero mode-escrow-hero">
            <div className="detail-meta-row">
              <span className="kind-tag mode-escrow">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="M8 12h8M12 8v8" /><rect x="4" y="6" width="16" height="12" rx="2" /></svg>
                交付托管 · 委托 #{pactId.toString()}
              </span>
              <span className="stake-tag">{formatUnits(escrowAmt, 6)} mUSD</span>
            </div>
            <h1 className="title">{terms.goal ?? `委托 #${pactId.toString()}`}</h1>
            {terms.evidence && <p className="evidence-lede">{terms.evidence}</p>}
            <PhaseTrack steps={phaseSteps} label="托管阶段" />
          </div>

          {state === STATE.Settled && (
            <div className={`status-panel${delivered ? ' accent' : ''}`}>
              <div className={`status-mark${delivered ? ' jade' : ''}`}>{delivered ? '成' : '返'}</div>
              <h2>{delivered ? '交付已验收' : '已退款'}</h2>
              <p className="status-lede">
                {delivered ? `${formatUnits(escrowAmt, 6)} mUSD 已支付给交付方` : `${formatUnits(escrowAmt, 6)} mUSD 已退回你的钱包`}
              </p>
              {delivered && (
                <button type="button" className="btn btn-primary btn-block" onClick={handleDownload} disabled={busy}>
                  {busy ? <span className="spinner" /> : '下载源码'}
                </button>
              )}
              <RateJudge id={pactId} scene="escrow" outcome={delivered ? 'success' : 'fail'} />
            </div>
          )}

          {state === STATE.Created && (
            <div className="status-panel">
              <div className="status-mark">待</div>
              <h2>待托管资金</h2>
              <p className="status-lede">委托已创建，确认后将 {formatUnits(escrowAmt, 6)} mUSD 托管进合约。</p>
              <button type="button" className="btn btn-primary btn-block" onClick={handleFund} disabled={busy}>
                {busy ? <span className="spinner" /> : `托管 ${formatUnits(escrowAmt, 6)} mUSD`}
              </button>
            </div>
          )}

          {state === STATE.AwaitingParties && !secret && (
            <StatusPanel mark="等" title="等待交付方接单" lede="邀请链接在创建此委托的设备上，请复制后发给交付方。" />
          )}

          {state === STATE.Active && phase === ESCROW_PHASE.UnderReview && (
            <div className="action-card">
              <div className="action-card-head">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
                <h2>验收：测试 demo</h2>
              </div>
              <p className="subtitle text-subtle">对照验收标准实测；满意就放款，有问题就提修改意见。源码已托管，放款后才可下载。</p>
              {meta?.demoLink ? (
                <a href={safeExternalUrl(meta.demoLink)!} target="_blank" rel="noreferrer noopener" className="btn btn-ghost btn-block">打开 demo 实测</a>
              ) : <p className="subtitle">正在获取 demo 链接…</p>}
              {!showRevise ? (
                <div className="action-row">
                  <button type="button" className="btn btn-primary" onClick={handleConfirm} disabled={busy}>
                    {busy ? <span className="spinner" /> : '满意，放款'}
                  </button>
                  {revisionsLeft > 0 ? (
                    <button type="button" className="btn btn-ghost" onClick={() => setShowRevise(true)} disabled={busy}>提修改</button>
                  ) : (
                    <button type="button" className="btn btn-ghost" onClick={handleArbitrate} disabled={busy}>申请裁决</button>
                  )}
                </div>
              ) : (
                <>
                  <textarea className="input" rows={3} placeholder="具体说明哪里不符合验收标准…" value={complaint} onChange={e => setComplaint(e.target.value)} style={{ width: '100%', resize: 'vertical', marginBottom: 12 }} />
                  <p className="label label-normal">剩余修改次数：{revisionsLeft}（提交将用掉 1 次）</p>
                  <div className="action-row">
                    <button type="button" className="btn btn-ghost" onClick={() => { setShowRevise(false); setComplaint('') }} disabled={busy}>取消</button>
                    <button type="button" className="btn btn-primary" onClick={handleRevise} disabled={busy}>
                      {busy ? <span className="spinner" /> : '提交修改意见'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {state === STATE.Active && phase === ESCROW_PHASE.RevisionRequested && (
            <div className="status-panel warn">
              <div className="status-mark">改</div>
              <h2>等待重新交付</h2>
              <p className="status-lede">修改意见已发出，交付方正在更新源码与 demo。</p>
            </div>
          )}

          {state === STATE.Active && phase === ESCROW_PHASE.Arbitration && (
            <div className="status-panel fail">
              <div className="status-mark">裁</div>
              <h2>AI 终局裁决中</h2>
              <p className="status-lede">对照原始验收标准裁定：达标放款 / 不达标退款。</p>
            </div>
          )}

          {acceptItems.length > 0 && (
            <section className="checklist-card" aria-label="验收清单">
              <div className="checkin-history-head"><h2>可测验收清单</h2><span className="label label-normal">链上锚定</span></div>
              <AcceptList items={acceptItems} />
            </section>
          )}
        </div>

        <aside className="detail-sidebar desktop-only" aria-label="侧栏信息">
          <div className="sidebar-card">
            <p className="label section-label">委托信息</p>
            <dl className="contract-dl">
              <div className="contract-row"><dt>托管金额</dt><dd className="mono-gold">{formatUnits(escrowAmt, 6)} mUSD</dd></div>
              <div className="contract-row"><dt>交付方</dt><dd className="mono text-dim-sm">{delivererBound ? short(deliverer) : '待接受'}</dd></div>
              {revAllowed > 0 && <div className="contract-row"><dt>修改次数</dt><dd>{revUsed}/{revAllowed} 已用</dd></div>}
            </dl>
          </div>
          {state === STATE.AwaitingParties && secret && (
            <div className="witness-card"><DeliverInvite link={deliverLink(pactId, secret)} pactId={pactId} compact /></div>
          )}
        </aside>
      </main>
    </div>
  )
}

function DeliverInvite({ link, compact, pactId }: { link: string; compact?: boolean; pactId: bigint }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try { await navigator.clipboard.writeText(link) } catch { /* ignore */ }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  if (compact) {
    return (
      <>
        <p className="invite-title">交付方邀请</p>
        <p className="invite-lede">委托 #{pactId.toString()} · 把链接发给交付方，Ta 接受后可提交源码与 demo。</p>
        <button type="button" className={`btn btn-ghost btn-block btn-sm${copied ? ' is-copied' : ''}`} onClick={copy}>
          {copied ? '已复制链接' : '复制交付邀请链接'}
        </button>
      </>
    )
  }
  return (
    <InviteCardBlock
      title="交付方邀请"
      lede={`委托 #${pactId.toString()} · 把链接发给交付方。Ta 接受后交付源码 + 可测 demo，你验收通过托管金才放款。凭证只在链接里（# 后）。`}
      buttonLabel="复制交付邀请链接"
      copiedLabel="已复制链接"
      onCopy={copy}
      copied={copied}
    />
  )
}
