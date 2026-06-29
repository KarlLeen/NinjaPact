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
  const short = `${address.slice(0, 6)}...${address.slice(-4)}`
  return (
    <div
      onClick={copy}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 10, padding: '10px 14px', marginBottom: 16,
        cursor: 'pointer', userSelect: 'none',
      }}
    >
      <div>
        <div className="label" style={{ marginBottom: 2 }}>钱包地址（点击复制）</div>
        <div style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-dim)' }}>{short}</div>
      </div>
      <span className="label" style={{ textTransform: 'none', letterSpacing: 0, color: copied ? 'var(--jade)' : 'var(--text-muted)' }}>
        {copied ? '已复制' : '复制'}
      </span>
    </div>
  )
}

function PactCard({ id }: { id: bigint }) {
  // Goal lives off-chain (chain holds only termsHash): localStorage cache → Judge server.
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

  const [_id, modeRaw, , , , state, verdictPass, verdictFail] = data
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
    <Link to={to} style={{ textDecoration: 'none' }}>
      <div className="card" style={{ cursor: 'pointer', transition: 'border-color 0.15s' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div className="label" style={{ marginBottom: 4 }}>
              {kindLabel} #{id.toString()} · {amountLabel} {formatUnits(stake, 6)} mUSD
            </div>
            <div style={{ fontWeight: 600, fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
              {goal ?? `承诺 #${id.toString()}`}
            </div>
          </div>
          <span className={`state-badge ${STATE_CLASS[stateNum]}`} style={{ flexShrink: 0 }}>
            {STATE_LABEL[stateNum]}
          </span>
        </div>
        {!isEscrow && !isBet && stateNum === 2 && (
          <>
            <div className="progress-bar" style={{ marginBottom: 8 }}>
              <div
                className="progress-fill"
                style={{ width: `${Math.min(100, (totalVerdict / totalRequired) * 100)}%` }}
              />
            </div>
            <div className="label">
              打卡 {totalVerdict}/{totalRequired} · 通过 {verdictPass.toString()} · 失败 {verdictFail.toString()}
            </div>
          </>
        )}
      </div>
    </Link>
  )
}

// A job this device accepted as the deliverer (escrow). Links to /d/:id (the deliverer
// view), not /pact/:id (the payer view). The job lives in localStorage; status is on-chain.
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
    <Link to={`/d/${id}`} style={{ textDecoration: 'none' }}>
      <div className="card" style={{ cursor: 'pointer' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div className="label" style={{ marginBottom: 4 }}>我接的交付 · 委托 #{id}</div>
            <div style={{ fontWeight: 600, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
              {goal ?? `委托 #${id}`}
            </div>
          </div>
          <span className={`state-badge ${STATE_CLASS[state]}`} style={{ flexShrink: 0 }}>{label}</span>
        </div>
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
      <div className="nav">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="np-mark np-mark-sm" aria-hidden="true">忍</div>
          <span className="title" style={{ fontSize: 20 }}>我的承诺</span>
        </div>
        <div className="top-nav-actions" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-primary btn-sm desktop-only btn-create"
            onClick={() => nav('/create')}
          >
            创建立约
          </button>
          <button className="btn-ghost btn" style={{ padding: '8px 14px', fontSize: 13 }} onClick={() => nav('/profile')}>
            档案
          </button>
          <button className="btn-ghost btn" style={{ padding: '8px 14px', fontSize: 13 }} onClick={logout}>
            退出
          </button>
        </div>
      </div>

      {address && <WalletBar address={address} />}
      {address && <MintMusdButton block />}

      {!NINJA_PACT_ADDRESS && (
        <div className="card card-jade" style={{ marginBottom: 16 }}>
          <p style={{ color: 'var(--jade)', fontSize: 13 }}>
            注意：合约地址未配置，请先部署合约并填写 .env.local
          </p>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
        {isLoading && (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 40 }}>
            <div className="spinner" />
          </div>
        )}

        {!isLoading && (!ids || ids.length === 0) && deliverJobs.length === 0 && (
          <div style={{ textAlign: 'center', paddingTop: 60 }}>
            <div className="empty-icon" aria-hidden="true">—</div>
            <p className="subtitle">还没有承诺</p>
            <p className="subtitle" style={{ fontSize: 13, marginTop: 8, marginBottom: 20 }}>
              立一个约，用质押换自律
            </p>
            <button type="button" className="btn btn-primary desktop-only" onClick={() => nav('/create')}>
              创建立约
            </button>
          </div>
        )}

        {ids?.map(id => <PactCard key={id.toString()} id={id} />)}

        {deliverJobs.length > 0 && (
          <>
            <div className="label" style={{ marginTop: 8 }}>我接的交付</div>
            {deliverJobs.map(id => <DeliverJobCard key={id} id={id} />)}
          </>
        )}
      </div>

      <button className="fab" onClick={() => nav('/create')}>＋</button>
    </div>
  )
}
