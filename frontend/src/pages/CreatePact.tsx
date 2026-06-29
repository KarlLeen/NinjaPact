import { useState, useRef, useEffect, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAccount, useWriteContract, usePublicClient } from 'wagmi'
import { parseUnits, keccak256, stringToBytes, zeroHash, type Address } from 'viem'
import {
  NINJA_PACT_ABI, MOCK_USD_ABI,
  NINJA_PACT_ADDRESS, MOCK_USD_ADDRESS, JUDGE_ADDRESS, JUDGE_URL, MODE,
} from '../lib/contracts'
import { useToast } from '../lib/toast'
import { saveTerms } from '../lib/terms'
import { makeWitnessSecret, witnessHash, storeWitnessSecret } from '../lib/witness'
import { makeDeliverSecret, deliverHash, storeDeliverSecret } from '../lib/deliver'
import { makeBetSecret, betHash, storeBetSecret } from '../lib/bet'

interface Bubble { from: 'bot' | 'user'; text: string }
interface ApiMsg { role: 'user' | 'assistant'; content: string }

interface Proposal {
  type: 'proposal'
  summary: string
  goal: string
  evidenceDesc: string
  durationDays: number
  totalRequired: number
  stake: number
  restCards: number
  failThreshold: number
}
type ChatResult = Proposal | { type: 'question'; message: string }

const GREETING = '你好，忍者。\n\n你想立什么约？用一句话描述你的目标就行，我会帮你把它变成可验收的承诺。\n\n比如：「我想坚持健身」「每天背单词」'

const CREATE_TAB_KEY = 'np_create_tab'

function loadCreateTab(): 'solo' | 'escrow' | 'bet' {
  const s = sessionStorage.getItem(CREATE_TAB_KEY)
  if (s === 'escrow' || s === 'bet' || s === 'solo') return s
  return 'solo'
}

export function CreatePact() {
  const nav = useNavigate()
  const { address } = useAccount()
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()
  const toast = useToast()

  const [pactMode, setPactMode] = useState<'solo' | 'escrow' | 'bet'>(loadCreateTab)
  function selectMode(m: 'solo' | 'escrow' | 'bet') {
    setPactMode(m)
    sessionStorage.setItem(CREATE_TAB_KEY, m)
  }
  const [bubbles, setBubbles] = useState<Bubble[]>([{ from: 'bot', text: GREETING }])
  const [apiHistory, setApiHistory] = useState<ApiMsg[]>([])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const [proposal, setProposal] = useState<Proposal | null>(null)
  // User-adjustable numeric params (sliders), seeded from the LLM proposal
  const [params, setParams] = useState<{ durationDays: number; totalRequired: number; stake: number; restCards: number } | null>(null)
  const [inviteWitness, setInviteWitness] = useState(true)
  const [creating, setCreating] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [bubbles, thinking, proposal])

  // ── Send a turn to the Judge LLM ───────────────────────────────────────────
  async function handleSend() {
    const val = input.trim()
    if (!val || thinking) return
    setInput('')
    setProposal(null)
    setParams(null)

    const nextHistory: ApiMsg[] = [...apiHistory, { role: 'user', content: val }]
    setBubbles(b => [...b, { from: 'user', text: val }])
    setApiHistory(nextHistory)
    setThinking(true)

    try {
      const resp = await fetch(`${JUDGE_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nextHistory }),
      })
      if (!resp.ok) {
        const e = await resp.json().catch(() => ({ error: resp.statusText })) as { error?: string }
        throw new Error(e.error ?? `服务错误 ${resp.status}`)
      }
      const result = await resp.json() as ChatResult

      setApiHistory(h => [...h, { role: 'assistant', content: JSON.stringify(result) }])

      if (result.type === 'proposal') {
        setBubbles(b => [...b, { from: 'bot', text: result.summary }])
        setProposal(result)
        setParams({
          durationDays: result.durationDays,
          totalRequired: Math.min(result.totalRequired, result.durationDays),
          stake: result.stake,
          restCards: result.restCards,
        })
      } else {
        setBubbles(b => [...b, { from: 'bot', text: result.message }])
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setBubbles(b => [...b, { from: 'bot', text: `（出错了:${msg.slice(0, 60)}，再说一次试试)` }])
    } finally {
      setThinking(false)
    }
  }

  // ── Confirm → on-chain approve + create + fund ─────────────────────────────
  async function handleConfirm() {
    if (!address || !publicClient || !proposal || !params) return
    const failThreshold = Math.max(1, Math.round(params.totalRequired * 0.2))
    setCreating(true)
    // Optional witness invite: generate a secret now, store after creation
    const witnessSecret = inviteWitness ? makeWitnessSecret() : null
    const witnessInviteHash = witnessSecret ? witnessHash(witnessSecret) : zeroHash
    try {
      const stakeAmount = parseUnits(String(params.stake), 6)
      const now = BigInt(Math.floor(Date.now() / 1000))
      const endTime = now + BigInt(params.durationDays * 86400)
      const termsText = JSON.stringify({ goal: proposal.goal, evidence: proposal.evidenceDesc })
      const termsHash = keccak256(stringToBytes(termsText))
      const judgeAddr = (JUDGE_ADDRESS || address) as Address

      toast('步骤 1/3：授权代币...', 'info')
      const approveTx = await writeContractAsync({
        abi: MOCK_USD_ABI, address: MOCK_USD_ADDRESS, functionName: 'approve',
        args: [NINJA_PACT_ADDRESS, stakeAmount],
      })
      await publicClient.waitForTransactionReceipt({ hash: approveTx })

      toast('步骤 2/3：创建承诺...', 'info')
      const createTx = await writeContractAsync({
        abi: NINJA_PACT_ABI, address: NINJA_PACT_ADDRESS, functionName: 'createCommitment',
        args: [
          0, // Mode.SOLO
          judgeAddr,
          termsHash,
          {
            totalRequired: params.totalRequired,
            failThreshold,
            restCards: params.restCards,
            restCardsUsed: 0,
          },
          { startTime: now, endTime, windowStartHour: 0, windowDurationH: 24 },
          stakeAmount,
          witnessInviteHash, zeroHash, 0n,
        ],
      })
      await publicClient.waitForTransactionReceipt({ hash: createTx })

      toast('步骤 3/3：质押资金...', 'info')
      const ids = await publicClient.readContract({
        abi: NINJA_PACT_ABI, address: NINJA_PACT_ADDRESS,
        functionName: 'getUserCommitments', args: [address],
      })
      const newId = ids[ids.length - 1]
      const fundTx = await writeContractAsync({
        abi: NINJA_PACT_ABI, address: NINJA_PACT_ADDRESS, functionName: 'fund', args: [newId],
      })
      await publicClient.waitForTransactionReceipt({ hash: fundTx })

      // Store refined terms locally + on Judge server (cross-device, hash-gated)
      await saveTerms(newId, termsText)
      // Persist witness secret so the owner can re-copy the invite link later
      if (witnessSecret) storeWitnessSecret(newId, witnessSecret)

      toast('自律打卡已创建！开始每日打卡', 'success')
      nav(`/pact/${newId}`)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      toast(msg.includes('User rejected') ? '已取消' : `失败：${msg.slice(0, 60)}`, 'error')
      setCreating(false)
    }
  }

  const showInput = !proposal && !creating

  return (
    <div className="screen">
      <div className="nav">
        <button className="nav-back" onClick={() => nav('/dashboard')}>← 返回</button>
        <span style={{ fontSize: 15, color: 'var(--text-dim)' }}>立新承诺</span>
      </div>

      {/* Mode toggle: 自律打卡 (SOLO) · 交付托管 (DEPOSIT) · 公共事件对赌 (DUO) */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <ModeTab active={pactMode === 'solo'} onClick={() => selectMode('solo')} label="自律打卡" />
        <ModeTab active={pactMode === 'escrow'} onClick={() => selectMode('escrow')} label="交付托管" />
        <ModeTab active={pactMode === 'bet'} onClick={() => selectMode('bet')} label="对赌" />
      </div>

      {pactMode === 'bet' ? (
        <BetForm />
      ) : pactMode === 'escrow' ? (
        <EscrowForm />
      ) : (
      <>
      {/* Chat */}
      <div className="scroll" style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 20 }}>
        {bubbles.map((m, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: m.from === 'bot' ? 'flex-start' : 'flex-end' }}>
            {m.from === 'bot' && <span className="np-mark np-mark-sm" style={{ marginRight: 8, alignSelf: 'flex-end' }} aria-hidden="true">忍</span>}
            <div className={m.from === 'bot' ? 'bubble-bot' : 'bubble-user'} style={{ whiteSpace: 'pre-line' }}>
              {m.text}
            </div>
          </div>
        ))}

        {thinking && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center', gap: 8 }}>
            <span className="np-mark np-mark-sm" aria-hidden="true">忍</span>
            <div className="bubble-bot"><span className="spinner" style={{ width: 14, height: 14 }} /> 思考中...</div>
          </div>
        )}

        {/* Proposal confirmation card: goal/evidence (LLM-defined) + adjustable sliders */}
        {proposal && params && (
          <div className="card" style={{ borderColor: 'var(--accent)' }}>
            <div style={{ fontWeight: 700, marginBottom: 12, color: 'var(--accent)' }}>承诺摘要</div>
            <ProposalRow label="目标" value={proposal.goal} />
            <ProposalRow label="证据" value={proposal.evidenceDesc} />

            <div className="divider" style={{ margin: '12px 0' }} />
            <div className="subtitle" style={{ marginBottom: 8, fontSize: 12 }}>拖动调整你的参数</div>

            <Slider
              label="周期" unit="天" value={params.durationDays} min={1} max={90}
              onChange={d => setParams(p => p && ({ ...p, durationDays: d, totalRequired: Math.min(p.totalRequired, d) }))}
            />
            <Slider
              label="打卡次数" unit="次" value={params.totalRequired} min={1} max={params.durationDays}
              onChange={n => setParams(p => p && ({ ...p, totalRequired: n }))}
            />
            <Slider
              label="质押" unit="mUSD" value={params.stake} min={10} max={1000} step={10}
              onChange={s => setParams(p => p && ({ ...p, stake: s }))}
            />
            <Slider
              label="免卡券" unit="张" value={params.restCards} min={0} max={10}
              onChange={r => setParams(p => p && ({ ...p, restCards: r }))}
            />
            <ProposalRow label="判负阈值" value={`${Math.max(1, Math.round(params.totalRequired * 0.2))} 次失败`} />

            <div className="divider" style={{ margin: '12px 0' }} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={inviteWitness}
                onChange={e => setInviteWitness(e.target.checked)}
                style={{ width: 18, height: 18, accentColor: 'var(--accent)', flexShrink: 0 }}
              />
              <span>
                <span style={{ fontWeight: 600 }}>邀请一位见证人</span>
                <span className="subtitle" style={{ display: 'block', fontSize: 12 }}>朋友可旁观你的进度（霍桑效应）。立约后给你邀请链接</span>
              </span>
            </label>

            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => { setProposal(null); setParams(null) }} disabled={creating}>
                重新聊
              </button>
              <button className="btn btn-primary" style={{ flex: 2 }} onClick={handleConfirm} disabled={creating}>
                {creating ? <><span className="spinner" /> 上链中...</> : '确认立约'}
              </button>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      {showInput && (
        <div style={{ display: 'flex', gap: 8, paddingTop: 12 }}>
          <input
            className="input"
            placeholder="说说你的目标..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSend()}
            disabled={thinking}
          />
          <button className="btn btn-primary" onClick={handleSend} style={{ flexShrink: 0 }} disabled={thinking}>
            发送
          </button>
        </div>
      )}
      </>
      )}
    </div>
  )
}

function ModeTab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, padding: '10px 8px', borderRadius: 10, cursor: 'pointer',
        border: `1px solid ${active ? 'var(--jade-line)' : 'var(--border)'}`,
        background: active ? 'var(--jade-dim)' : 'var(--surface)',
        color: active ? 'var(--jade)' : 'var(--text-dim)', fontWeight: 600, fontSize: 13,
      }}
    >
      {label}
    </button>
  )
}

function ProposalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-row">
      <span className="subtitle" style={{ flexShrink: 0, marginRight: 12 }}>{label}</span>
      <span className="stat-value" style={{ fontSize: 14, textAlign: 'right' }}>{value}</span>
    </div>
  )
}

// ── 代码交付托管 (DEPOSIT/escrow) create form ────────────────────────────────
// Payer escrows funds; a deliverer (invited via #secret) delivers source + a testable
// demo; payer reviews → confirm / bounded revisions / AI arbitration.
const ESCROW_GREETING = '想外包个开发任务?用一句话说你要做什么,我帮你拆成「能在 demo 上逐条验收」的清单(整个担保都靠它裁)。\n\n比如:「做个 todo 网页」「写个脚本抓某网站商品价格导出 csv」'

interface EscrowProposalMsg {
  type: 'proposal'; kind: 'escrow'; summary: string; goal: string; acceptance: string
  stake: number; revisions: number; durationDays: number
}
type EscrowChatResult = EscrowProposalMsg | { type: 'question'; message: string }

function EscrowForm() {
  const nav = useNavigate()
  const { address } = useAccount()
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()
  const toast = useToast()

  const [bubbles, setBubbles] = useState<Bubble[]>([{ from: 'bot', text: ESCROW_GREETING }])
  const [apiHistory, setApiHistory] = useState<ApiMsg[]>([])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const [deliverable, setDeliverable] = useState('')
  const [acceptance, setAcceptance] = useState('')
  const [amount, setAmount] = useState(200)
  const [days, setDays] = useState(7)
  const [revisions, setRevisions] = useState(2)
  const [creating, setCreating] = useState(false)

  const ready = deliverable.trim().length > 0 && acceptance.trim().length > 0

  // Conversational 立约: AI turns a vague need into a testable acceptance checklist + fills the form
  async function handleSend() {
    const val = input.trim()
    if (!val || thinking) return
    setInput('')
    const nextHistory: ApiMsg[] = [...apiHistory, { role: 'user', content: val }]
    setBubbles(b => [...b, { from: 'user', text: val }])
    setApiHistory(nextHistory)
    setThinking(true)
    try {
      const resp = await fetch(`${JUDGE_URL}/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nextHistory, mode: 'escrow' }),
      })
      if (!resp.ok) throw new Error(`服务错误 ${resp.status}`)
      const result = await resp.json() as EscrowChatResult
      setApiHistory(h => [...h, { role: 'assistant', content: JSON.stringify(result) }])
      if (result.type === 'proposal') {
        setBubbles(b => [...b, { from: 'bot', text: `${result.summary}\n\n已帮你填好下方表单,核对/微调后即可创建 ` }])
        setDeliverable(result.goal)
        setAcceptance(result.acceptance)
        setAmount(result.stake)
        setRevisions(result.revisions)
        setDays(result.durationDays)
      } else {
        setBubbles(b => [...b, { from: 'bot', text: result.message }])
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setBubbles(b => [...b, { from: 'bot', text: `(出错了:${msg.slice(0, 40)},再说一次试试)` }])
    } finally {
      setThinking(false)
    }
  }

  async function handleCreate() {
    if (!address || !publicClient || !ready) return
    setCreating(true)
    const secret = makeDeliverSecret()
    const inviteHash = deliverHash(secret)
    try {
      const stakeAmount = parseUnits(String(amount), 6)
      const now = BigInt(Math.floor(Date.now() / 1000))
      const endTime = now + BigInt(days * 86400)
      const termsText = JSON.stringify({ goal: deliverable.trim(), evidence: acceptance.trim() })
      const termsHash = keccak256(stringToBytes(termsText))
      const judgeAddr = (JUDGE_ADDRESS || address) as Address

      toast('步骤 1/3：授权代币...', 'info')
      const approveTx = await writeContractAsync({
        abi: MOCK_USD_ABI, address: MOCK_USD_ADDRESS, functionName: 'approve',
        args: [NINJA_PACT_ADDRESS, stakeAmount],
      })
      await publicClient.waitForTransactionReceipt({ hash: approveTx })

      toast('步骤 2/3：创建委托...', 'info')
      const createTx = await writeContractAsync({
        abi: NINJA_PACT_ABI, address: NINJA_PACT_ADDRESS, functionName: 'createCommitment',
        args: [
          MODE.DEPOSIT,
          judgeAddr,
          termsHash,
          // Escrow: restCards carries the revision budget (改次数); fail/total unused.
          { totalRequired: 1, failThreshold: 0, restCards: revisions, restCardsUsed: 0 },
          { startTime: now, endTime, windowStartHour: 0, windowDurationH: 24 },
          stakeAmount,
          zeroHash,        // no witness
          inviteHash,      // deliverer invite slot
          0n,              // deliverer stakes nothing
        ],
      })
      await publicClient.waitForTransactionReceipt({ hash: createTx })

      toast('步骤 3/3：托管资金...', 'info')
      const ids = await publicClient.readContract({
        abi: NINJA_PACT_ABI, address: NINJA_PACT_ADDRESS,
        functionName: 'getUserCommitments', args: [address],
      })
      const newId = ids[ids.length - 1]
      const fundTx = await writeContractAsync({
        abi: NINJA_PACT_ABI, address: NINJA_PACT_ADDRESS, functionName: 'fund', args: [newId],
      })
      await publicClient.waitForTransactionReceipt({ hash: fundTx })

      await saveTerms(newId, termsText)
      storeDeliverSecret(newId, secret) // payer copies the invite link from the detail page

      toast('委托已创建！把邀请链接发给交付方', 'success')
      nav(`/pact/${newId}`)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      toast(msg.includes('User rejected') ? '已取消' : `失败：${msg.slice(0, 60)}`, 'error')
      setCreating(false)
    }
  }

  return (
    <div className="scroll" style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 20 }}>
      {/* Conversational 立约 (optional): AI drafts a testable checklist into the form */}
      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>AI 帮你拟验收清单（可选）</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 220, overflowY: 'auto', marginBottom: 10 }}>
          {bubbles.map((m, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: m.from === 'bot' ? 'flex-start' : 'flex-end' }}>
              {m.from === 'bot' && <span style={{ marginRight: 6, fontSize: 16, alignSelf: 'flex-end' }}>忍</span>}
              <div className={m.from === 'bot' ? 'bubble-bot' : 'bubble-user'} style={{ whiteSpace: 'pre-line', fontSize: 13 }}>{m.text}</div>
            </div>
          ))}
          {thinking && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 16 }}>忍</span>
              <div className="bubble-bot"><span className="spinner" style={{ width: 12, height: 12 }} /> 思考中...</div>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="input" placeholder="说说你要做什么..." value={input}
            onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSend()}
            disabled={thinking}
          />
          <button className="btn btn-primary" onClick={handleSend} style={{ flexShrink: 0 }} disabled={thinking}>发送</button>
        </div>
      </div>

      <div className="card" style={{ borderColor: 'var(--accent)' }}>
        <div style={{ fontWeight: 700, marginBottom: 4, color: 'var(--accent)' }}>代码交付托管</div>
        <p className="subtitle" style={{ fontSize: 13, marginBottom: 14 }}>
          你先把钱托管进合约。交付方交源码 + 可测 demo，你实测验收通过才放款（放款才拿到源码）；
          不满意可在改次数内要求修改；用尽仍有争议交 AI 终局裁决；超时未交付原路退回。
        </p>

        <label className="label" style={{ display: 'block', marginBottom: 6 }}>开发需求</label>
        <textarea
          className="input" rows={4} placeholder="例如：做一个 Todo 网页应用，支持增删改 + 本地存储"
          value={deliverable} onChange={e => setDeliverable(e.target.value)}
          style={{ width: '100%', resize: 'vertical', minHeight: 120, marginBottom: 14 }}
        />

        <label className="label" style={{ display: 'block', marginBottom: 6 }}>可测验收标准</label>
        <textarea
          className="input" rows={6} placeholder={'逐条写、可在 demo 上测：\n· 能新增任务\n· 能勾选完成\n· 刷新后数据还在\n· 手机端正常'}
          value={acceptance} onChange={e => setAcceptance(e.target.value)}
          style={{ width: '100%', resize: 'vertical', minHeight: 160, marginBottom: 8 }}
        />

        <div className="divider" style={{ margin: '12px 0' }} />
        <Slider label="托管金额" unit="mUSD" value={amount} min={10} max={2000} step={10} onChange={setAmount} />
        <Slider label="修改次数" unit="次" value={revisions} min={0} max={5} onChange={setRevisions} />
        <Slider label="截止天数" unit="天" value={days} min={1} max={30} onChange={setDays} />

        <button className="btn btn-primary btn-block" style={{ marginTop: 16 }} onClick={handleCreate} disabled={creating || !ready}>
          {creating ? <><span className="spinner" /> 上链中...</> : `托管 ${amount} mUSD 并创建委托 `}
        </button>
        {!ready && <p className="label" style={{ textAlign: 'center', marginTop: 8 }}>填写开发需求和验收标准后即可创建</p>}
      </div>
    </div>
  )
}

// ── 公共事件对赌 (DUO) create form ───────────────────────────────────────────
// Two parties bet equal stakes on a public yes/no event. The Judge agent acts as the
// event oracle — at the deadline it determines YES/NO, signs it, and the winning side
// takes the pot. (能力展示切片：突破"失败不罚没",由 owner 明确决定。)
function BetForm() {
  const nav = useNavigate()
  const { address } = useAccount()
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()
  const toast = useToast()

  const [question, setQuestion] = useState('')
  const [betsYes, setBetsYes] = useState(true)
  const [amount, setAmount] = useState(100)
  // default deadline: 30 days out, as yyyy-mm-dd
  const [deadline, setDeadline] = useState(() => {
    const d = new Date(Date.now() + 30 * 86400_000)
    return d.toISOString().slice(0, 10)
  })
  const [creating, setCreating] = useState(false)

  const deadlineTs = Math.floor(new Date(`${deadline}T23:59:59`).getTime() / 1000)
  const ready = question.trim().length > 0 && deadlineTs > Math.floor(Date.now() / 1000)

  async function handleCreate() {
    if (!address || !publicClient || !ready) return
    setCreating(true)
    const secret = makeBetSecret()
    const inviteHash = betHash(secret)
    try {
      const stakeAmount = parseUnits(String(amount), 6)
      const now = BigInt(Math.floor(Date.now() / 1000))
      const endTime = BigInt(deadlineTs)
      // terms hold the event question (off-chain text, hash anchored on-chain)
      const termsText = JSON.stringify({ goal: question.trim(), bet: true, creatorBetsYes: betsYes })
      const termsHash = keccak256(stringToBytes(termsText))
      const judgeAddr = (JUDGE_ADDRESS || address) as Address

      toast('步骤 1/3：授权代币...', 'info')
      const approveTx = await writeContractAsync({
        abi: MOCK_USD_ABI, address: MOCK_USD_ADDRESS, functionName: 'approve',
        args: [NINJA_PACT_ADDRESS, stakeAmount],
      })
      await publicClient.waitForTransactionReceipt({ hash: approveTx })

      toast('步骤 2/3：创建对赌...', 'info')
      const createTx = await writeContractAsync({
        abi: NINJA_PACT_ABI, address: NINJA_PACT_ADDRESS, functionName: 'createBet',
        args: [
          judgeAddr,
          termsHash,
          { startTime: now, endTime, windowStartHour: 0, windowDurationH: 24 },
          stakeAmount,
          inviteHash,
          betsYes,
        ],
      })
      await publicClient.waitForTransactionReceipt({ hash: createTx })

      toast('步骤 3/3：押注...', 'info')
      const ids = await publicClient.readContract({
        abi: NINJA_PACT_ABI, address: NINJA_PACT_ADDRESS,
        functionName: 'getUserCommitments', args: [address],
      })
      const newId = ids[ids.length - 1]
      const fundTx = await writeContractAsync({
        abi: NINJA_PACT_ABI, address: NINJA_PACT_ADDRESS, functionName: 'fund', args: [newId],
      })
      await publicClient.waitForTransactionReceipt({ hash: fundTx })

      await saveTerms(newId, termsText)
      storeBetSecret(newId, secret) // creator copies the opponent invite link from the detail page

      toast('对赌已创建！把邀请链接发给对手', 'success')
      nav(`/b/${newId}`)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      toast(msg.includes('User rejected') ? '已取消' : `失败：${msg.slice(0, 60)}`, 'error')
      setCreating(false)
    }
  }

  return (
    <div className="scroll" style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 20 }}>
      <div className="card" style={{ borderColor: 'var(--accent)' }}>
        <div style={{ fontWeight: 700, marginBottom: 4, color: 'var(--accent)' }}>公共事件对赌</div>
        <p className="subtitle" style={{ fontSize: 13, marginBottom: 14 }}>
          你和对手就一个公共事件各押等额。到期由 AI 裁判(事件预言机)查证结果并签名上链,赢家通吃整个奖池。
          <br />（这是能力展示:与「自律不罚没」不同,对赌会罚没输家。）
        </p>

        <label className="label" style={{ display: 'block', marginBottom: 6 }}>对赌事件（可客观查证的 YES/NO 问题）</label>
        <textarea
          className="input" rows={4} placeholder="例如：Drake 会在 2025年10月1日 前发布新专辑吗？"
          value={question} onChange={e => setQuestion(e.target.value)}
          style={{ width: '100%', resize: 'vertical', minHeight: 120, marginBottom: 14 }}
        />

        <label className="label" style={{ display: 'block', marginBottom: 6 }}>我押哪一边</label>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <SideTab active={betsYes} onClick={() => setBetsYes(true)} label="YES 会发生" color="var(--success)" />
          <SideTab active={!betsYes} onClick={() => setBetsYes(false)} label="NO 不会发生" color="var(--fail)" />
        </div>

        <Slider label="押注额（双方等额）" unit="mUSD" value={amount} min={10} max={2000} step={10} onChange={setAmount} />

        <label className="label" style={{ display: 'block', margin: '10px 0 6px' }}>裁定截止日</label>
        <input
          type="date" className="input" value={deadline}
          min={new Date(Date.now() + 86400_000).toISOString().slice(0, 10)}
          onChange={e => setDeadline(e.target.value)}
          style={{ width: '100%', marginBottom: 8 }}
        />

        <button className="btn btn-primary btn-block" style={{ marginTop: 12 }} onClick={handleCreate} disabled={creating || !ready}>
          {creating ? <><span className="spinner" /> 上链中...</> : `押 ${amount} mUSD 并创建对赌 `}
        </button>
        {!ready && <p className="label" style={{ textAlign: 'center', marginTop: 8 }}>填写对赌事件、选边、设定截止日后即可创建</p>}
      </div>
    </div>
  )
}

function SideTab({ active, onClick, label, color }: { active: boolean; onClick: () => void; label: string; color: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, padding: '12px 8px', borderRadius: 10, cursor: 'pointer',
        border: `1px solid ${active ? color : 'var(--border)'}`,
        background: active ? color : 'var(--surface)',
        color: active ? '#000' : 'var(--text-dim)', fontWeight: 700, fontSize: 14,
      }}
    >
      {label}
    </button>
  )
}

function Slider({ label, unit, value, min, max, step = 1, onChange }: {
  label: string; unit: string; value: number; min: number; max: number; step?: number
  onChange: (v: number) => void
}) {
  const pct = max === min ? 0 : ((value - min) / (max - min)) * 100
  return (
    <div style={{ margin: '10px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span className="subtitle">{label}</span>
        <span className="stat-value mono" style={{ color: 'var(--jade)' }}>{value} {unit}</span>
      </div>
      <input
        type="range"
        className="np-slider"
        min={min} max={max} step={step} value={value}
        style={{ '--p': `${pct}%` } as CSSProperties}
        onChange={e => onChange(Number(e.target.value))}
      />
    </div>
  )
}
