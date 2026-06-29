# NinjaPact · 忍者之约

**The Commitment Layer** — on-chain commitments, AI adjudication, automatic settlement.

**Language:** [English](#english) · [中文](README.zh-CN.md)

---

<a id="english"></a>

## Live demo

**https://www.limlamleen.com** — Injective EVM testnet (chainId `1439`). Email / Google login via Privy; claim test mUSD in-app.

## One line

Turn a promise into an executable on-chain object: stake + natural-language terms + AI Judge + escrow contract. Same engine for self-discipline, small escrow, and (eventually) agent-to-agent verification.

## The problem

**Promises have never had a credible execution layer.**

| | Self-commitments | Commitments to others |
|---|---|---|
| **Pain** | Forfeit proved demand — 686k commitments, $8.7M staked — but platforms profit when users fail → misaligned incentives, easy to cheat; funds sit with the platform → centralized, unauditable | Small delivery deals rely on trust; traditional escrow costs more than a sub-$100 contract |
| **Root cause** | Not willpower — **missing infrastructure** | |

## The solution

Three primitives, one engine:

1. **On-chain escrow** — funds enter the contract; no one can move them arbitrarily  
2. **AI Judge** — multimodal evidence review / delivery arbitration; EIP-712 signed verdicts on-chain and auditable  
3. **Automatic settlement** — success → principal refunded + soulbound badge; failure → locked 6 months then **refunded** (never forfeited); escrow → release on confirmed delivery  

## How it works

```
① Commit          Natural language → AI summary → stake stablecoin → rules written on-chain
② Verify          Daily evidence / deliverable + demo link → Judge reviews → signed verdict
③ Settle          Conditions met → contract executes — no manual approval
```

## Moat: Judge reputation on-chain

```
Habit users (low-friction entry)
  → verdicts accumulate (on-chain + case history)
  → users can rate the Judge via ERC-8004 giveFeedback (RateJudge UI)
  → escrow customers import (higher ticket, trust already built)
  → Judge registered as ERC-8004 agent (#48), identity queryable on-chain
  → (roadmap) open Judge API for third-party / agent callers
```

Competitors can fork the contract. They cannot fork accumulated verdict history and reputation.

**Today:** Agent #48 is registered; users rate the Judge after a commitment concludes. Automated reputation pipelines and a public Judge API are on the roadmap (see below).

## Architecture

```
User (Privy PWA)
    ↓  natural-language commit / upload evidence / submit delivery
Judge service (Node.js · TypeScript · ZhipuAI GLM)
    ├── SOLO: GLM-4V vision (daily evidence) → EIP-712 submitVerdict
    ├── Escrow: GLM text arbitration → EIP-712 arbitrate (pass/fail only)
    ├── Witness re-review (glm-4v-plus) on dispute
    └── ERC-8004 on-chain identity · Agent #48
NinjaPact contract (Injective EVM · chainId 1439)
    ├── SOLO state machine: Active → Success / Fail → Locked → Claimable
    └── Escrow state machine: deliver → review → revision → arbitration → settle
```

**Design principles**

- Chain is the only source of truth — frontend reads chain directly  
- Backend is stateless (Judge, encrypted custody, keeper cron)  
- Judge has zero discretionary fund authority — signs `submitVerdict` (SOLO) or `arbitrate` (escrow pass/fail only); payout recipients are fixed at creation; contract executes settlement  

### Testnet deployment

| Contract | Address |
|---|---|
| NinjaPact | `0x88d50C6e0701AB68AF180a8b98D673EBf80850fE` |
| MockUSD | `0x463607175d238f7ede1ED62157C3a89c99D8b150` |
| Badge | `0x04126c34e7A2Fd77f94e82050B9b08854961Bc90` |
| Judge (ERC-8004) | Agent **#48** — [Blockscout](https://testnet.blockscout.injective.network/token/0x8004A818BFB912233c491871b3d84c89A494BD9e/instance/48) |

## Why Injective

Small-commitment settlement is a natural extension of Injective’s financial DNA — not a generic chain with a contract bolted on.

| | Why it matters |
|---|---|
| **Low per-tx cost** (Injective EVM; order ~$0.00008/tx in pitch materials) | A $20 commitment is economically viable on-chain  |
| **Fast blocks** (~0.64s in pitch materials) | Verdicts confirm quickly — Web2 feel, on-chain finality |
| **Settlement-layer DNA** | Same pattern: condition met → funds move automatically |

Long term: as agents on Injective hire each other, **Judge is the acceptance layer**.

## Market

- **Proven demand:** Forfeit — 686k commitments, $8.7M staked — on a single Web2 platform with misaligned incentives  
- **Our wedge:** same need × **trustless execution** × **fees that work at small ticket sizes**  
- **Upside:** grows with Injective agent economy — every agent-to-agent job needs verification; Judge is already there  

## Status & roadmap

### Shipped (verifiable on testnet)

- [x] NinjaPact deployed on Injective EVM testnet  
- [x] SOLO full loop: commit → check-in → AI verdict → settle  
- [x] Escrow full loop: deliver → arbitrate → release  
- [x] DUO public-event bets (capability slice)  
- [x] Witness dispute + re-review flow  
- [x] AI Judge registered as ERC-8004 agent #48; user `giveFeedback` rating UI  
- [x] Mobile-first PWA live at [www.limlamleen.com](https://www.limlamleen.com)  

### Next

- [ ] Injective mainnet deployment  
- [ ] Automated ERC-8004 reputation writes on every concluded commitment (beyond user-initiated ratings)  
- [ ] Open Judge API — third-party agents call Judge for acceptance  
- [ ] Judge as shared verification infrastructure for the Injective agent ecosystem  

## Repo map

```
contracts/   Solidity + Foundry (NinjaPact, MockUSD, Badge)
frontend/    Vite + React + TypeScript PWA (viem / wagmi / Privy)
judge/       Express + GLM multimodal adjudication + EIP-712 signing
keeper/      Cron: expiry settle, timeout cancel, claim helpers
deploy/      nginx + pm2 production notes
docs/        Checklists, deploy tickets (e.g. 自测checklist.md)
NinjaPact_MVP开发文档.md, HANDOFF.md, CLAUDE.md  — at repo root
```

## Development

**Requirements:** Foundry, Node 18+, pnpm  

```bash
# Contracts
cd contracts && forge test

# Frontend
cd frontend && pnpm install && pnpm dev

# Judge + Keeper (copy .env from examples; never commit secrets)
cd judge && npm install && npm run dev
cd keeper && npm install && npm run dev
```

**Injective EVM testnet**

- Chain ID: `1439`  
- RPC: `https://testnet.sentry.chain.json-rpc.injective.network`  
- Faucet: https://testnet.faucet.injective.network/  

**Docs for contributors**

| File | Purpose |
|---|---|
| `HANDOFF.md` | Current state, deploy, what’s next |
| `CLAUDE.md` | Engineering rules |
| `NinjaPact_MVP开发文档.md` | Product constitution |
| `NinjaPact_one-pager.md` | Extended pitch |

## Disclaimer

Testnet demo only — mock stablecoin (mUSD), not real money. Not financial advice. No production license file in this repo yet.

---

**中文说明 → [README.zh-CN.md](README.zh-CN.md)**
