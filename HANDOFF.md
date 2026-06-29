# NinjaPact — Handoff for Cursor (read this first)

> You (the AI in Cursor) are taking over a project mid-flight. This file is the single
> source of truth for **current state + what's next + how to work here**. Read it fully
> before doing anything. The **product constitution** is `CLAUDE.md` (rules) +
> `NinjaPact_MVP开发文档.md` (product spec) — when they conflict, the MVP 文档 wins.

---

## 0) How to use this in Cursor

- Treat `CLAUDE.md` as binding rules and this `HANDOFF.md` as current state.
- A `.cursorrules` at repo root points to both — Cursor loads it automatically.
- UI text + product copy is **Chinese**, ninja theme. Tiers use generic belt colors
  (白/黄/绿/蓝/棕/黑) — **never** Naruto-specific names.
- **Discipline (critical):** generic EVM/Solidity knowledge is fine, but for anything
  **Injective-specific** (chainId, RPC, precompiles, gas, contract addresses,
  `@injective/agent-sdk`, ERC-8004) you MUST verify against the official docs/source
  (see §8). Do **not** invent Injective APIs. If you can't verify, stop and ask.
- **Test-first for contracts.** Every state transition / permission / boundary needs a
  Foundry test. Local `forge test` green before touching testnet.

---

## 1) What the product is (the goal)

On-chain commitment escrow + an AI Judge. Users make a promise in natural language and
stake a stablecoin; the Judge verifies evidence and signs verdicts on-chain; the contract
settles by pre-written rules. **Three-act narrative, one engine:**

1. **入口 — 自律质押 (SOLO):** stake money on a personal goal; AI Judge verifies daily
   photo evidence; success → full refund + soulbound badge; fail → locked 6 months then
   **refunded** (never forfeited). Zero cold-start, cheating only hurts yourself.
2. **生意 — 小额担保 / escrow (DEPOSIT):** the current focus. Payer escrows funds, a
   deliverer delivers, AI + payer verify, funds release. **Same engine, paying customer.**
3. **终局 — agent 经济的验收层:** when agents transact, who verifies delivery? The Judge.
   Registered as an **ERC-8004** agent (done — see §4). Same mechanism, different customer.

Architecture invariant: **the chain is the only source of truth.** Frontend reads chain
directly; backend is stateless (Judge verdicts, evidence/custody storage, keeper cron).

---

## 2) Tech stack (LOCKED — do not swap or "upgrade")

- **Contracts:** Solidity + Foundry → Injective EVM testnet (chainId **1439**, RPC
  `https://testnet.sentry.chain.json-rpc.injective.network`, faucet
  https://testnet.faucet.injective.network/).
  - **foundry.toml MUST keep `optimizer=true, optimizer_runs=1, via_ir=true`** — without
    it NinjaPact is 28.8KB > the 24576 EIP-170 limit and deploy fails. With it: ~13.9KB.
- **Frontend:** Vite + React + TS, mobile-first PWA; chain via **viem + wagmi**; wallet =
  **Privy** embedded (App ID `cmqespu1j02hd0ckyj6a8ykmk`), MetaMask/Keplr-EVM as fallback.
- **Judge service:** Node 18+ ESM + TS + Express + tsx. AI = **ZhipuAI GLM** (NOT DeepSeek):
  base `https://open.bigmodel.cn/api/paas/v4`. Models: `glm-4v-flash` (evidence vision),
  `glm-4-flash` (chat/立约 + escrow in-spec/arbiter text), `glm-4v-plus` (witness re-review).
  **glm-4.7 is TEXT-ONLY** (images → error 1210). GLM-4V wants **raw base64** (strip the
  `data:image/...;base64,` prefix).
- **Judge on-chain identity:** ERC-8004 via `@injective/agent-sdk` (see §8 for the gotcha).
- **Stablecoin:** self-deployed mock ERC-20 (`MockUSD`).
- **Storage:** evidence/custody on server disk (source is AES-256-GCM encrypted); chain
  stores only sha256/keccak hashes. Private keys only in `.env` (gitignored).

---

## 3) Repo map

```
contracts/   Foundry: src/NinjaPact.sol, MockUSD.sol, Badge.sol; test/NinjaPact.t.sol (70 tests); script/Deploy.s.sol
judge/        Express service: src/index.ts (routes), chain.ts (viem reads/writes + watchers),
              ai.ts (GLM calls + prompts), chat.ts (立约 LLM), custody.ts (encrypted source + dispute),
              storage.ts (evidence), terms.ts, auth.ts (SIWE→JWT). .env has all keys.
keeper/       node-cron: scans commitments, simulate-then-send settle/cancelUnfunded/claim.
frontend/     Vite+React. src/pages/{Landing,Dashboard,CreatePact,PactDetail,EscrowDetail,
              DeliverPage,WitnessPage,ProfilePage}.tsx; src/lib/{contracts,terms,witness,deliver,
              escrow,judgeAuth,toast}.ts; src/components/Camera.tsx. .env.local (dev) / .env.production.
deploy/       DEPLOY.md, nginx-ninjapact.conf, ecosystem.config.cjs (pm2).
CLAUDE.md, NinjaPact_MVP开发文档.md (product constitution), NinjaPact_全部工单_W1-W6.md (tickets),
NinjaPact_one-pager.md (pitch), docs/自测checklist.md, HANDOFF.md (this file).
```

---

## 4) Current deployed state (Injective EVM testnet, chainId 1439)

| Thing | Value |
|---|---|
| **NinjaPact** | `0x88d50C6e0701AB68AF180a8b98D673EBf80850fE` |
| **MockUSD** | `0x463607175d238f7ede1ED62157C3a89c99D8b150` |
| **Badge** | `0x04126c34e7A2Fd77f94e82050B9b08854961Bc90` |
| Deployer (MetaMask) | `0xeBf4d7801fA125a2f75AD388E955dd29F3ED555F` (~20 INJ) |
| **Judge wallet** | `0xfBA77D61eAadBB715aF90E29B39C90A440C92A18` (~1 INJ; key in judge/.env) |
| **Judge ERC-8004 agentId** | **48** — [Blockscout NFT #48](https://testnet.blockscout.injective.network/token/0x8004A818BFB912233c491871b3d84c89A494BD9e/instance/48) (8004scan 尚未索引 chain 1439) |
| Keeper wallet | `0x3801E71711c74C12b77ab632320AE7a7444572c4` (~1 INJ; key in keeper/.env) |
| Privy embedded test wallet | `0x5589e07407b98D7b3d77aE62E00f8005f5F9Bd2c` (has 10000 mUSD + INJ) |

- **Live site:** https://www.limlamleen.com (Tencent Cloud Ubuntu 22.04, IP 43.156.131.187,
  4GB/2-core; nginx serves `frontend/dist` + proxies `/api/` → localhost:3001; pm2 runs
  `np-judge` + `np-keeper`).
- Env files already point to the addresses above:
  `frontend/.env.local`, `frontend/.env.production`, `judge/.env`, `keeper/.env`
  (`VITE_JUDGE_AGENT_ID=48`, `JUDGE_AGENT_ID=48`, `CUSTODY_KEY=…` already set).
- **Each contract redeploy orphans all prior commitments (ids reset) and mints fresh
  MockUSD/Badge** — then re-mint mUSD to the embedded wallet + update the 4 env files.
- **2026-06-28 redeploy** (addresses above) shipped: **joiner indexing** (`getUserCommitments`
  now enumerates joiners) + **DUO 公共事件对赌** (`createBet`/`resolveBet`/`getCreatorBetsYes`/
  `BetResolved`). Re-minted 10 000 mUSD to deployer + the Privy embedded wallet. Live bundle +
  judge `/resolve-bet`,`/bet-result` routes verified from outside. Live nginx
  `client_max_body_size` synced to 12m (§6.2 leftover now done).

---

## 5) What's BUILT (and working)

- **W1/W2a/W2b:** contract state machine (SOLO + multi-party `Party[]`/`OpenSlot[]` from
  day one), EIP-712 signed verdicts (`submitVerdict(id,dayIndex,pass,useRestCard,reasonHash,
  sig)`, judge recovered from signature not msg.sender, dayIndex replay guard),免卡券
  (restCards), 救赎 (`redeemLock`), Judge service (GLM vision → sign → on-chain), Keeper,
  Privy frontend with camera + liveness challenge. 假照片攻击 verified.
- **W3 Witness:** `acceptWitness` + `witnessDispute(id,dayIndex)` (one per commitment) →
  `VerdictUnderReview` event → Judge re-judges with flagship `glm-4v-plus` → overwrites.
  Witness sees the evidence photo before disputing.
- **第二拍 — code-delivery escrow (DEPOSIT), LIVE:** the big recent build.
  - **Contract state machine** (in NinjaPact.sol): `EscrowPhase {None,InProgress,UnderReview,
    RevisionRequested,Arbitration}`. Functions: `submitDelivery(id,deliveryHash)` (deliverer)
    → UnderReview; `confirmDelivery(id)` (payer) → pay deliverer; `requestRevision(id,
    msgHash)` (payer, burns 1 revision) → RevisionRequested; `requestArbitration(id)` (payer,
    when revisions exhausted) → Arbitration; `arbitrate(id,pass,reasonHash,sig)` (Judge,
    EIP-712, reuses Verdict typed-data with dayIndex=0) → pay/refund; `settle(id)` (keeper,
    time-based: review-timeout→pay, fix-timeout→refund, never-delivered→refund). Revision
    budget rides in on `evidencePolicy.restCards` → stored in `escrow.revisionsAllowed`.
    `escrowDelivered[id]` (public mapping) gates source release. Windows: review 2 days,
    fix 3 days (constants). joinDeadline for DEPOSIT = schedule.endTime. 70 Foundry tests.
  - **铁律#3 boundary (accepted):** escrow CAN pay a third party (the deliverer) but ONLY the
    one fixed at creation via the invite slot; the Judge only picks pass/fail at arbitration,
    never the recipient.
  - **Judge (B2/B3):** `custody.ts` encrypts source (AES-256-GCM, key=CUSTODY_KEY), stores
    demo link + dispute history (multi-round). Routes: `POST /deliver` (deliverer uploads
    source+demoLink, returns sourceHash to anchor via submitDelivery), `GET /deliver/:id/meta`
    (demo link), `GET /deliver/:id/source` (gated: payer + escrowDelivered), `POST /dispute`
    (hash-gated complaint store + AI in-spec advisory), `GET /dispute/:id`. AI: `assessInSpec`
    (advisory per dispute) + `arbitrateDelivery` (terminal vs original spec) → `arbitrate()`
    on-chain via `watchArbitrations` watcher on `ArbitrationRequested`.
  - **Frontend (B4):** CreatePact has mode toggle 自律打卡/交付托管; escrow create is
    **chat-driven** (`POST /api/chat {mode:'escrow'}` → AI returns a tickable 可测验收清单 +
    suggested stake/revisions/days, fills the form). DeliverPage `/d/:id#secret`: accept →
    upload source + demo link → submitDelivery → see payer's revision messages → resubmit.
    EscrowDetail (payer, rendered by PactDetail when mode===DEPOSIT): test demo link → confirm
    / request revision (textarea) / arbitrate; download source after release.
- **W4 — Judge ERC-8004 identity + 履约档案页, LIVE:** Judge registered as agentId **48**.
  Frontend `/profile` (Dashboard 🏅档案 button): 段位 belt by badge count + 履约率 + 立约
  statistics + 履约记录 + a card linking to the Judge's 8004scan identity.

---

## 6) RIGHT NOW — in-flight + immediate next (priority order)

1. **[IN-FLIGHT] Deliver-jobs Dashboard fix** — bug: after a deliverer accepts a task it
   didn't appear in their Dashboard (contract only indexes commitments under their *creator*).
   Fix (done in code, **pending deploy**): `frontend/src/lib/deliver.ts` `storeDeliverJob/
   getDeliverJobs` (localStorage by deliverer address), DeliverPage stores on accept,
   Dashboard shows a "🤝 我接的交付" section linking to `/d/:id`. **Deploy it** (see §7).
   Note: only future accepts show (localStorage on accept); already-accepted tasks still
   reachable via their `/d/:id` link.
2. **[NEEDED] 413 upload limit** — escrow source upload fails with 413 on real files. Raise
   `express.json({ limit })` in `judge/src/index.ts` from `10mb`→`50mb` AND nginx
   `client_max_body_size 12m`→`50m` (find it: `grep -rl client_max_body_size /etc/nginx/`).
   Deploy: rebuild not needed for nginx (just reload); judge needs `pm2 restart np-judge`.
   **[DONE]** Source upload switched from base64-in-JSON to **multipart/form-data** (multer
   2.x, memoryStorage; `requireAuth` runs before multer so unauth'd requests aren't buffered).
   `judge/src/index.ts` `/deliver` + `frontend/src/lib/escrow.ts uploadDelivery` (FormData) +
   DeliverPage pass the `File` directly. `fileToBase64` removed. **MVP cap = 10 MB**: multer
  `fileSize` 10 MB + `express.json` back to 10mb (source no longer in JSON) + nginx
  `client_max_body_size` 12m (repo `deploy/nginx-ninjapact.conf` **and live box** — synced
  to 12m in the 2026-06-28 deploy).
3. **[W4 follow-on] On-chain reputation writes** — make `getReputation(48)` grow a real
   track record: when a commitment concludes, write a feedback/attestation to the ERC-8004
   **ReputationRegistry** (testnet `0x8004B663056A597Dffe9eCcC1965A193B7388713`).
   **Verify the WRITE API first** — the SDK README only documents reads (`getReputation`,
   `getFeedbackEntries`); find the feedback-submit method + ABI in `packages/sdk/src` of the
   agent-sdk repo, and decide the attester model (payer rates the verdict? Judge records
   each success/fail data point?). This is its own ticket; don't fake the ABI.

---

## 7) How to deploy (SSH is currently blocked — use the workaround)

**Local builds/tests always work.** Deployment to the live box is the issue: the box
blocks the dev machine's egress IP after connection bursts (manifests as
`kex_exchange_identification: Connection closed`; it's an upstream/Tencent-side block, not
fixable from the box's iptables). **Do NOT fire rapid SSH/rsync bursts** (that caused it).

**Two deploy paths:**

- **A) If SSH works** (single connection, no bursts):
  ```bash
  rsync -az --exclude node_modules --exclude 'frontend/dist' --exclude 'frontend/.env.local' \
    --exclude contracts --exclude '.git' --exclude out \
    -e "ssh -i ~/Downloads/NP.pem -o StrictHostKeyChecking=no" \
    /Users/karl4chill/dev/NP/ ubuntu@43.156.131.187:/var/www/ninjapact/
  ssh -i ~/Downloads/NP.pem ubuntu@43.156.131.187 \
    'cd /var/www/ninjapact/frontend && pnpm build && sudo systemctl reload nginx && pm2 restart np-judge'
  ```
- **B) SSH-free (the trick that's been working):** push changed files to a GitHub gist
  (`gh gist create file1 file2 …`), then the user pastes ONE command into the **Tencent VNC
  console** that `curl -fsSL <gist raw url> -o <path>` each file, then `pnpm build &&
  sudo systemctl reload nginx` (+ `pm2 restart np-judge` if judge changed). The box has
  internet + builds in ~5s. **Always verify from outside** with `curl` of the live JS bundle
  (grep for expected strings) — don't assume a step ran.

**The real fix:** in the Tencent 控制台, clear the blocked IP (主机安全/云镜) or restrict
port 22 inbound to known IPs (安全组), to stop the bot flood + unblock direct SSH.

**Contract redeploy** (when contract changes): `forge script` fork-init times out on the
flaky sentry RPC. Workaround that works — deploy each contract with `cast send --create
"$(forge inspect <C> bytecode)<abi-encoded-ctor-args>"` in a small retry loop, then
`cast send <badge> "initialize(address)" <ninjapact>` + `cast send <musd> "mint(...)"`.
Always run `forge test` green first; keep the foundry optimizer settings (§2).

---

## 8) Injective agent tools + reference docs — HOW TO ACCESS (read this carefully)

**Authoritative sources (always verify Injective-specific things here):**
- **Doc index (start here):** https://docs.injective.network/llms.txt
- Official docs: https://docs.injective.network
- **AI developer docs:** https://docs.injective.network/developers-ai/index
- Agent SDK repo: https://github.com/InjectiveLabs/injective-agent-sdk
- Unified MCP server: https://github.com/InjectiveLabs/mcp-server
- ERC-8004 spec: https://eips.ethereum.org/EIPS/eip-8004
- Live agent registry / scan: https://agents.injective.com , https://8004scan.io

**A) Reading the docs in Cursor (no MCP needed):**
- Cursor's agent can fetch URLs with `@Web` / by pasting a URL into chat. Start from
  `llms.txt` (it indexes the whole doc site for LLMs), then drill into the AI dev page.
- For the agent-sdk, the **README in the repo IS the API reference** — but it's a **pnpm
  monorepo** and `@injective/agent-sdk` is **NOT published to npm** (verified). To use it:
  ```bash
  git clone https://github.com/InjectiveLabs/injective-agent-sdk
  cd injective-agent-sdk && pnpm install && pnpm -r build
  # CLI:   node bin/inj-agent <command>     (packages/cli)
  # SDK:   import from packages/sdk/dist     (@injective/agent-sdk)
  ```
  Network config is in `packages/sdk/src/config.ts` — for `INJ_NETWORK=testnet` the
  **canonical** registries on chain 1439 are: IdentityRegistry
  `0x8004A818BFB912233c491871b3d84c89A494BD9e`, ReputationRegistry
  `0x8004B663056A597Dffe9eCcC1965A193B7388713` (the `staging` network uses different
  `0x19d1…` addresses — don't confuse them; the .env.example comment is mislabeled).

**B) Injective MCP server in Cursor (gives the agent live Injective tools):**
- Cursor supports MCP. Clone + build `InjectiveLabs/mcp-server`, then add to
  `~/.cursor/mcp.json` (global) or `<repo>/.cursor/mcp.json` (project):
  ```json
  {
    "mcpServers": {
      "injective": { "command": "node", "args": ["/ABSOLUTE/PATH/mcp-server/dist/mcp/server.js"] }
    }
  }
  ```
  Restart Cursor; the Injective tools (trading + identity/ERC-8004) appear to the agent.
  Follow the mcp-server README for any required env (private key, network).
- The Injective **documentation MCP** (per CLAUDE.md / the AI dev docs) can be added the
  same way if you want doc-search as a tool — see the AI dev docs page for its exact entry.

**C) Registering / updating the Judge agent (already done as #48):**
- It was done locally with the CLI (no server needed — it's just an on-chain tx via the
  Judge key + a Pinata JWT for the IPFS agent card). To **update** it:
  `node bin/inj-agent update 48 --service '{"type":"a2a","url":"…"}'` etc. Env:
  `INJ_PRIVATE_KEY`=Judge key, `INJ_NETWORK=testnet`, `PINATA_JWT`=<a Pinata JWT>.
  Pass `--uri <ipfs/https uri>` to skip the Pinata upload.

---

## 9) Run locally

```bash
# contracts
cd contracts && forge build && forge test          # 70 tests, keep green
# judge  (needs judge/.env: JUDGE_PRIVATE_KEY, AI_API_KEY, NINJAPACT_ADDRESS, JWT_SECRET, CUSTODY_KEY…)
cd judge && npm install && npm run dev               # :3001
# keeper
cd keeper && npm install && npm run dev
# frontend (uses .env.local → localhost judge)
cd frontend && pnpm install && pnpm dev              # :5173
```
Mobile testing must use the live HTTPS site (camera/getUserMedia needs HTTPS). Same Privy
email = same embedded wallet across devices. See `docs/自测checklist.md` for test flows.

---

## 10) Gotchas (hard-won this session — don't relearn them)

- **Contract size:** keep `optimizer=true, optimizer_runs=1, via_ir=true` in foundry.toml.
- **forge script deploy times out** on the flaky sentry RPC → use `cast send --create` loop.
- **GLM:** glm-4.7 is text-only (vision → error 1210); GLM-4V needs raw base64; chat must be
  a `*-flash` model (glm-4.7's slow reasoning_content → iOS "Load failed").
- **Injective RPC drops eth filters** → the Judge polls `eth_getLogs` over block ranges
  (`watchVerdictDisputes`, `watchArbitrations`), never `watchContractEvent`.
- **Privy/Injective:** sequential approve→create→fund sometimes stalls client-side
  ("上链中") or "gas limit must not be zero" on would-revert txs → refresh + retry.
- **SSH:** never burst connections to the box (triggers the IP block). One connection at a
  time, or use the gist+console deploy.
- **getUserCommitments only indexes the creator** — joiners (escrow deliverers) aren't in it;
  hence the localStorage deliver-jobs workaround (§6.1). A proper fix needs a contract change
  (push joiner in `joinCommitment`) → next redeploy. (Backlog.)
- **Secrets** live only in `*.env` (gitignored): judge/.env (JUDGE_PRIVATE_KEY, AI_API_KEY=GLM,
  JWT_SECRET, CUSTODY_KEY), keeper/.env, contracts/.env (deployer PRIVATE_KEY). Never commit.

---

## 11) Backlog (not blocking the demo)

- ✅ **DUO 公共事件对赌 (能力展示切片) — LIVE (deployed 2026-06-28, addresses in §4).** Two parties
  bet equal stakes on a public YES/NO event (e.g. "Drake 在 X 前发新专辑吗"); the Judge agent acts as
  the event oracle (`POST /resolve-bet/:id` → `ai.resolveEvent` → EIP-712 sign → `resolveBet` on-chain),
  **winner takes the pot**. **This is an intentional OWNER OVERRIDE of the product constitution**: it
  breaks 决策#1「失败不罚没 → 脱离赌博定义」(对赌会罚没输家) and uses AI as an external-event oracle
  (产品宪法本来不依赖外部预言机). Kept compliant with 铁律#3: winner is always one of the two
  pre-fixed parties (party[0]/party[1]); the Judge only signs the outcome bool, never picks a recipient.
  Safety net: if the Judge never resolves, `settle()` past `endTime + BET_RESOLVE_GRACE (3d)` refunds both
  (失败不罚没 — funds never stuck). Surfaces: contract `createBet`/`resolveBet`/`getCreatorBetsYes`/
  `BetResolved`; judge `resolveEvent`+`/resolve-bet/:id`+`/bet-result/:id`; keeper DUO branch; frontend
  「🎲 对赌」tab + `/b/:id` (`BetPage`). `forge test` green (80). **Remaining: owner real-machine E2E**
  (create a bet → opponent joins → at deadline keeper pings `/resolve-bet/:id` or curl it manually →
  winner paid; plus the timeout-refund-both safety-net path).
- ✅ Contract: index joiners in `joinCommitment` (kills the localStorage deliver-jobs workaround) —
  **LIVE (2026-06-28)**. Dashboard can now drop the localStorage fallback for newly-accepted jobs.
- ~~Source upload via multipart instead of base64-in-JSON~~ ✅ done (§6.2); custody → R2 for durability (still TODO).
- Reputation writes (§6.3) → 履约信用图谱 on-chain.
- Path B escrow (Judge builds demo from escrowed source in a sandbox → demo == source) —
  deferred until funded; current Path A relies on trust + the hash + dispute window.
- ~~Encryption-at-rest for evidence photos~~ ✅ done (AES-256-GCM via `judge/src/cryptobox.ts`,
  shared with source custody; old plaintext photos read via `decryptBlobOrRaw` fallback). 铁律 #10 met.
- custody/evidence → R2 for durability (still TODO; today both live only on the box's local disk —
  box rebuild loses raw photos/source, only the on-chain hash survives).
- Witness Web Push / 拍一拍; UI polish (deliberately deferred until features lock).
