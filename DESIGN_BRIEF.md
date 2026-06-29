# NinjaPact — Design Brief (hand this to Claude for the UI redesign)

> Paste this whole file into claude.ai (with Artifacts on), or attach it. Then attach
> **screenshots of every current screen** and `frontend/src/index.css`. Ask for a design
> system first, then screen-by-screen mockups. All UI copy is **Chinese**, ninja-themed.

---

## What you're designing

Two deliverables:
- **A) A marketing landing page** (deployed separately to Vercel) — hero + the story + a
  single clear CTA "进入 Ninja Pact" linking to the app at **https://www.limlamleen.com**.
- **B) A redesign of the in-app screens** (the existing React PWA). The current UI works but
  looks ugly/unrefined — keep all behavior, replace the look.

## What the product is (so visuals carry meaning)

NinjaPact turns a promise into an executable on-chain object: **money + a natural-language
condition + an AI Judge + on-chain escrow.** Three uses, one engine ("三拍叙事"):

1. **自律质押 (SOLO):** stake money on a personal goal; an AI Judge verifies daily photo
   evidence; succeed → full refund + a **soulbound 守诺勋章**; fail → funds locked 6 months
   then **refunded** (never forfeited — this is not gambling).
2. **交付托管 (escrow):** a payer escrows funds; a deliverer delivers work + a testable demo;
   AI + the payer verify; funds release. Bounded **revision loop**; the AI **arbitrates**
   disputes against the agreed acceptance checklist.
3. **AI Judge as on-chain agent:** the Judge is a registered ERC-8004 agent; every verdict is
   signed and **auditable on-chain**. Judge / escrow / beneficiary are separated (三权分立).

**The feeling to convey:** disciplined, trustworthy, a little mysterious. Real money + on-chain
→ it must feel **serious and credible, NOT neon memecoin**. But it has a playful ninja soul.
Think: a quiet, premium dojo ledger.

## Brand direction (a starting POV — refine, don't obey)

- **Palette:** dark "ink/steel" base (deep slate / near-black), one confident accent for
  value/stake (jade-green or amber-gold — pick one and commit). Semantic: green = success,
  amber = locked, red = fail. High contrast, lots of breathing room.
- **Motifs to mine:** 🥷 ninja · 卷轴 (scroll = a pact) · 印章/盖章 (a seal/stamp = a verdict
  landing) · 段位带色 (belt colors 白→黄→绿→蓝→棕→黑 = rank) · 守诺勋章 (soulbound medal).
  A satisfying "seal stamps down" moment when a verdict lands; a pact shown as a scroll.
- **Mobile-first:** thumb-reachable, big tap targets, the primary action **bottom-anchored**,
  one focus per screen. It's a PWA used on phones.
- **Restraint > decoration.** Strong type hierarchy, generous spacing, few colors. No gradients
  soup, no glow. Trust is the job.
- Typography: a clean sans with good Chinese rendering; optionally one distinctive display face
  for headers/numbers (stakes, countdowns).

## Tech constraints (so the output is usable, not a throwaway)

- App is **React + Vite + TypeScript**. Styling is plain CSS + **CSS variables** in
  `frontend/src/index.css` (attached). 
- **Deliver a design system FIRST**: CSS variables (colors, type scale, spacing, radius,
  shadows) + primitive classes/components — **card, button (primary/ghost/success), input,
  textarea, slider, state-badge, bottom action bar, toast, spinner, empty-state**. Then redo
  screens using those primitives.
- **Drop-in, behavior-preserving:** the redesigned screens must map onto the existing pages
  (structure below). Change markup/CSS only — do **not** touch data, props, wagmi/Privy calls,
  or routing. Each existing page already has its data wired; you're reskinning it.
- **Output:** interactive HTML/React mockups (Artifacts) so they can be reviewed + iterated.
  Keep class names / a token list that can be lifted into `index.css` + the components.

## In-app screens to redesign (each is one React page)

| Screen (route) | What it does — the key elements to design |
|---|---|
| **Landing / login** (`/`) | Enter the app; Privy email/wallet login. First impression. |
| **Dashboard 我的承诺** (`/dashboard`) | Wallet bar; list of "我发起的承诺" cards (goal, stake, state badge, progress); a "🤝 我接的交付" section; FAB "立约 ＋"; entry to 档案. |
| **CreatePact 立约** (`/create`) | Mode toggle 自律打卡 / 交付托管; a **chat** with the AI (bubbles + input) that drafts a proposal; a confirmation card with **sliders** (周期/次数/质押/免卡券 or 金额/修改次数/天数); "确认立约". |
| **PactDetail (habit)** (`/pact/:id`) | Goal header; progress bar + stats (通过/失败/免卡券/判负阈值/结束时间/裁判/见证人); big "今日打卡 📸" → camera with a liveness challenge + AI verdict banner; plus Success / Locked(救赎) / Claimable panels. |
| **EscrowDetail (payer)** (`/pact/:id` when escrow) | Commission summary + 验收标准; "打开 demo 实测"; 确认放款 / 提修改(textarea) / 申请裁决; phase states (等待交付/验收中/修改中/终局裁决中); download source after release. |
| **DeliverPage (deliverer)** (`/d/:id#secret`) | Accept the commission; upload source (.zip) + demo link; "提交交付"; see the payer's revision message; resubmit; settled state. |
| **WitnessPage** (`/w/:id#secret`) | Read-only progress; the latest **evidence photo** + AI reasoning; a "⚖️ 质疑" button (triggers flagship re-review). |
| **ProfilePage 履约档案** (`/profile`) | **段位** belt (color by 守诺勋章 count); 守诺勋章数; **履约率**; 立约统计; 履约记录 list; a "⚖️ 验收方 → ERC-8004 Judge" identity card. |

Reusable pieces across screens: **state badges** (待资金/等待入伙/进行中/已成功/失败/锁定中/可领取/
已结算/已取消, plus escrow phases), **commitment card**, **slider**, **camera capture view**,
**AI verdict banner**, **toast**.

## Deliverable A — the Vercel landing page

A focused marketing single-page (separate repo/deploy, links to the app):
- **Hero:** product name 忍者之约 / NinjaPact + the line *"给一切小额承诺提供执行层 — The
  Execution Layer for Small Promises"* + primary CTA **"进入 Ninja Pact →"** → https://www.limlamleen.com .
- **The problem** (人类 99% 的承诺没有执行层) + **why now** (AI 裁决成本归零 + 链上结算).
- **三拍叙事** as three clean sections (自律 → 担保 → agent 验收层), each with one visual.
- **How it works** (立约 → AI 验收 → 链上结算) in 3 steps.
- **Trust** (裁判/托管/受益人三权分立; 裁决上链可审计; 失败不罚没).
- Footer CTA again. Dark, premium, matches the in-app brand system. Mobile-first.

## How to work with us
1. Start by proposing the **design system** (tokens + primitives) as one Artifact we can react to.
2. Then redo 2–3 hero screens (Dashboard, CreatePact, ProfilePage) to lock the language.
3. Then the rest + the landing page.
4. Give us the token list + class names so we can port it into `frontend/src/index.css` and the
   page components without changing logic.
