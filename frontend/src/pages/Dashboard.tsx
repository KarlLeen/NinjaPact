import { useState, useEffect, useMemo } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { useAccount, useReadContract } from 'wagmi'
import { useNavigate, Link } from 'react-router-dom'
import { NINJA_PACT_ADDRESS, NINJA_PACT_ABI, STATE, STATE_LABEL, STATE_CLASS, MODE, ESCROW_PHASE_LABEL } from '../lib/contracts'
import { formatUnits } from 'viem'
import { fetchTermsText, parseGoal } from '../lib/terms'
import { getDeliverJobs } from '../lib/deliver'
import { MintMusdButton } from '../components/MintMusdButton'

function WalletBar({ address }: { address: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  const short = `${address.slice(0, 6)}…${address.slice(-4)}`
  return (
    <div
      className={`wallet-bar${copied ? ' copied' : ''}`}
      role="button"
      tabIndex={0}
      aria-label="复制钱包地址"
      onClick={copy}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          copy()
        }
      }}
    >
      <div>
        <div className="label" style={{ marginBottom: 2 }}>钱包地址</div>
        <div className="mono text-dim-sm">{short}</div>
      </div>
      <span className="copy-hint">{copied ? '已复制' : '点击复制'}</span>
    </div>
  )
}

function PactCard({ id }: { id: bigint }) {
  const [goal, setGoal] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    fetchTermsText(id).then(t => { if (alive) setGoal(parseGoal(t)) })
    return () => { alive = false }
  }, [id])

  const { data } = useReadContract({
    abi: NINJA_PACT_ABI,
    address: NINJA_PACT_ADDRESS,
    functionName: 'getCommitment',
    args: [id],
  })
  const { data: parties } = useReadContract({
    abi: NINJA_PACT_ABI,
    address: NINJA_PACT_ADDRESS,
    functionName: 'getParties',
    args: [id],
  })
  const { data: policy } = useReadContract({
    abi: NINJA_PACT_ABI,
    address: NINJA_PACT_ADDRESS,
    functionName: 'getEvidencePolicy',
    args: [id],
  })

  if (!data) return (
    <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div className="spinner" />
      <span className="subtitle">加载中...</span>
    </div>
  )

  const [, modeRaw, , , , state, verdictPass, verdictFail] = data
  const stake = parties?.[0]?.stake ?? 0n
  const stateNum = Number(state)
  const isEscrow = Number(modeRaw) === MODE.DEPOSIT
  const isBet = Number(modeRaw) === MODE.DUO
  const totalVerdict = Number(verdictPass) + Number(verdictFail) + Number(policy?.restCardsUsed ?? 0)
  const totalRequired = Number(policy?.totalRequired ?? 1)
  const to = isBet ? `/b/${id}` : `/pact/${id}`
  const kindLabel = isBet ? '对赌' : isEscrow ? '托管' : '承诺'
  const amountLabel = isBet ? '押注' : isEscrow ? '托管' : '质押'

  return (
    <Link to={to} className="card card-interactive" style={{ textDecoration: 'none' }}>
      <div className="card-head">
        <div className="card-meta">
          <div className="label label-normal" style={{ marginBottom: 6 }}>
            {kindLabel} #{id.toString()} · {amountLabel} {formatUnits(stake, 6)} mUSD
          </div>
          <div className="card-title">
            {goal ?? `承诺 #${id.toString()}`}
          </div>
        </div>
        <span className={`state-badge ${STATE_CLASS[stateNum]}`}>
          {STATE_LABEL[stateNum]}
        </span>
      </div>
      {!isEscrow && !isBet && stateNum === 2 && (
        <>
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${Math.min(100, (totalVerdict / totalRequired) * 100)}%` }}
            />
          </div>
          <p className="label label-normal">
            打卡 {totalVerdict}/{totalRequired} · 通过 {verdictPass.toString()} · 失败 {verdictFail.toString()}
          </p>
        </>
      )}
    </Link>
  )
}

function DeliverJobCard({ id }: { id: string }) {
  const pid = BigInt(id)
  const [goal, setGoal] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    fetchTermsText(pid).then(t => { if (alive) setGoal(parseGoal(t)) })
    return () => { alive = false }
  }, [pid])

  const { data } = useReadContract({
    abi: NINJA_PACT_ABI, address: NINJA_PACT_ADDRESS, functionName: 'getCommitment', args: [pid],
  })
  const { data: escrow } = useReadContract({
    abi: NINJA_PACT_ABI, address: NINJA_PACT_ADDRESS, functionName: 'getEscrow', args: [pid],
  })
  if (!data) return null
  const state = Number(data[5])
  const phase = Number(escrow?.phase ?? 0)
  const label = state === STATE.Active ? ESCROW_PHASE_LABEL[phase] : STATE_LABEL[state]

  return (
    <Link to={`/d/${id}`} className="card card-interactive" style={{ textDecoration: 'none' }}>
      <div className="card-head">
        <div className="card-meta">
          <div className="label label-normal" style={{ marginBottom: 6 }}>我接的交付 · 委托 #{id}</div>
          <div className="card-title">{goal ?? `委托 #${id}`}</div>
        </div>
        <span className={`state-badge ${STATE_CLASS[state]}`}>{label}</span>
      </div>
    </Link>
  )
}

export function Dashboard() {
  const { logout } = usePrivy()
  const { address } = useAccount()
  const nav = useNavigate()
  const deliverJobs = useMemo(() => (address ? getDeliverJobs(address) : []), [address])

  const { data: ids, isLoading } = useReadContract({
    abi: NINJA_PACT_ABI,
    address: NINJA_PACT_ADDRESS,
    functionName: 'getUserCommitments',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  })

  return (
    <div className="screen">
      <header className="top-nav">
        <div className="top-nav-brand">
          <div className="np-mark np-mark-sm" aria-hidden="true">忍</div>
          <span className="title" style={{ fontSize: 20 }}>我的承诺</span>
        </div>
        <div className="top-nav-actions">
          <button
            type="button"
            className="btn btn-primary btn-sm desktop-only btn-create"
            onClick={() => nav('/create')}
          >
            创建立约
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => nav('/profile')}>
            档案
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={logout}>
            退出
          </button>
        </div>
      </header>

      {address && (
        <div className="dash-toolbar">
          <WalletBar address={address} />
          <MintMusdButton compact />
        </div>
      )}

      {!NINJA_PACT_ADDRESS && (
        <div className="card card-jade" style={{ marginBottom: 16 }}>
          <p className="text-jade" style={{ fontSize: 13 }}>
            注意：合约地址未配置，请先部署合约并填写 .env.local
          </p>
        </div>
      )}

      <div className="stack pact-grid">
        {isLoading && (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 40, gridColumn: '1 / -1' }}>
            <div className="spinner" />
          </div>
        )}

        {!isLoading && (!ids || ids.length === 0) && deliverJobs.length === 0 && (
          <div className="empty-state" style={{ gridColumn: '1 / -1' }}>
            <div className="empty-icon" aria-hidden="true">—</div>
            <p className="subtitle">还没有承诺</p>
            <p className="subtitle text-dim-sm" style={{ marginTop: 8 }}>
              立一个约，用质押换自律
            </p>
            <button type="button" className="btn btn-primary desktop-only" style={{ marginTop: 20 }} onClick={() => nav('/create')}>
              创建立约
            </button>
          </div>
        )}

        {ids?.map(id => <PactCard key={id.toString()} id={id} />)}

        {deliverJobs.length > 0 && (
          <>
            <p className="label section-label">我接的交付</p>
            {deliverJobs.map(id => <DeliverJobCard key={id} id={id} />)}
          </>
        )}
      </div>

      <button type="button" className="fab" aria-label="创建立约" onClick={() => nav('/create')}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </div>
  )
}
