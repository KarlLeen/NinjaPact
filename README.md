# NinjaPact · 忍者之约

**The Commitment Layer** — on-chain commitments · AI adjudication · automatic settlement · Built on Injective EVM

**Language:** [English](#english) · [中文](README.zh-CN.md)

---

<a id="english"></a>

## website

**https://www.limlamleen.com** — Injective EVM testnet (chainId `1439`). Email / Google login via Privy; claim test mUSD in-app.

## The problem: promises never had a credible execution layer

Society only gives two kinds of promises real teeth:

- **Large contracts** → law (but litigation cost makes sub–$10k disputes uneconomical)
- **In-platform promises** → the platform (once you leave the platform, nothing enforces)

Everything else? A $7 favor for a friend, a weekly post promised to fans, a small delivery deal — **the social cost of breaking your word defaults to zero**.

It’s not that no one wants enforcement. **Enforcement doesn’t pay:** the cost of human arbitration on a dispute often exceeds a $200 stake.

### Incumbents proved demand — but can’t fix the structural flaw

Forfeit · StickK · Beeminder — three Web2 “commitment” products, **18+ years combined**. Same model: you set a goal, stake money, and when you fail, **the platform keeps the stake**.

Beeminder’s FAQ, verbatim: *"Charging penalties is our business model."*

**Referee and house are the same party** — when you fail, they profit. Web2 incumbents cannot fix this without killing their business model.

## Why now

Three lines crossed for the **first time in 2025–26**:

1. **AI adjudication cost → ~zero** — multimodal evidence checks cost pennies; two years ago GPT-4V economics didn’t work  
2. **Execution cost → ~zero** — stablecoins + Injective near-zero gas; escrow and settlement need no institution  
3. **UX is ready** — embedded wallets and account abstraction; normal users can finally use a chain  

This product **couldn’t be built before 2024**. After 2027, the window belongs to whoever already has on-chain reputation.

## The solution

**Turn a promise into an on-chain executable object** — one engine, two commitment types:

1. **On-chain escrow** — funds enter the contract; no one can move them arbitrarily  
2. **AI Judge** — multimodal acceptance / delivery arbitration; EIP-712 signed verdicts, auditable on-chain  
3. **Automatic settlement** — success → principal back + soulbound badge; failure → locked 6 months then **refunded**, never forfeited  

### Two mechanism-design cuts

- **Fake evidence to fool the Judge?** You only “win” early unlock of **your own** stake — time value of a few dollars, below forgery cost. Attack is uneconomic.  
- **AI wrong?** Cost is **liquidity**, not principal — the hardest component is downgraded to non-critical; v1 can ship safely.  

**Judge · escrow · beneficiary — separated powers, verifiable on-chain.**

## Business model

**Profitable from the first order; compounding with volume:**

| Phase | Model |
|---|---|
| **I** | Fixed service fee — cost + margin on AI tokens; positive cash flow from order one |
| **II** | Float yield — on-chain yield on locked escrow, transparent |
| **III** | GMV take rate (core business) — every transaction through the engine pays a fee; **not tied to user failure** |
| **Long term** | Performance credit bureau — case law + fulfillment graph for deals too small for courts |

**Moat assets:** case library (grows more consistent with volume) · fulfillment credit graph (seller reputation in transaction contexts) · evidence integrations (health apps / GitHub / logistics APIs — wider over time)

## Moat: Judge reputation on-chain

```
Habit users (low-friction entry, zero cold start)
  → every verdict adds to Judge on-chain reputation
  → case library grows → better adjudication consistency
  → escrow customers import naturally (trust built, higher ticket)
  → Judge registered as ERC-8004 Agent, reputation queryable on-chain
  → third-party agents call Judge for acceptance
  → public verification layer for agent-to-agent commerce
```

Competitors can fork the contract. **They cannot fork on-chain reputation.**

Alipay grew from Taobao’s escrow into a payments empire — **escrow is the wedge; settlement is the business.**

**Today:** Judge is ERC-8004 [Agent #48](https://testnet.blockscout.injective.network/token/0x8004A818BFB912233c491871b3d84c89A494BD9e/instance/48); users rate via `giveFeedback` after a commitment ends. Automated reputation writes and a public Judge API remain on the roadmap.

## How it works (three steps)

```
① Commit     Natural language goal → AI summary → stake stablecoin → rules fixed on-chain
② Verify     Daily evidence / deliverable + demo → Judge multimodal review → EIP-712 verdict on-chain
③ Settle     Conditions met → contract executes — no manual approval
```

## Architecture

Two product surfaces, **one Judge engine**; every verdict compounds the same Agent’s on-chain reputation.

```
User (Privy embedded wallet)
    ↓  natural-language commit / upload evidence / submit delivery
Judge service (Node.js · TypeScript)
    ├── SOLO: GLM-4V vision model (daily evidence)
    ├── Escrow routine: GLM text (vs acceptance criteria)
    ├── Escrow dispute: Azure OpenAI GPT-5.4 terminal arbitration
    ├── EIP-712 signed verdicts
    └── ERC-8004 on-chain identity · Agent #48
        https://testnet.blockscout.injective.network/token/0x8004A818BFB912233c491871b3d84c89A494BD9e/instance/48

NinjaPact contract (Injective EVM · chainId 1439)
    ├── SOLO: Active → Success / Fail → Locked → Claimable
    └── Escrow: deliver → review → revision → arbitration → settle
```

**Design principles**

- Chain is the only source of truth — frontend reads chain directly  
- Backend is stateless (Judge, encrypted custody, keeper cron)  
- Judge has zero discretionary fund authority — signs `submitVerdict` / `arbitrate` only; payout paths fixed at creation  

### Testnet deployment

| Contract | Address |
|---|---|
| NinjaPact | `0x88d50C6e0701AB68AF180a8b98D673EBf80850fE` |
| MockUSD | `0x463607175d238f7ede1ED62157C3a89c99D8b150` |
| Badge | `0x04126c34e7A2Fd77f94e82050B9b08854961Bc90` |
| Judge (ERC-8004) | Agent **#48** — [Blockscout](https://testnet.blockscout.injective.network/token/0x8004A818BFB912233c491871b3d84c89A494BD9e/instance/48) |

## Why Injective

Small-commitment settlement is the natural extension of Injective’s financial DNA — not a generic chain with a contract bolted on.

| | Why it matters |
|---|---|
| **~$0.00008/tx** (pitch materials) | A $20 commitment is economically viable on-chain |
| **~0.64s blocks** (pitch materials) | Verdicts confirm fast — Web2 feel, on-chain finality |
| **Settlement-layer DNA** | Condition met → funds move automatically |

**Two-way funnel for Injective:** the habit wedge brings outsiders onto Injective silently (embedded wallet, login = account); the escrow layer keeps real settlement volume and stablecoin float on-chain — **users in, money in**.

Long term: as agents on Injective hire each other, **Judge is the acceptance layer**.

## Market

**Proven demand:** Forfeit — 686,000 commitments · $8.7M staked · one platform, misaligned model, still at scale.

**Our market** = same need × **trustless execution** × **fees that work at small ticket sizes**.

Every WeChat / Telegram group has someone taking 1–5% as a human middleman — errands, commissions, gigs, OTC — all on reputation alone. With AI cutting per-case cost to pennies, **a $50 deal can finally afford escrow**.

**Upside:** no fixed TAM forecast — as the Injective agent economy grows, every agent-to-agent job needs verification; Judge is already there.

## Status & roadmap

### Shipped (verifiable on testnet)

- [x] NinjaPact deployed on Injective EVM testnet  
- [x] SOLO full loop: commit → check-in → AI verdict → settle  
- [x] Escrow full loop: deliver → arbitrate → release  
- [x] AI Judge registered as ERC-8004 [Agent #48](https://testnet.blockscout.injective.network/token/0x8004A818BFB912233c491871b3d84c89A494BD9e/instance/48) ([Blockscout](https://testnet.blockscout.injective.network/token/0x8004A818BFB912233c491871b3d84c89A494BD9e/instance/48))  
- [x] Live at [limlamleen.com](https://www.limlamleen.com)  
- [x] Solo builder + AI toolchain — zero to full-stack closed loop  

### Next

- [ ] Injective mainnet deployment  
- [ ] Open Judge API — any third-party agent can call Judge for acceptance  
- [ ] Judge as shared verification infrastructure for the Injective agent ecosystem  

## Try it

| | |
|---|---|
| **Product** | [limlamleen.com](https://www.limlamleen.com) |
| **Judge API / contact** | limlamleen@gmail.com |
| **Code** | [github.com/KarlLeen/NinjaPact](https://github.com/KarlLeen/NinjaPact) |

## Repo map

```
contracts/   Solidity + Foundry (NinjaPact, MockUSD, Badge)
frontend/    Vite + React + TypeScript PWA (viem / wagmi / Privy)
judge/       Express + GLM / Azure OpenAI adjudication + EIP-712 signing
keeper/      Cron: expiry settle, timeout cancel, claim helpers
deploy/      nginx + pm2 production notes
docs/        Checklists, deploy tickets
```

## Development

**Requirements:** Foundry, Node 18+, pnpm  

```bash
cd contracts && forge test
cd frontend && pnpm install && pnpm dev
cd judge && npm install && npm run dev   # copy .env; never commit secrets
cd keeper && npm install && npm run dev
```

**Injective EVM testnet:** chainId `1439` · RPC `https://testnet.sentry.chain.json-rpc.injective.network` · [Faucet](https://testnet.faucet.injective.network/)

## Disclaimer

Testnet demo only — mock stablecoin (mUSD), not real money. Not financial advice.

---

**The Commitment Layer · Built on Injective** · [中文 → README.zh-CN.md](README.zh-CN.md)
