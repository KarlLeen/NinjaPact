import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { usePrivy } from '@privy-io/react-auth'
import { useAccount, useReadContract, useWriteContract, usePublicClient, useSignMessage } from 'wagmi'
import { formatUnits } from 'viem'
import {
  NINJA_PACT_ABI, NINJA_PACT_ADDRESS,
  STATE, STATE_LABEL, STATE_CLASS, ESCROW_PHASE, ESCROW_PHASE_LABEL,
} from '../lib/contracts'
import { ZERO_ADDRESS } from '../lib/witness'
import { fetchTermsText } from '../lib/terms'
import { getJudgeJwt } from '../lib/judgeAuth'
import { storeDeliverJob } from '../lib/deliver'
import { uploadDelivery, fetchDispute, safeExternalUrl, type DisputeRecord } from '../lib/escrow'
import { useToast } from '../lib/toast'

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
  const publicClient = usePublicClient()
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

  const { data: commitment, refetch } = useReadContract({
    abi: NINJA_PACT_ABI, address: NINJA_PACT_ADDRESS, functionName: 'getCommitment', args: [pactId],
  })
  const { data: parties, refetch: refetchParties } = useReadContract({
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

  // When a revision is requested, pull the payer's complaint so the deliverer knows what to fix
  useEffect(() => {
    if (phase !== ESCROW_PHASE.RevisionRequested) { setDispute(null); return }
    let alive = true
    fetchDispute(pactId).then(d => { if (alive) setDispute(d) })
    return () => { alive = false }
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
      await publicClient!.waitForTransactionReceipt({ hash })
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
      await publicClient!.waitForTransactionReceipt({ hash })
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

  return (
    <div className="screen">
      <div className="nav">
        <span className="title" style={{ fontSize: 18 }}>代码交付</span>
        <span className={`state-badge ${STATE_CLASS[state]}`}>
          {state === STATE.Active ? ESCROW_PHASE_LABEL[phase] : STATE_LABEL[state]}
        </span>
      </div>

      {/* Commission summary */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="label" style={{ marginBottom: 4 }}>委托 #{pactId.toString()} · 委托方 {short(payer)}</div>
        <div style={{ fontWeight: 600, fontSize: 17, lineHeight: 1.4 }}>{terms.goal ?? `委托 #${pactId.toString()}`}</div>
        {terms.evidence && <p className="subtitle" style={{ marginTop: 8, fontSize: 13 }}>验收标准：{terms.evidence}</p>}
        <div className="divider" style={{ margin: '12px 0' }} />
        <div className="stat-row">
          <span className="subtitle">完成验收可得</span>
          <span className="stat-value" style={{ color: 'var(--accent)', fontSize: 18 }}>{formatUnits(escrowAmt, 6)} mUSD</span>
        </div>
        {revAllowed > 0 && (
          <div className="stat-row">
            <span className="subtitle">修改次数</span>
            <span className="stat-value">{revUsed}/{revAllowed} 已用</span>
          </div>
        )}
      </div>

      {/* Settled */}
      {state === STATE.Settled && (
        <div className="card" style={{ textAlign: 'center', borderColor: delivered ? 'var(--success)' : 'var(--border)' }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>{delivered ? '' : '终'}</div>
          <div style={{ fontWeight: 600 }}>{delivered ? '交付已验收，款项已到账' : '委托已结束（已退款给委托方）'}</div>
        </div>
      )}

      {/* Accept — open slot, not yet bound */}
      {state === STATE.AwaitingParties && !delivererBound && (
        <div className="card" style={{ borderColor: 'var(--accent)', textAlign: 'center' }}>
          <p className="subtitle" style={{ marginBottom: 14 }}>
            有人委托你完成上面的任务，托管金已锁定。接受后交付源码 + 可测 demo，委托人验收通过即放款。
          </p>
          <button className="btn btn-primary btn-block" onClick={handleAccept} disabled={busy || !ready}>
            {busy ? <><span className="spinner" /> 处理中...</> : authenticated ? '接受委托 ' : '登录并接受 →'}
          </button>
        </div>
      )}

      {/* Payer's revision request (what to fix) */}
      {iAmDeliverer && phase === ESCROW_PHASE.RevisionRequested && dispute && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--fail)' }}>
          <div className="label" style={{ marginBottom: 6 }}>委托人要求修改</div>
          <p style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{dispute.message}</p>
          {dispute.advisory && (
            <p className="subtitle" style={{ fontSize: 12, marginTop: 8 }}>
              AI 参考：此异议{dispute.advisory.inSpec ? '在验收范围内（应修正）' : '疑似超出原始标准（可与委托人沟通）'} · {dispute.advisory.reasoning}
            </p>
          )}
        </div>
      )}

      {/* Deliver / resubmit form */}
      {canDeliver && (
        <div className="card" style={{ borderColor: 'var(--accent)' }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {phase === ESCROW_PHASE.RevisionRequested ? '重新交付' : '交付成果'}
          </div>
          <p className="subtitle" style={{ fontSize: 13, marginBottom: 14 }}>
            上传源码压缩包（加密托管，验收/放款后才给委托人）+ 一个委托人能直接测的 demo 链接。
          </p>

          <label className="label" style={{ display: 'block', marginBottom: 6 }}>源码（.zip）</label>
          <input
            type="file" accept=".zip,.tar,.gz,.tgz,application/zip"
            onChange={e => setFile(e.target.files?.[0] ?? null)}
            style={{ width: '100%', marginBottom: 14, fontSize: 13 }}
          />

          <label className="label" style={{ display: 'block', marginBottom: 6 }}>可测 demo 链接</label>
          <input
            className="input" placeholder="https://your-demo.example.com"
            value={demoLink} onChange={e => setDemoLink(e.target.value)}
            style={{ width: '100%', marginBottom: 14 }}
          />

          <button className="btn btn-primary btn-block" onClick={handleDeliver} disabled={busy}>
            {busy ? <><span className="spinner" /> 交付中...</> : '提交交付 →'}
          </button>
        </div>
      )}

      {/* Awaiting payer review */}
      {iAmDeliverer && phase === ESCROW_PHASE.UnderReview && (
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 28, marginBottom: 6 }}>⏳</div>
          <p className="subtitle">已交付，等待委托人测 demo 验收（满意即放款，或提修改意见）</p>
        </div>
      )}

      {/* Arbitration */}
      {iAmDeliverer && phase === ESCROW_PHASE.Arbitration && (
        <div className="card" style={{ textAlign: 'center', borderColor: 'var(--locked)' }}>
          <div style={{ fontSize: 28, marginBottom: 6 }}>⚖️</div>
          <p className="subtitle">改次数已用尽，AI 正在对照原始验收标准做终局裁决…</p>
        </div>
      )}

      {/* Bound to someone else */}
      {delivererBound && !iAmDeliverer && state !== STATE.Settled && (
        <div className="card" style={{ textAlign: 'center' }}>
          <p className="subtitle">该委托已被 {short(deliverer)} 接受</p>
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
