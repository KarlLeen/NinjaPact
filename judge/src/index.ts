import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import multer from 'multer'
import { authRouter, requireAuth } from './auth.js'
import {
  readCommitment, readEscrow, submitVerdict, arbitrate, resolveBet, readSchedule, account, publicClient,
  watchVerdictDisputes, watchArbitrations,
} from './chain.js'
import { keccak256, stringToBytes } from 'viem'
import { callAI, assessInSpec, arbitrateDelivery, resolveEvent } from './ai.js'
import { chatTurn, type ChatMessage } from './chat.js'
import { saveImage, saveVerdictArchive, loadImage, loadVerdictArchive, loadImageRaw } from './storage.js'
import { getTerms, saveTerms } from './terms.js'
import { getBetResult, saveBetResult } from './betresult.js'
import {
  saveSource, loadSource, saveDeliveryMeta, loadDeliveryMeta, saveDispute, loadDispute, loadDisputeHistory,
} from './custody.js'

const app = express()
const PORT = Number(process.env.PORT ?? 3001)
// FRONTEND_ORIGIN may be a comma-separated allowlist (e.g. prod + localhost)
const ORIGINS = (process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean)

app.use(cors({ origin: ORIGINS }))
// JSON limit covers evidence images (~5 MB → ~7 MB base64). Escrow source uploads no
// longer ride in JSON — they use multipart/form-data (sourceUpload below), so JSON only
// carries evidence now. Keep in sync with nginx client_max_body_size.
app.use(express.json({ limit: '10mb' }))

// Multipart parser for the escrow source bundle (binary, held in memory then encrypted
// to disk). MVP cap = 10 MB (fits under nginx client_max_body_size 12m).
const sourceUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })

// ─── Health / info ────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ ok: true, judgeAddress: account.address })
})

app.get('/judge-address', (_req, res) => {
  res.json({ address: account.address })
})

// ─── Auth routes ──────────────────────────────────────────────────────────────

app.use('/', authRouter)

// ─── LLM 立约对话 ────────────────────────────────────────────────────────────
// POST /chat { messages: [{role,content}] } → {type:'question'|'proposal', ...}
// 无状态:前端每轮带完整历史。无需 JWT(立约前的规划对话,降低门槛)。
app.post('/chat', async (req, res) => {
  const { messages, mode } = req.body as { messages?: ChatMessage[]; mode?: 'habit' | 'escrow' }
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: 'messages array required' })
    return
  }
  // 防滥用:限制历史长度
  if (messages.length > 20) {
    res.status(400).json({ error: 'conversation too long' })
    return
  }
  try {
    const result = await chatTurn(messages, mode === 'escrow' ? 'escrow' : 'habit')
    res.json(result)
  } catch (e) {
    res.status(502).json({ error: `AI chat error: ${String(e)}` })
  }
})

// ─── Commitment terms (off-chain text, hash-gated) ───────────────────────────
// POST /terms { commitmentId, termsText } — stored only if keccak256(text) matches
// the commitment's on-chain termsHash (tamper-proof, no auth needed).
app.post('/terms', async (req, res) => {
  const { commitmentId, termsText } = req.body as { commitmentId?: string; termsText?: string }
  if (!commitmentId || typeof termsText !== 'string') {
    res.status(400).json({ error: 'commitmentId and termsText required' })
    return
  }

  let id: bigint
  try { id = BigInt(commitmentId) } catch { res.status(400).json({ error: 'invalid commitmentId' }); return }

  let info
  try {
    info = await readCommitment(id)
  } catch (e) {
    res.status(500).json({ error: `chain read failed: ${String(e)}` })
    return
  }

  const computed = keccak256(stringToBytes(termsText)).toLowerCase()
  if (computed !== info.termsHash.toLowerCase()) {
    res.status(400).json({ error: 'terms do not match on-chain termsHash' })
    return
  }

  saveTerms(commitmentId, termsText)
  res.json({ ok: true })
})

// GET /terms/:id → { termsText } | 404
app.get('/terms/:id', (req, res) => {
  const termsText = getTerms(req.params.id)
  if (termsText == null) {
    res.status(404).json({ error: 'not found' })
    return
  }
  res.json({ termsText })
})

// ─── Code-delivery escrow (B2): source custody · gated release · dispute ──────

// POST /deliver — deliverer uploads source (held encrypted) + demo link.
// multipart/form-data: file field `source` (binary, no base64 inflation) + text fields
// commitmentId, demoLink, filename. Returns sourceHash to anchor via submitDelivery.
app.post('/deliver', requireAuth, sourceUpload.single('source'), async (req, res) => {
  const userAddress = (req as typeof req & { userAddress: string }).userAddress
  const { commitmentId, filename, demoLink } = req.body as {
    commitmentId?: string; filename?: string; demoLink?: string
  }
  const file = (req as typeof req & { file?: Express.Multer.File }).file
  if (!commitmentId || !file || !demoLink) {
    res.status(400).json({ error: 'commitmentId, source file, demoLink required' }); return
  }
  let id: bigint
  try { id = BigInt(commitmentId) } catch { res.status(400).json({ error: 'invalid commitmentId' }); return }

  let info, escrow
  try { info = await readCommitment(id); escrow = await readEscrow(id) }
  catch (e) { res.status(500).json({ error: `chain read failed: ${String(e)}` }); return }

  if (info.mode !== 4) { res.status(400).json({ error: 'not a DEPOSIT escrow' }); return }
  if (info.state !== 2) { res.status(400).json({ error: 'commitment not Active' }); return }
  if (info.parties[1] !== userAddress.toLowerCase()) { res.status(403).json({ error: 'caller is not the deliverer' }); return }
  // phase must be InProgress(1) or RevisionRequested(3) — i.e. awaiting a (re)delivery
  if (escrow.phase !== 1 && escrow.phase !== 3) { res.status(400).json({ error: `not awaiting delivery (phase=${escrow.phase})` }); return }

  const buf = file.buffer
  const { sourceHash } = saveSource(commitmentId, buf)
  saveDeliveryMeta(commitmentId, {
    demoLink, sourceHash, filename: filename || file.originalname || 'source.zip', size: buf.length,
    submittedAt: new Date().toISOString(),
  })
  console.log(`[deliver] commitment=${id} bytes=${buf.length} sourceHash=${sourceHash} demo=${demoLink}`)
  res.json({ sourceHash }) // frontend → submitDelivery(id, sourceHash)
})

// GET /deliver/:id/meta — demo link + source hash (payer reviews; no source bytes leak)
app.get('/deliver/:id/meta', (req, res) => {
  const meta = loadDeliveryMeta(req.params.id)
  if (!meta) { res.status(404).json({ error: 'no delivery yet' }); return }
  res.json({
    demoLink: meta.demoLink, sourceHash: meta.sourceHash,
    filename: meta.filename, size: meta.size, submittedAt: meta.submittedAt,
  })
})

// GET /deliver/:id/source — RELEASE GATE: only the payer, only after delivered settlement
app.get('/deliver/:id/source', requireAuth, async (req, res) => {
  const userAddress = (req as typeof req & { userAddress: string }).userAddress
  let id: bigint
  try { id = BigInt(req.params.id) } catch { res.status(400).json({ error: 'invalid id' }); return }

  let info, escrow
  try { info = await readCommitment(id); escrow = await readEscrow(id) }
  catch (e) { res.status(500).json({ error: `chain read failed: ${String(e)}` }); return }

  if (info.parties[0] !== userAddress.toLowerCase()) { res.status(403).json({ error: 'only the payer may download' }); return }
  if (!escrow.delivered) { res.status(403).json({ error: 'source locked — release only after payment/settlement' }); return }

  const buf = loadSource(req.params.id)
  if (!buf) { res.status(404).json({ error: 'source not found' }); return }
  const meta = loadDeliveryMeta(req.params.id)
  res.setHeader('Content-Disposition', `attachment; filename="${meta?.filename ?? 'source.zip'}"`)
  res.type('application/octet-stream').send(buf)
})

// POST /dispute — store the payer's complaint, hash-gated against on-chain disputeMsgHash
// (frontend computes keccak256(message), calls requestRevision(id, hash), then posts here)
app.post('/dispute', async (req, res) => {
  const { commitmentId, message } = req.body as { commitmentId?: string; message?: string }
  if (!commitmentId || typeof message !== 'string') {
    res.status(400).json({ error: 'commitmentId and message required' }); return
  }
  let id: bigint
  try { id = BigInt(commitmentId) } catch { res.status(400).json({ error: 'invalid commitmentId' }); return }

  let escrow
  try { escrow = await readEscrow(id) } catch (e) { res.status(500).json({ error: `chain read failed: ${String(e)}` }); return }

  const computed = keccak256(stringToBytes(message)).toLowerCase()
  if (computed !== escrow.disputeMsgHash.toLowerCase()) {
    res.status(400).json({ error: 'message does not match on-chain disputeMsgHash' }); return
  }

  // Advisory in-spec referee (off-chain): is this complaint within the original spec?
  let advisory: { inSpec: boolean; reasoning: string } | undefined
  const spec = getTerms(commitmentId)
  if (spec) {
    try { advisory = await assessInSpec(spec, message) }
    catch (e) { console.error('[dispute] in-spec referee failed:', String(e)) }
  }
  saveDispute(commitmentId, message, escrow.revisionsUsed, advisory)
  res.json({ ok: true, advisory })
})

// GET /dispute/:id — latest complaint text (deliverer reads what to fix)
app.get('/dispute/:id', (req, res) => {
  const d = loadDispute(req.params.id)
  if (!d) { res.status(404).json({ error: 'no dispute' }); return }
  res.json(d)
})

// GET /verdict/:id/:dayIndex → latest archived verdict (so a witness can review before disputing)
app.get('/verdict/:id/:dayIndex', (req, res) => {
  const a = loadVerdictArchive(req.params.id, Number(req.params.dayIndex))
  if (!a) { res.status(404).json({ error: 'not found' }); return }
  res.json({
    pass: a.pass,
    reasoning: a.reasoning,
    confidence: a.confidence,
    challenge: a.challenge,
    reReview: a.reReview ?? false,
    dayIndex: a.dayIndex,
  })
})

// GET /verdict/:id/:dayIndex/photo → the evidence image (for the witness to review)
app.get('/verdict/:id/:dayIndex/photo', (req, res) => {
  const img = loadImageRaw(req.params.id, Number(req.params.dayIndex))
  if (!img) { res.status(404).json({ error: 'not found' }); return }
  res.type(img.contentType).send(img.buffer)
})

// ─── Evidence submission ──────────────────────────────────────────────────────

// POST /evidence
// Body: { commitmentId: string, image: string (data URL), termsText: string, challenge: string }
app.post('/evidence', requireAuth, async (req, res) => {
  const userAddress = (req as typeof req & { userAddress: string }).userAddress

  const { commitmentId, image, termsText, challenge } = req.body as {
    commitmentId?: string
    image?: string
    termsText?: string
    challenge?: string
  }

  if (!commitmentId || !image || !termsText) {
    res.status(400).json({ error: 'commitmentId, image, and termsText are required' })
    return
  }

  let id: bigint
  try {
    id = BigInt(commitmentId)
  } catch {
    res.status(400).json({ error: 'Invalid commitmentId' })
    return
  }

  // Read commitment from chain
  let info
  try {
    info = await readCommitment(id)
  } catch (e) {
    res.status(500).json({ error: `Chain read failed: ${String(e)}` })
    return
  }

  // Validate judge address
  if (info.judgeAddr !== account.address.toLowerCase()) {
    res.status(403).json({ error: 'This Judge is not authorized for this commitment' })
    return
  }

  // Validate commitment is Active (state = 2)
  if (info.state !== 2) {
    res.status(400).json({ error: `Commitment is not Active (state=${info.state})` })
    return
  }

  // Validate caller is a party
  if (!info.parties.includes(userAddress.toLowerCase())) {
    res.status(403).json({ error: 'Caller is not a party in this commitment' })
    return
  }

  const restCardsLeft = info.restCards - info.restCardsUsed
  const effectiveChallenge = challenge ?? '比出数字 ' + (Math.floor(Math.random() * 9) + 1)
  const dayIndex = info.nextDayIndex
  const kind = info.mode === 4 ? 'escrow' : 'habit' // DEPOSIT → delivery-acceptance prompt

  // Persist the raw photo (encrypted-at-rest concern noted; plaintext for MVP) and hash it
  const { imageSha256, imagePath } = saveImage(commitmentId, dayIndex, image)

  // Call GLM vision AI
  let verdict
  try {
    verdict = await callAI(termsText, effectiveChallenge, image, restCardsLeft, undefined, kind)
  } catch (e) {
    res.status(502).json({ error: `AI service error: ${String(e)}` })
    return
  }

  // The on-chain reasonHash anchors a canonical record binding reasoning + evidence hash
  const reasoningPayload = JSON.stringify({
    reasoning: verdict.reasoning,
    imageSha256,
    dayIndex,
    challenge: effectiveChallenge,
  })

  // Sign (EIP-712) + broadcast submitVerdict
  let result
  try {
    result = await submitVerdict(id, dayIndex, verdict.pass, verdict.useRestCard, reasoningPayload)
  } catch (e) {
    res.status(500).json({ error: `Chain write failed: ${String(e)}` })
    return
  }

  // Archive full auditable record off-chain
  const archivePath = saveVerdictArchive({
    commitmentId,
    dayIndex,
    pass: verdict.pass,
    useRestCard: verdict.useRestCard,
    confidence: verdict.confidence,
    reasoning: verdict.reasoning,
    challenge: effectiveChallenge,
    termsText,
    imageSha256,
    reasonHash: result.reasonHash,
    signature: result.signature,
    txHash: result.txHash,
    submittedBy: account.address,
    timestamp: new Date().toISOString(),
    reReview: false,
  })

  console.log(
    `[verdict] commitment=${id} day=${dayIndex} pass=${verdict.pass} useRestCard=${verdict.useRestCard} ` +
    `confidence=${verdict.confidence.toFixed(2)} tx=${result.txHash}`,
  )
  console.log(`[evidence] image=${imagePath} archive=${archivePath}`)

  res.json({
    pass: verdict.pass,
    useRestCard: verdict.useRestCard,
    confidence: verdict.confidence,
    reasoning: verdict.reasoning,
    dayIndex,
    reasonHash: result.reasonHash,
    txHash: result.txHash,
  })
})

// ─── Witness dispute → flagship re-review ──────────────────────────────────────
// On VerdictUnderReview, re-judge the archived photo with the flagship model and
// re-submit; the contract overwrites the original verdict via its re-review path.
const REVIEW_MODEL = process.env.AI_REVIEW_MODEL ?? 'glm-4v-plus'

async function handleDispute(id: bigint, dayIndex: number) {
  const cid = id.toString()
  console.log(`[dispute] commitment=${cid} day=${dayIndex} → flagship re-review (${REVIEW_MODEL})`)
  try {
    const info = await readCommitment(id)
    if (info.judgeAddr !== account.address.toLowerCase()) return // not our commitment
    if (info.state !== 2) { console.log('[dispute] not Active, skip'); return }

    const archive = loadVerdictArchive(cid, dayIndex)
    const image = loadImage(cid, dayIndex)
    if (!archive || !image) { console.error('[dispute] missing evidence archive/image, skip'); return }

    const restCardsLeft = info.restCards - info.restCardsUsed
    const kind = info.mode === 4 ? 'escrow' : 'habit'
    const verdict = await callAI(archive.termsText, archive.challenge, image, restCardsLeft, REVIEW_MODEL, kind)

    const reasoningPayload = JSON.stringify({
      reasoning: verdict.reasoning,
      imageSha256: archive.imageSha256,
      dayIndex,
      challenge: archive.challenge,
      reReview: true,
      model: REVIEW_MODEL,
    })

    const result = await submitVerdict(id, dayIndex, verdict.pass, verdict.useRestCard, reasoningPayload)
    saveVerdictArchive({
      ...archive,
      pass: verdict.pass,
      useRestCard: verdict.useRestCard,
      confidence: verdict.confidence,
      reasoning: `[复核 ${REVIEW_MODEL}] ${verdict.reasoning}`,
      reasonHash: result.reasonHash,
      signature: result.signature,
      txHash: result.txHash,
      timestamp: new Date().toISOString(),
      reReview: true,
    })
    console.log(`[dispute] re-review done commitment=${cid} day=${dayIndex} pass=${verdict.pass} tx=${result.txHash}`)
  } catch (e) {
    console.error(`[dispute] re-review failed commitment=${cid} day=${dayIndex}: ${String(e)}`)
  }
}

// ─── Escrow terminal arbitration (B3) ──────────────────────────────────────────
// On ArbitrationRequested, the Judge rules pass/fail against the ORIGINAL spec +
// dispute history and submits the binding arbitrate() verdict on-chain.
async function handleArbitration(id: bigint) {
  const cid = id.toString()
  console.log(`[arbitrate] commitment=${cid} → terminal ruling`)
  try {
    const info = await readCommitment(id)
    if (info.judgeAddr !== account.address.toLowerCase()) return // not our commitment
    const escrow = await readEscrow(id)
    if (escrow.phase !== 4) { console.log('[arbitrate] not in Arbitration, skip'); return }

    const spec = getTerms(cid) ?? ''
    const meta = loadDeliveryMeta(cid)
    const complaints = loadDisputeHistory(cid).map(d => d.message) // every round, not just the last

    const verdict = await arbitrateDelivery(spec, complaints, meta?.demoLink ?? '')
    const reasoning = JSON.stringify({
      arbitration: true,
      pass: verdict.pass,
      reasoning: verdict.reasoning,
      demoLink: meta?.demoLink,
      sourceHash: meta?.sourceHash,
    })
    const result = await arbitrate(id, verdict.pass, reasoning)
    console.log(`[arbitrate] commitment=${cid} pass=${verdict.pass} tx=${result.txHash} — ${verdict.reasoning}`)
  } catch (e) {
    console.error(`[arbitrate] failed commitment=${cid}: ${String(e)}`)
  }
}

// ─── DUO public-event bet resolution (能力展示) ──────────────────────────────
// POST /resolve-bet/:id — Judge acts as the event oracle: determines the outcome,
// signs it, and submits resolveBet on-chain → the winning side takes the pot. Guarded:
// must be our DUO bet, Active, past the event deadline. Triggered by the keeper at deadline
// (idempotent — a second call after settlement reverts on-chain and is caught).
app.post('/resolve-bet/:id', async (req, res) => {
  const cid = req.params.id
  let id: bigint
  try { id = BigInt(cid) } catch { res.status(400).json({ error: 'invalid id' }); return }
  try {
    const info = await readCommitment(id)
    if (info.judgeAddr !== account.address.toLowerCase()) { res.status(403).json({ error: 'not our commitment' }); return }
    if (info.mode !== 1) { res.status(400).json({ error: 'not a DUO bet' }); return }            // 1 = DUO
    if (info.state !== 2) { res.status(400).json({ error: `not Active (state=${info.state})` }); return } // 2 = Active

    const sched = await readSchedule(id)
    if (Math.floor(Date.now() / 1000) < sched.endTime) {
      res.status(400).json({ error: 'event deadline not reached' }); return
    }

    const termsRaw = getTerms(cid) ?? ''
    if (!termsRaw) { res.status(400).json({ error: 'event question not found (terms not stored)' }); return }
    // terms is JSON {goal: question, ...}; fall back to the raw text
    let question = termsRaw
    try { const t = JSON.parse(termsRaw) as { goal?: string }; if (t.goal) question = t.goal } catch { /* plain text */ }

    const verdict = await resolveEvent(question)
    const reasoning = JSON.stringify({
      bet: true, outcome: verdict.outcome, confidence: verdict.confidence,
      reasoning: verdict.reasoning, question,
    })
    const result = await resolveBet(id, verdict.outcome, reasoning)
    saveBetResult(cid, {
      outcome: verdict.outcome, confidence: verdict.confidence,
      reasoning: verdict.reasoning, txHash: result.txHash, resolvedAt: Date.now(),
    })
    console.log(`[resolve-bet] commitment=${cid} outcome=${verdict.outcome} conf=${verdict.confidence} tx=${result.txHash} — ${verdict.reasoning}`)
    res.json({ outcome: verdict.outcome, confidence: verdict.confidence, reasoning: verdict.reasoning, txHash: result.txHash })
  } catch (e) {
    console.error(`[resolve-bet] failed commitment=${cid}: ${String(e)}`)
    res.status(500).json({ error: String(e) })
  }
})

// GET /bet-result/:id → the Judge's recorded ruling for a resolved DUO bet (reasoning,
// outcome, confidence, tx). 404 if not yet resolved by the Judge.
app.get('/bet-result/:id', (req, res) => {
  const r = getBetResult(req.params.id)
  if (!r) { res.status(404).json({ error: 'not resolved' }); return }
  res.json(r)
})

// ─── Error handler ──────────────────────────────────────────────────────────
// Map multer upload errors (e.g. file too large) to clean JSON instead of HTML 500.
app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof multer.MulterError) {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400
    res.status(status).json({ error: `upload error: ${err.code}` })
    return
  }
  if (err) { res.status(500).json({ error: String(err) }); return }
  next()
})

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Judge service listening on :${PORT}`)
  console.log(`Judge address: ${account.address}`)
  publicClient
    .getBalance({ address: account.address })
    .then(b => console.log(`Judge INJ balance: ${(Number(b) / 1e18).toFixed(4)} INJ`))
    .catch(() => {})
  watchVerdictDisputes((id, dayIndex) => { void handleDispute(id, dayIndex) })
  watchArbitrations((id) => { void handleArbitration(id) })
  console.log('Watching for witness disputes + escrow arbitrations...')
})
