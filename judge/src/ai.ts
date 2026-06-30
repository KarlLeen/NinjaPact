export interface AiVerdict {
  pass: boolean
  confidence: number
  reasoning: string
  useRestCard: boolean
}

interface ContentPart {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string }
}

const GLM_BASE = 'https://open.bigmodel.cn/api/paas/v4'

export type VerdictKind = 'habit' | 'escrow'

function buildPrompt(goal: string, challenge: string): string {
  return `你是 NinjaPact 的严格打卡裁判。

【承诺目标】${goal}

【实时验证指令】用户拍摄时需要完成：「${challenge}」

判断标准：
1. 照片中是否能看出用户正在履行上述承诺？
2. 照片中是否完成了验证指令「${challenge}」？
3. 照片是否是实时拍摄（非AI生成/翻拍屏幕/库存图）？

必须以合法JSON回复，格式：
{"pass":true/false,"confidence":0.0-1.0,"reasoning":"中文理由50字内","use_rest_card":false}

只输出JSON，不要其他内容。`
}

// Escrow (DEPOSIT) verification: a deliverer submits a photo of a finished deliverable.
// No liveness gesture (it doesn't fit physical/digital deliverables) — instead judge the
// deliverable against the payer's acceptance criteria, plus an authenticity check.
function buildEscrowPrompt(termsText: string): string {
  let goal = termsText
  let evidence = ''
  try {
    const t = JSON.parse(termsText) as { goal?: string; evidence?: string }
    if (t.goal) goal = t.goal
    if (t.evidence) evidence = t.evidence
  } catch { /* termsText is plain text; use as goal */ }

  return `你是 NinjaPact 托管交付的验收官。委托方已把钱托管进合约，交付方现在提交成品照片申请放款。请严格但公正地验收。

【交付要求】${goal}
${evidence ? `【验收标准】${evidence}` : ''}

判断标准：
1. 照片是否展示了符合「交付要求」的成品？
2. 是否满足「验收标准」？（若未提供标准，则以交付要求为准）
3. 照片是否真实可信（无明显 AI 生成、网络盗图、翻拍屏幕、与要求无关等造假迹象）？

通过=三点都满足；只要明显不符合交付要求或有造假迹象，则不通过。放款不可逆，宁可严格。

必须以合法JSON回复，格式：
{"pass":true/false,"confidence":0.0-1.0,"reasoning":"中文理由50字内","use_rest_card":false}

只输出JSON，不要其他内容。`
}

export async function callAI(
  goal: string,
  challenge: string,
  imageDataUrl: string,
  restCardsLeft: number,
  modelOverride?: string,
  kind: VerdictKind = 'habit',
): Promise<AiVerdict> {
  const model = modelOverride ?? process.env.AI_MODEL ?? 'glm-4v-flash'
  const apiKey = process.env.AI_API_KEY ?? ''

  // Zhipu GLM-4V wants RAW base64 in image_url.url (no "data:image/...;base64," prefix)
  const base64 = imageDataUrl.replace(/^data:image\/\w+;base64,/, '')

  // Escrow uses a delivery-acceptance prompt (no liveness gesture); habit uses the check-in prompt.
  const prompt = kind === 'escrow' ? buildEscrowPrompt(goal) : buildPrompt(goal, challenge)
  const userContent: ContentPart[] = [
    { type: 'text', text: prompt },
    { type: 'image_url', image_url: { url: base64 } },
  ]

  const resp = await fetch(`${GLM_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: userContent }],
      temperature: 0.1,
      max_tokens: 300,
    }),
  })

  if (!resp.ok) {
    const errText = await resp.text()
    throw new Error(`GLM API error ${resp.status}: ${errText}`)
  }

  const data = await resp.json() as {
    choices: Array<{ message: { content: string } }>
  }

  // Strip markdown code fences if the model wraps in ```json ... ```
  const raw = (data.choices[0]?.message?.content ?? '{}').trim()
  const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')

  let parsed: { pass?: boolean; confidence?: number; reasoning?: string; use_rest_card?: boolean }
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error(`GLM returned invalid JSON: ${raw}`)
  }

  const pass = Boolean(parsed.pass)
  const confidence = Number(parsed.confidence ?? 0.5)
  const reasoning = String(parsed.reasoning ?? '裁判已处理')

  const suggestRestCard = !pass && confidence < 0.65 && restCardsLeft > 0
  const useRestCard = !pass && Boolean(parsed.use_rest_card ?? suggestRestCard)

  return { pass, confidence, reasoning, useRestCard }
}

// ─── Code-delivery escrow (B3): text-only judgments ──────────────────────────
// The AI is a referee here, not the primary verifier (the payer tests the demo).

const GLM_TEXT_MODEL = process.env.AI_CHAT_MODEL ?? 'glm-4-flash'
const GLM_ARBITER_MODEL = process.env.AI_ARBITER_MODEL ?? GLM_TEXT_MODEL

// Azure OpenAI (GPT-5.4) — terminal arbitration only; falls back to GLM if key absent.
const AZURE_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT ?? 'https://models.inference.ai.azure.com'
const AZURE_API_KEY = process.env.AZURE_OPENAI_API_KEY ?? ''

async function callAzureText(prompt: string): Promise<string> {
  if (!AZURE_API_KEY) return callGlmText(prompt, GLM_ARBITER_MODEL)
  const resp = await fetch(`${AZURE_ENDPOINT}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': AZURE_API_KEY },
    body: JSON.stringify({
      model: 'gpt-5.4',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 400,
    }),
  })
  if (!resp.ok) throw new Error(`Azure OpenAI error ${resp.status}: ${await resp.text()}`)
  const data = await resp.json() as { choices: Array<{ message: { content: string } }> }
  return (data.choices[0]?.message?.content ?? '{}').trim()
}

async function callGlmText(prompt: string, model: string): Promise<string> {
  const apiKey = process.env.AI_API_KEY ?? ''
  const resp = await fetch(`${GLM_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.2, max_tokens: 400 }),
  })
  if (!resp.ok) throw new Error(`GLM API error ${resp.status}: ${await resp.text()}`)
  const data = await resp.json() as { choices: Array<{ message: { content: string } }> }
  return (data.choices[0]?.message?.content ?? '{}').trim()
}

function extractJson<T>(raw: string): T {
  const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  const start = cleaned.indexOf('{'); const end = cleaned.lastIndexOf('}')
  return JSON.parse(start >= 0 && end >= 0 ? cleaned.slice(start, end + 1) : cleaned) as T
}

/// In-spec referee (advisory): is the payer's complaint within the original spec, or scope creep?
export async function assessInSpec(spec: string, complaint: string): Promise<{ inSpec: boolean; reasoning: string }> {
  const prompt = `你是代码交付担保的中立仲裁助手。立约时定下了验收标准，现在委托人提出一条异议，请判断它是否落在【原始验收标准】之内。

【原始验收标准】${spec}

【委托人的异议】${complaint}

判断：异议要求的本就属于原始标准 → in_spec=true(交付人应修正)；是标准之外的新需求/加需求(scope creep)→ in_spec=false(不应强求交付人免费做)。

必须以合法JSON回复：{"in_spec":true/false,"reasoning":"中文50字内"}
只输出JSON。`
  const p = extractJson<{ in_spec?: boolean; reasoning?: string }>(await callGlmText(prompt, GLM_TEXT_MODEL))
  return { inSpec: Boolean(p.in_spec), reasoning: String(p.reasoning ?? '') }
}

/// Terminal arbiter: revisions exhausted, payer still unsatisfied. Binding pass/fail vs the
/// ORIGINAL spec + dispute history. (Path A: judges the record; Path B will test the built demo.)
export async function arbitrateDelivery(
  spec: string, complaints: string[], demoLink: string,
): Promise<{ pass: boolean; reasoning: string }> {
  const history = complaints.length
    ? complaints.map((c, i) => `第${i + 1}次异议：${c}`).join('\n')
    : '（无具体异议记录）'
  const prompt = `你是代码交付担保的终局仲裁者。委托人用尽修改次数仍不满意，由你对照【原始验收标准】做有约束力的终局裁决：交付是否达标？

【原始验收标准】${spec}

【交付方提供的可测 demo】${demoLink}

【委托人历次异议】
${history}

原则：只对照原始验收标准，不理会标准之外的新要求(scope creep)。交付实质满足原始标准、异议多为加需求 → pass=true(放款交付人)；交付确实未达原始标准且异议在标准内未解决 → pass=false(退款委托人)。放款不可逆，证据不足时偏向保护出资的委托人。

必须以合法JSON回复：{"pass":true/false,"reasoning":"中文60字内裁决理由"}
只输出JSON。`
  const p = extractJson<{ pass?: boolean; reasoning?: string }>(await callAzureText(prompt))
  return { pass: Boolean(p.pass), reasoning: String(p.reasoning ?? '') }
}

// ─── DUO public-event bet oracle (能力展示) ──────────────────────────────────
// The Judge agent resolves a public yes/no event (e.g. "Drake 在 X 前发新专辑") into
// outcome=true/false, signs it, and the contract pays the winning side. MVP uses model
// reasoning + a confidence; web retrieval can be layered on later.
export async function resolveEvent(
  question: string,
): Promise<{ outcome: boolean; reasoning: string; confidence: number }> {
  const prompt = `你是 NinjaPact 的公共事件裁定 agent。两人就一个公共事件对赌,现已到裁定时点,请你依据公开事实做出 YES(发生)/ NO(未发生) 的客观裁定。

【对赌事件】${question}

要求:
1. 只裁定客观、可公开核实的事实结果(发生=outcome:true,未发生=outcome:false)。
2. 给出简短中文理由,说明依据。
3. 若事实不明确,confidence 给低分,并按你掌握的最可能结果裁定。

必须以合法JSON回复:{"outcome":true/false,"confidence":0.0-1.0,"reasoning":"中文60字内"}
只输出JSON。`
  const p = extractJson<{ outcome?: boolean; confidence?: number; reasoning?: string }>(
    await callGlmText(prompt, GLM_ARBITER_MODEL),
  )
  return {
    outcome: Boolean(p.outcome),
    confidence: Number(p.confidence ?? 0.5),
    reasoning: String(p.reasoning ?? '裁定已处理'),
  }
}
