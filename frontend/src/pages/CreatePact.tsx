import { useState, useRef, useEffect, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAccount, useWriteContract, usePublicClient } from 'wagmi'
import { parseUnits, keccak256, stringToBytes, zeroHash, type Address } from 'viem'
import {
  NINJA_PACT_ABI, MOCK_USD_ABI,
  NINJA_PACT_ADDRESS, MOCK_USD_ADDRESS, JUDGE_ADDRESS, JUDGE_URL, MODE,
} from '../lib/contracts'
import { useToast } from '../lib/toast'
import { waitReceipt } from '../lib/tx'
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
      await waitReceipt(approveTx)

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
      await waitReceipt(createTx)

      toast('步骤 3/3：质押资金...', 'info')
      const ids = await publicClient.readContract({
        abi: NINJA_PACT_ABI, address: NINJA_PACT_ADDRESS,
        functionName: 'getUserCommitments', args: [address],
      })
      const newId = ids[ids.length - 1]
      const fundTx = await writeContractAsync({
        abi: NINJA_PACT_ABI, address: NINJA_PACT_ADDRESS, functionName: 'fund', args: [newId],
      })
      await waitReceipt(fundTx)

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
    <div className="app-shell screen screen-create">
      <header className="top-nav">
        <button type="button" className="nav-back" onClick={() => nav('/dashboard')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
          返回
        </button>
        <span className="title top-nav-title">创建立约</span>
        <span className="nav-spacer" aria-hidden="true" />
      </header>

      <div className="mode-tabs" role="tablist" aria-label="立约模式">
        <ModeTab active={pactMode === 'solo'} onClick={() => selectMode('solo')} mode="solo" label="自律打卡" />
        <ModeTab active={pactMode === 'escrow'} onClick={() => selectMode('escrow')} mode="escrow" label="交付托管" />
        <ModeTab active={pactMode === 'bet'} onClick={() => selectMode('bet')} mode="bet" label="对赌" />
      </div>

      {pactMode === 'bet' ? (
        <BetForm />
      ) : pactMode === 'escrow' ? (
        <EscrowForm />
      ) : (
        <div role="tabpanel" aria-label="自律打卡">
          <div className="create-split">
            <div className="create-chat-col">
              <div className="chat-log" aria-label="AI 对话">
                {bubbles.map((m, i) => (
                  <div key={i} className={`chat-row${m.from === 'user' ? ' user' : ''}`}>
                    {m.from === 'bot' && <span className="bot-avatar" aria-hidden="true">忍</span>}
                    <div className={m.from === 'bot' ? 'bubble-bot' : 'bubble-user'} style={{ whiteSpace: 'pre-line' }}>{m.text}</div>
                  </div>
                ))}
                {thinking && (
                  <div className="chat-row">
                    <span className="bot-avatar" aria-hidden="true">忍</span>
                    <div className="bubble-bot"><span className="spinner" style={{ width: 14, height: 14 }} /> 思考中...</div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
              {showInput && (
                <div className="chat-compose">
                  <label className="sr-only" htmlFor="solo-chat-input">描述你的目标</label>
                  <input
                    id="solo-chat-input"
                    className="input"
                    placeholder="描述你的目标…"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSend()}
                    disabled={thinking}
                  />
                  <button type="button" className="btn btn-primary btn-sm" onClick={handleSend} disabled={thinking}>发送</button>
                </div>
              )}
            </div>

            <div className="create-side-col">
              {proposal && params ? (
                <div className="card card-jade proposal-panel">
                  <p className="label label-accent-jade">承诺摘要</p>
                  <dl>
                    <div className="proposal-row"><dt>目标</dt><dd>{proposal.goal}</dd></div>
                    <div className="proposal-row"><dt>证据</dt><dd>{proposal.evidenceDesc}</dd></div>
                  </dl>
                  <p className="label proposal-section-label label-normal">拖动调整参数</p>
                  <Slider label="周期" unit="天" value={params.durationDays} min={1} max={90}
                    onChange={d => setParams(p => p && ({ ...p, durationDays: d, totalRequired: Math.min(p.totalRequired, d) }))} />
                  <Slider label="打卡次数" unit="次" value={params.totalRequired} min={1} max={params.durationDays}
                    onChange={n => setParams(p => p && ({ ...p, totalRequired: n }))} />
                  <Slider label="质押" unit="mUSD" value={params.stake} min={10} max={1000} step={10}
                    onChange={s => setParams(p => p && ({ ...p, stake: s }))} />
                  <Slider label="免卡券" unit="张" value={params.restCards} min={0} max={10}
                    onChange={r => setParams(p => p && ({ ...p, restCards: r }))} />
                  <div className="proposal-row"><span>判负阈值</span><strong>{Math.max(1, Math.round(params.totalRequired * 0.2))} 次失败</strong></div>
                  <div className="toggle-row">
                    <span id="witness-label">邀请一位见证人</span>
                    <button
                      type="button"
                      className={`toggle${inviteWitness ? ' on' : ''}`}
                      aria-labelledby="witness-label"
                      aria-pressed={inviteWitness}
                      onClick={() => setInviteWitness(v => !v)}
                    />
                  </div>
                  <div className="action-row" style={{ marginTop: 12 }}>
                    <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => { setProposal(null); setParams(null) }} disabled={creating}>重新聊</button>
                    <button type="button" className="btn btn-primary" style={{ flex: 2 }} onClick={handleConfirm} disabled={creating}>
                      {creating ? <><span className="spinner" /> 上链中...</> : '确认并上链'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="card card-muted proposal-empty">
                  <p className="subtitle">与 AI 对话后，承诺摘要与参数会出现在这里。</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ModeTab({ active, onClick, mode, label }: { active: boolean; onClick: () => void; mode: 'solo' | 'escrow' | 'bet'; label: string }) {
  const icons = {
    solo: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /></svg>,
    escrow: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="M8 12h8M7 7h10v10H7z" /></svg>,
    bet: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2" /><circle cx="9" cy="9" r="1" fill="currentColor" /><circle cx="15" cy="15" r="1" fill="currentColor" /></svg>,
  }
  return (
    <button type="button" className={`mode-tab${active ? ' active' : ''}`} role="tab" aria-selected={active} onClick={onClick}>
      {icons[mode]}
      {label}
    </button>
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
      await waitReceipt(approveTx)

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
      await waitReceipt(createTx)

      toast('步骤 3/3：托管资金...', 'info')
      const ids = await publicClient.readContract({
        abi: NINJA_PACT_ABI, address: NINJA_PACT_ADDRESS,
        functionName: 'getUserCommitments', args: [address],
      })
      const newId = ids[ids.length - 1]
      const fundTx = await writeContractAsync({
        abi: NINJA_PACT_ABI, address: NINJA_PACT_ADDRESS, functionName: 'fund', args: [newId],
      })
      await waitReceipt(fundTx)

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
    <div role="tabpanel" aria-label="交付托管">
      <div className="card mode-form">
        <p className="label label-accent-jade">代码交付托管</p>
        <p className="subtitle">委托人托管资金，交付方提交源码与 demo，AI + 委托人验收后放款。</p>

        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>AI 帮你拟验收清单（可选）</div>
          <div className="chat-log" style={{ maxHeight: 180, marginBottom: 10 }}>
            {bubbles.map((m, i) => (
              <div key={i} className={`chat-row${m.from === 'user' ? ' user' : ''}`}>
                {m.from === 'bot' && <span className="bot-avatar" aria-hidden="true">忍</span>}
                <div className={m.from === 'bot' ? 'bubble-bot' : 'bubble-user'} style={{ whiteSpace: 'pre-line', fontSize: 13 }}>{m.text}</div>
              </div>
            ))}
            {thinking && (
              <div className="chat-row">
                <span className="bot-avatar" aria-hidden="true">忍</span>
                <div className="bubble-bot"><span className="spinner" style={{ width: 12, height: 12 }} /> 思考中...</div>
              </div>
            )}
          </div>
          <div className="chat-compose">
            <input className="input" placeholder="说说你要做什么…" value={input}
              onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSend()} disabled={thinking} />
            <button type="button" className="btn btn-primary btn-sm" onClick={handleSend} disabled={thinking}>发送</button>
          </div>
        </div>

        <div className="form-field">
          <label className="label" htmlFor="escrow-goal">开发需求</label>
          <textarea id="escrow-goal" className="input input-md" rows={4} placeholder="例如：做一个 Todo 网页应用，支持增删改与本地存储"
            value={deliverable} onChange={e => setDeliverable(e.target.value)} />
        </div>
        <div className="form-field">
          <label className="label" htmlFor="escrow-accept">可测验收标准</label>
          <textarea id="escrow-accept" className="input input-lg" rows={6}
            placeholder={'逐条写、可在 demo 上测：\n· 能新增任务\n· 能勾选完成\n· 刷新后数据还在\n· 手机端布局正常'}
            value={acceptance} onChange={e => setAcceptance(e.target.value)} />
        </div>
        <Slider label="托管金额" unit="mUSD" value={amount} min={10} max={2000} step={10} onChange={setAmount} />
        <Slider label="修改次数" unit="次" value={revisions} min={0} max={5} onChange={setRevisions} />
        <Slider label="截止天数" unit="天" value={days} min={1} max={30} onChange={setDays} />
        <button type="button" className="btn btn-primary btn-block mode-form-submit" onClick={handleCreate} disabled={creating || !ready}>
          {creating ? <><span className="spinner" /> 上链中...</> : `托管 ${amount} mUSD 并创建委托`}
        </button>
        {!ready && <p className="label" style={{ textAlign: 'center', marginTop: 8, textTransform: 'none' }}>填写开发需求和验收标准后即可创建</p>}
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
      await waitReceipt(approveTx)

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
      await waitReceipt(createTx)

      toast('步骤 3/3：押注...', 'info')
      const ids = await publicClient.readContract({
        abi: NINJA_PACT_ABI, address: NINJA_PACT_ADDRESS,
        functionName: 'getUserCommitments', args: [address],
      })
      const newId = ids[ids.length - 1]
      const fundTx = await writeContractAsync({
        abi: NINJA_PACT_ABI, address: NINJA_PACT_ADDRESS, functionName: 'fund', args: [newId],
      })
      await waitReceipt(fundTx)

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
    <div role="tabpanel" aria-label="公共事件对赌">
      <div className="card card-gold mode-form">
        <p className="label label-accent-gold">公共事件对赌</p>
        <p className="subtitle">双方等额押注，Judge 在截止日裁定结果并链上结算。</p>

        <div className="form-field">
          <label className="label" htmlFor="bet-event">对赌事件（可客观查证的 YES/NO 问题）</label>
          <textarea id="bet-event" className="input input-md" rows={4}
            placeholder="例如：Drake 会在 2026 年 10 月 1 日前发布新专辑吗？"
            value={question} onChange={e => setQuestion(e.target.value)} />
        </div>

        <p className="label" style={{ marginBottom: 8 }}>我押哪一边</p>
        <div className="bet-side-tabs" role="group" aria-label="押注方向" style={{ marginBottom: 'var(--sp-4)' }}>
          <button type="button" className={`bet-side-tab${betsYes ? ' active' : ''}`} aria-pressed={betsYes} onClick={() => setBetsYes(true)}>YES 会发生</button>
          <button type="button" className={`bet-side-tab${!betsYes ? ' active' : ''}`} aria-pressed={!betsYes} onClick={() => setBetsYes(false)}>NO 不会发生</button>
        </div>

        <Slider label="押注额（双方等额）" unit="mUSD" value={amount} min={10} max={2000} step={10} onChange={setAmount} />

        <div className="form-field bet-deadline-field">
          <label className="label" htmlFor="bet-deadline">裁定截止日</label>
          <input type="date" id="bet-deadline" className="input input-block" value={deadline}
            min={new Date(Date.now() + 86400_000).toISOString().slice(0, 10)}
            onChange={e => setDeadline(e.target.value)} />
        </div>

        <button type="button" className="btn btn-gold btn-block mode-form-submit" onClick={handleCreate} disabled={creating || !ready}>
          {creating ? <><span className="spinner" /> 上链中...</> : `押 ${amount} mUSD 并创建对赌`}
        </button>
        {!ready && <p className="label" style={{ textAlign: 'center', marginTop: 8, textTransform: 'none' }}>填写对赌事件、选边、设定截止日后即可创建</p>}
      </div>
    </div>
  )
}

function Slider({ label, unit, value, min, max, step = 1, onChange }: {
  label: string; unit: string; value: number; min: number; max: number; step?: number
  onChange: (v: number) => void
}) {
  const pct = max === min ? 0 : ((value - min) / (max - min)) * 100
  return (
    <div className="slider-row">
      <div className="slider-head"><span>{label}</span><strong>{value} {unit}</strong></div>
      <input type="range" className="np-slider" min={min} max={max} step={step} value={value}
        style={{ '--p': `${pct}%` } as CSSProperties}
        onChange={e => onChange(Number(e.target.value))}
        aria-label={label} />
    </div>
  )
}
