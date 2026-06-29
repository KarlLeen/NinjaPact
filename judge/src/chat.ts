// LLM 立约对话:把模糊目标追问成「可被 AI 裁判照片验收」的结构化承诺。
// 用 GLM 文本模型(glm-4.7);Judge 保持无状态——前端每轮带完整历史。

const GLM_BASE = 'https://open.bigmodel.cn/api/paas/v4'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatQuestion {
  type: 'question'
  message: string
}

export interface ChatProposal {
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

export interface EscrowChatProposal {
  type: 'proposal'
  kind: 'escrow'
  summary: string
  goal: string         // 精炼后的开发需求
  acceptance: string   // 可测验收清单(每条一行)
  stake: number
  revisions: number
  durationDays: number
}

export type ChatResult = ChatQuestion | ChatProposal | EscrowChatProposal
export type ChatMode = 'habit' | 'escrow'

const SYSTEM_PROMPT = `你是 NinjaPact(忍者契约)的立约助手。用户想立一个自律承诺并质押稳定币,之后由 AI 裁判验收用户实时拍摄的照片证据。

你的唯一任务:把用户模糊的目标聊成「能被 AI 裁判通过照片验收」的**明确定义**。只需澄清两件事:
1. 具体做什么
2. 拍什么照片算有效证据(可裁决的关键,比如「早睡」→ 拍什么证明?「跑步」→ 拍跑步机读数还是户外定位?)

**不要**追问天数、打卡次数、质押金额、免卡券——这些用户会在界面上用滑块自己调,你只在 proposal 里给出合理的建议默认值即可。

规则:最多问 1 次澄清。如果用户第一句已经能看出做什么+拍什么算数,直接给 proposal。语气简洁、忍者风、中文。

每次回复必须是严格合法 JSON,二选一,不要输出任何 JSON 以外的文字:
- 还需澄清:{"type":"question","message":"你的追问(只问做什么/拍什么算数)"}
- 定义清楚了:{"type":"proposal","summary":"一句话中文摘要","goal":"精炼后的可裁决目标","evidenceDesc":"什么照片算有效证据","durationDays":建议天数,"totalRequired":建议打卡总次数,"stake":建议质押mUSD,"restCards":建议免卡券,"failThreshold":建议判负阈值}

数字给合理建议(默认偏温和:如 30 天 12 次、质押 100、免卡券 3、判负阈值为次数的 20%),用户会再调。`

// 代码交付担保立约:把模糊需求逼成「可在 demo 上逐条勾选的验收清单」(纠纷只对照它裁)。
const ESCROW_SYSTEM_PROMPT = `你是 NinjaPact 的「代码交付担保」立约助手。委托人想花钱外包一个软件,把钱托管;交付方交源码 + 可测 demo,委托人在 demo 上逐条验收,通过才放款。

你的唯一任务:把委托人模糊的需求,聊成一份**可在 demo 上逐条勾选的验收清单**——这是整个担保的承重墙,日后所有纠纷只对照它裁。澄清两件事:
1. 到底要做什么(什么应用 / 哪些功能)
2. 怎样算「做好了」——拆成具体、可在 demo 上点一下就能验证的行为(如「能新增任务」「刷新后数据还在」「手机端不错位」),**避免模糊词**(如「好用」「美观」「高性能」)。

**不要**追问金额、修改次数、天数——委托人用滑块自己调,你只在 proposal 里给建议默认值。

规则:最多问 1 次澄清;若第一句已能拆出清单,直接给 proposal。中文、简洁。

每次回复必须是严格合法 JSON,二选一,不要输出 JSON 以外任何文字:
- 还需澄清:{"type":"question","message":"追问(只问做什么/怎样算做好)"}
- 清楚了:{"type":"proposal","kind":"escrow","summary":"一句话中文摘要","goal":"精炼后的开发需求","acceptance":"验收清单,每条一行,用「· 」开头,3-6 条","stake":建议mUSD,"revisions":建议修改次数,"durationDays":建议天数}

数字给温和默认(如质押 200、修改次数 2、天数 7),用户会再调。`

export async function chatTurn(messages: ChatMessage[], mode: ChatMode = 'habit'): Promise<ChatResult> {
  const model = process.env.AI_CHAT_MODEL ?? 'glm-4-flash'
  const apiKey = process.env.AI_API_KEY ?? ''
  const systemPrompt = mode === 'escrow' ? ESCROW_SYSTEM_PROMPT : SYSTEM_PROMPT

  const resp = await fetch(`${GLM_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature: 0.4,
      max_tokens: 800,
    }),
  })

  if (!resp.ok) {
    const errText = await resp.text()
    throw new Error(`GLM chat error ${resp.status}: ${errText}`)
  }

  const data = await resp.json() as { choices: Array<{ message: { content: string } }> }
  const raw = (data.choices[0]?.message?.content ?? '{}').trim()

  // GLM sometimes wraps JSON in ```json fences or prepends prose like "还需澄清:".
  // Extract the JSON object from the first '{' to the last '}'.
  let parsed: (Partial<ChatProposal> & Partial<EscrowChatProposal> & { type?: string; message?: string }) | null = null
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try { parsed = JSON.parse(raw.slice(start, end + 1)) } catch { parsed = null }
  }
  if (!parsed) {
    // No parseable JSON → treat the whole reply as a clarifying message
    return { type: 'question', message: raw.slice(0, 200) }
  }

  if (parsed.type === 'proposal') {
    if (mode === 'escrow') {
      return {
        type: 'proposal',
        kind: 'escrow',
        summary: String(parsed.summary ?? '已生成委托'),
        goal: String(parsed.goal ?? ''),
        acceptance: String(parsed.acceptance ?? ''),
        stake: clampInt(parsed.stake, 1, 100000, 200),
        revisions: clampInt(parsed.revisions, 0, 10, 2),
        durationDays: clampInt(parsed.durationDays, 1, 365, 7),
      }
    }
    return {
      type: 'proposal',
      summary: String(parsed.summary ?? '已生成承诺'),
      goal: String(parsed.goal ?? ''),
      evidenceDesc: String(parsed.evidenceDesc ?? ''),
      durationDays: clampInt(parsed.durationDays, 1, 365, 30),
      totalRequired: clampInt(parsed.totalRequired, 1, 365, 12),
      stake: clampInt(parsed.stake, 1, 100000, 100),
      restCards: clampInt(parsed.restCards, 0, 30, 3),
      failThreshold: clampInt(parsed.failThreshold, 1, 365, 3),
    }
  }

  return { type: 'question', message: String(parsed.message ?? '能再说具体一点吗?') }
}

function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return dflt
  return Math.max(min, Math.min(max, n))
}
