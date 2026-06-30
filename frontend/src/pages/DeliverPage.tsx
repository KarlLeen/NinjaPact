import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { usePrivy } from '@privy-io/react-auth'
import { useAccount, useReadContract, useWriteContract, useSignMessage } from 'wagmi'
import { formatUnits } from 'viem'
import {
  NINJA_PACT_ABI, NINJA_PACT_ADDRESS,
  STATE, STATE_LABEL, STATE_CLASS, ESCROW_PHASE, ESCROW_PHASE_LABEL,
} from '../lib/contracts'

const CHAIN_POLL_MS = 20_000
const CHAIN_POLL_QUERY = { refetchInterval: CHAIN_POLL_MS, refetchIntervalInBackground: false } as const
const DISPUTE_POLL_MS = 8_000
import { ZERO_ADDRESS } from '../lib/witness'
import { fetchTermsText } from '../lib/terms'
import { getJudgeJwt } from '../lib/judgeAuth'
import { storeDeliverJob } from '../lib/deliver'
import { uploadDelivery, fetchDispute, fetchDeliveryMeta, safeExternalUrl, type DisputeRecord, type DeliveryMeta } from '../lib/escrow'
import { AcceptList, DetailTopNav, StatRow, StatusPanel, SummaryCard, WaitCheckIcon, escrowDelivererPhases, parseAcceptanceLines, PhaseTrack } from '../components/PactUi'
import { useToast } from '../lib/toast'
import { waitReceipt } from '../lib/tx'

function short(a?: string) {
  return a ? `${a.slice(0, 6)}...${a.slice(-4)}` : ''
}

export function DeliverPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const { ready, authenticated, login } = usePrivy()
  const { address } = useAccount()
  const { writeContractAsync } = useWriteContract()
  const { signMessageAsync } = useSignMessage()
  const toast = useToast()

  const pactId = BigInt(id ?? '0')
  const secret = useMemo(() => {
    const h = window.location.hash
    return h.startsWith('#') ? h.slice(1) : h
  }, [])

  const [busy, setBusy] = useState(false)
  const [terms, setTerms] = useState<{ goal?: string; evidence?: string }>({})
  const [file, setFile] = useState<File | null>(null)
  const [demoLink, setDemoLink] = useState('')
  const [dispute, setDispute] = useState<DisputeRecord | null>(null)
  const [meta, setMeta] = useState<DeliveryMeta | null>(null)

  const { data: commitment, refetch } = useReadContract({
    abi: NINJA_PACT_ABI, address: NINJA_PACT_ADDRESS, functionName: 'getCommitment', args: [pactId],
    query: CHAIN_POLL_QUERY,
  })
  const { data: parties, refetch: refetchParties } = useReadContract({
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

  // Poll payer complaint until Judge stores it (may lag the on-chain revision tx)
  useEffect(() => {
    if (phase !== ESCROW_PHASE.RevisionRequested) { setDispute(null); return }
    let alive = true
    const load = () => {
      fetchDispute(pactId).then(d => { if (alive && d) setDispute(d) })
    }
    load()
    const timer = setInterval(load, DISPUTE_POLL_MS)
    return () => { alive = false; clearInterval(timer) }
  }, [phase, pactId])

  useEffect(() => {
    if (phase !== ESCROW_PHASE.UnderReview) { setMeta(null); return }
    let alive = true
    const load = () => {
      fetchDeliveryMeta(pactId).then(m => { if (alive && m) setMeta(m) })
    }
    load()
    const timer = setInterval(load, CHAIN_POLL_MS)
    return () => { alive = false; clearInterval(timer) }
  }, [phase, pactId])

  function refetchAll() { void refetch(); void refetchParties(); void refetchEscrow(); void refetchDelivered() }

  if (!commitment) return <div className="screen-full"><div className="spinner" /></div>

  const [cid, , , , , stateRaw] = commitment
  const state = Number(stateRaw)
  const exists = Number(cid) !== 0
  const payer = parties?.[0]?.addr as string | undefined
  const escrowAmt = parties?.[0]?.stake ?? 0n
  const deliverer = parties?.[1]?.addr as string | undefined
  const delivererBound = !!deliverer && deliverer.toLowerCase() !== ZERO_ADDRESS
  const iAmDeliverer = delivererBound && !!address && deliverer!.toLowerCase() === address.toLowerCase()
  const revAllowed = Number(escrow?.revisionsAllowed ?? 0)
  const revUsed = Number(escrow?.revisionsUsed ?? 0)
  const canDeliver = iAmDeliverer && (phase === ESCROW_PHASE.InProgress || phase === ESCROW_PHASE.RevisionRequested)

  async function handleAccept() {
    if (!authenticated) { login(); return }
    if (!secret) { toast('邀请链接缺少凭证', 'error'); return }
    setBusy(true)
    try {
      toast('接受委托中...', 'info')
      const hash = await writeContractAsync({
        abi: NINJA_PACT_ABI, address: NINJA_PACT_ADDRESS,
        functionName: 'joinCommitment', args: [pactId, secret as `0x${string}`],
      })
      await waitReceipt(hash)
      if (address) storeDeliverJob(address, pactId) // so it shows in their Dashboard
      toast('已接受委托 可以交付了', 'success')
      refetchAll()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      toast(msg.includes('InvalidSecret') ? '邀请凭证无效或已被使用' : `失败：${msg.slice(0, 50)}`, 'error')
    } finally { setBusy(false) }
  }

  // Upload source (held encrypted) + demo link → anchor sourceHash via submitDelivery
  async function handleDeliver() {
    if (!file) { toast('请选择源码压缩包', 'error'); return }
    const safeDemo = safeExternalUrl(demoLink)
    if (!safeDemo) { toast('请填写有效的 demo 链接（http/https）', 'error'); return }
    setBusy(true)
    try {
      const jwt = await getJudgeJwt(signMessageAsync, address)
      toast('上传源码到托管...', 'info')
      const { sourceHash } = await uploadDelivery(jwt, pactId, file, safeDemo)

      toast('上链登记交付...', 'info')
      const hash = await writeContractAsync({
        abi: NINJA_PACT_ABI, address: NINJA_PACT_ADDRESS,
        functionName: 'submitDelivery', args: [pactId, sourceHash],
      })
      await waitReceipt(hash)
      toast('已交付，等待委托人验收 已', 'success')
      setFile(null)
      refetchAll()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      toast(msg.includes('rejected') ? '已取消' : `失败：${msg.slice(0, 60)}`, 'error')
    } finally { setBusy(false) }
  }

  if (!exists) return (
    <div className="screen">
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>—</div>
        <p className="subtitle">找不到这个委托</p>
      </div>
    </div>
  )

  const acceptItems = parseAcceptanceLines(terms.evidence)
  const phaseSteps = escrowDelivererPhases(phase, delivererBound)
  const badgeLabel = state === STATE.Active ? ESCROW_PHASE_LABEL[phase] : STATE_LABEL[state]
  const isAcceptInvite = state === STATE.AwaitingParties && !delivererBound
  const isWaitReview = iAmDeliverer && phase === ESCROW_PHASE.UnderReview

  if (isAcceptInvite || isWaitReview) {
    return (
      <div className="app-shell screen screen-wait">
        <DetailTopNav
          onBack={() => nav('/dashboard')}
          badge={<span className={`state-badge ${STATE_CLASS[state]}`}>{badgeLabel}</span>}
        />
        <main className="wait-layout" aria-label="交付详情">
          <SummaryCard>
            <span className="kind-tag mode-escrow">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="M7 11l5 3 5-3M7 7h10v10H7z" /></svg>
              {isAcceptInvite ? `委托 #${pactId.toString()} · 委托方 ${short(payer)}` : `我接的交付 #${pactId.toString()}`}
            </span>
            <h1 className="title">{terms.goal ?? `委托 #${pactId.toString()}`}</h1>
            {isAcceptInvite && terms.evidence && <p className="evidence-lede">{terms.evidence}</p>}
            {isWaitReview && <PhaseTrack steps={phaseSteps} label="交付阶段" />}
            {isAcceptInvite && (
              <>
                <StatRow label="完成验收可得" value={`${formatUnits(escrowAmt, 6)} mUSD`} valueClass="text-gold" />
                {revAllowed > 0 && <StatRow label="修改次数" value={`${revAllowed} 次`} />}
              </>
            )}
            {isWaitReview && meta?.demoLink && (
              <StatRow label="demo 链接" value={meta.demoLink.replace(/^https?:\/\//, '')} valueClass="text-dim-sm" />
            )}
          </SummaryCard>

          {isAcceptInvite && (
            <StatusPanel
              variant="accent"
              lede="有人委托你完成上面的任务，托管金已锁定。接受后交付源码 + 可测 demo，委托人验收通过即放款。"
            >
              <button type="button" className="btn btn-primary btn-block" onClick={handleAccept} disabled={busy || !ready}>
                {busy ? <><span className="spinner" /> 处理中...</> : authenticated ? '接受委托' : '登录并接受'}
              </button>
            </StatusPanel>
          )}

          {isWaitReview && (
            <StatusPanel
              icon={<WaitCheckIcon />}
              title="已交付，等待委托人验收"
              lede={`委托人正在测 demo。满意即放款 ${formatUnits(escrowAmt, 6)} mUSD；若有问题会提修改意见，你需要重新提交。`}
            />
          )}

          {acceptItems.length > 0 && (
            <section className="checklist-card" aria-label="验收清单">
              <div className="checkin-history-head"><h2>对照验收标准</h2></div>
              <AcceptList items={acceptItems} />
            </section>
          )}
        </main>
      </div>
    )
  }

  return (
    <div className="app-shell screen screen-detail">
      <DetailTopNav onBack={() => nav('/dashboard')} badge={<span className={`state-badge ${STATE_CLASS[state]}`}>{badgeLabel}</span>} />

      <main className="detail-layout" aria-label="交付详情">
        <div className="detail-main">
          <div className="detail-hero mode-escrow-hero">
            <div className="detail-meta-row">
              <span className="kind-tag mode-escrow">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="M7 11l5 3 5-3M7 7h10v10H7z" /></svg>
                我接的交付 · 委托 #{pactId.toString()}
              </span>
              <span className="stake-tag">{formatUnits(escrowAmt, 6)} mUSD</span>
            </div>
            <h1 className="title">{terms.goal ?? `委托 #${pactId.toString()}`}</h1>
            {terms.evidence && <p className="evidence-lede">{terms.evidence}</p>}
            <PhaseTrack steps={phaseSteps} label="交付阶段" />
          </div>

          <div className="stat-grid mobile-only">
            <div className="stat-cell"><p className="label">委托方</p><p className="value mono text-dim-sm">{short(payer)}</p></div>
            <div className="stat-cell"><p className="label">完成可得</p><p className="value mono text-gold">{formatUnits(escrowAmt, 6)}</p></div>
          </div>

          {state === STATE.Settled && (
            <div className={`status-panel${delivered ? ' accent' : ''}`}>
              <div className={`status-mark${delivered ? ' jade' : ''}`}>{delivered ? '成' : '终'}</div>
              <h2>{delivered ? '交付已验收' : '委托已结束'}</h2>
              <p className="status-lede">{delivered ? '款项已到账' : '委托人已退款，委托关闭'}</p>
            </div>
          )}

          {iAmDeliverer && phase === ESCROW_PHASE.RevisionRequested && (
            <div className="dispute-card">
              {dispute ? (
                <>
                  <p className="label">委托人要求修改</p>
                  <p style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{dispute.message}</p>
                  {dispute.advisory && (
                    <p className="subtitle text-subtle">AI 参考：{dispute.advisory.inSpec ? '在验收范围内（应修正）' : '疑似超出原始标准'} · {dispute.advisory.reasoning}</p>
                  )}
                </>
              ) : (
                <>
                  <p className="label">委托人要求修改</p>
                  <p className="subtitle text-subtle">链上已进入修改阶段，正在同步具体意见…</p>
                </>
              )}
            </div>
          )}

          {canDeliver && (
            <div className="action-card">
              <div className="action-card-head">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                <h2>{phase === ESCROW_PHASE.RevisionRequested ? '重新交付' : '提交交付物'}</h2>
              </div>
              <p className="subtitle text-subtle">上传源码压缩包（加密托管）+ 可测 demo 链接。委托人验收通过后，托管金才会放款给你。</p>
              <label className={`upload-zone${file ? ' has-file' : ''}`} htmlFor="deliver-file">
                <input type="file" id="deliver-file" accept=".zip,.tar,.gz,.tgz,application/zip" hidden
                  onChange={e => setFile(e.target.files?.[0] ?? null)} />
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                <span className="upload-label">{file ? file.name : '选择源码 zip'}</span>
                <span className="upload-hint">不含 node_modules · 最大 50MB</span>
              </label>
              <label className="label" htmlFor="demo-link" style={{ display: 'block', marginTop: 16 }}>Demo 链接</label>
              <input id="demo-link" type="url" className="input" placeholder="https://your-demo.vercel.app" value={demoLink} onChange={e => setDemoLink(e.target.value)} />
              <button type="button" className="btn btn-primary btn-block" style={{ marginTop: 16 }} onClick={handleDeliver} disabled={busy}>
                {busy ? <><span className="spinner" /> 交付中...</> : '提交交付，等待验收'}
              </button>
            </div>
          )}

          {iAmDeliverer && phase === ESCROW_PHASE.Arbitration && (
            <div className="status-panel fail">
              <div className="status-mark">裁</div>
              <h2>AI 终局裁决中</h2>
              <p className="status-lede">改次数已用尽，对照原始验收标准裁定中…</p>
            </div>
          )}

          {delivererBound && !iAmDeliverer && state !== STATE.Settled && (
            <div className="status-panel"><p className="status-lede">该委托已被 {short(deliverer)} 接受</p></div>
          )}

          {acceptItems.length > 0 && (
            <section className="checklist-card" aria-label="验收清单">
              <div className="checkin-history-head"><h2>对照验收标准</h2></div>
              <AcceptList items={acceptItems} />
            </section>
          )}
        </div>

        <aside className="detail-sidebar desktop-only" aria-label="委托信息">
          <div className="sidebar-card">
            <p className="label section-label">委托信息</p>
            <dl className="contract-dl">
              <div className="contract-row"><dt>委托方</dt><dd className="mono text-dim-sm">{short(payer)}</dd></div>
              <div className="contract-row"><dt>完成可得</dt><dd className="mono-gold">{formatUnits(escrowAmt, 6)} mUSD</dd></div>
              {revAllowed > 0 && <div className="contract-row"><dt>修改次数</dt><dd>{revUsed}/{revAllowed} 已用</dd></div>}
            </dl>
          </div>
        </aside>
      </main>
    </div>
  )
}
