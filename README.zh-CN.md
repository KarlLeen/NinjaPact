# NinjaPact · 忍者之约

**The Commitment Layer** — 链上承诺 · AI 裁决 · 自动结算

**语言：** [中文](#中文) · [English](README.md)

---

<a id="中文"></a>

## 在线体验

**https://www.limlamleen.com** — Injective EVM 测试网（chainId `1439`）。Privy 邮箱 / Google 登录；应用内可领取测试 mUSD。

## 一句话

把承诺变成链上可执行对象：质押 + 自然语言条件 + AI 裁判 + 托管合约。同一套引擎覆盖自律打卡、小额交付托管，以及（终局）agent 间验收。

## 问题：承诺从来没有可信的执行层

| | 对自己的承诺 | 对他人的承诺 |
|---|---|---|
| **痛点** | Forfeit 证明市场存在——686,000 次承诺、$8.7M 质押——但平台靠用户失败盈利 → 利益对立、易造假；资金由平台托管 → 中心化、无法审计 | 小额交付合同只能靠信任；传统托管成本远高于合同本身，$100 以下无解 |
| **本质** | 不是执行力问题，是**基础设施缺失** | |

## 解决方案

三个 primitive，一台引擎：

1. **链上托管** — 资金进合约，无人可擅自动用  
2. **AI Judge** — 多模态验收 / 交付仲裁；EIP-712 签名，裁决上链可审计  
3. **自动结算** — 成功退本金 + 守诺勋章；失败锁定 6 个月后**原路退还**（永不罚没）；交付确认即放款  

## 怎么用（三步）

```
① 立约    自然语言描述 → AI 生成摘要 → 质押稳定币 → 规则写死上链
② AI 验收  每日证据 / 交付物 + demo → Judge 审核 → 签名裁决上链
③ 自动结算  条件满足 → 合约自动执行，无需人工审批
```

## 护城河：Judge 链上声誉，越跑越厚

```
自律用户（低门槛入口）
  → 裁决与案例在历史中积累
  → 用户可在承诺结束后通过 ERC-8004 giveFeedback 评价 Judge（RateJudge UI）
  → Escrow 客户自然导入（更高客单价，信任已建立）
  → Judge 已注册为 ERC-8004 Agent #48，链上身份可查
  → （路线图）开放 Judge API，供第三方 / agent 调用
```

竞争对手可以复制合约，**无法复制已积累的裁决历史与声誉**。

**现状：** Agent #48 已注册；用户可在承诺结束后链上评分。全自动声誉写入与公开 Judge API 仍在路线图中（见下）。

## 技术架构

```
用户 (Privy PWA)
    ↓ 自然语言立约 / 上传证据 / 提交交付
Judge 服务 (Node.js · TypeScript · 智谱 GLM)
    ├── SOLO：GLM-4V 视觉验收 → EIP-712 submitVerdict
    ├── Escrow：GLM 文本仲裁 → EIP-712 arbitrate（仅 pass/fail）
    ├── 见证人争议 → glm-4v-plus 复审
    └── ERC-8004 链上身份 · Agent #48
NinjaPact 合约 (Injective EVM · chainId 1439)
    ├── SOLO 状态机：进行中 → 成功/失败 → 锁定 → 可领取
    └── Escrow 状态机：交付 → 验收 → 修改 → 仲裁 → 结算
```

**架构铁律（摘要）**

- 链是唯一真相源 — 前端直读链  
- 后端无状态 — Judge、加密托管、Keeper 定时  
- Judge 零资金裁量权 — 仅签名 `submitVerdict`（SOLO）或 `arbitrate`（Escrow 判 pass/fail）；收款方在立约时写死，合约执行结算  

### 测试网合约

| 合约 | 地址 |
|---|---|
| NinjaPact | `0x88d50C6e0701AB68AF180a8b98D673EBf80850fE` |
| MockUSD | `0x463607175d238f7ede1ED62157C3a89c99D8b150` |
| Badge | `0x04126c34e7A2Fd77f94e82050B9b08854961Bc90` |
| Judge (ERC-8004) | Agent **#48** — [Blockscout](https://testnet.blockscout.injective.network/token/0x8004A818BFB912233c491871b3d84c89A494BD9e/instance/48) |

## 为什么选 Injective

小额承诺结算是 Injective 金融 DNA 最自然的延伸——不是在通用链上硬部署，而是在做它本该有的那一层。

| | 意义 |
|---|---|
| **低单笔成本**（Injective EVM；Pitch 材料约 ~$0.00008/笔） | $50 承诺第一次在链上经济上成立 |
| **快出块**（Pitch 材料约 ~0.64 秒） | 裁决快速确认 — 体验像 Web2，底层不可篡改 |
| **结算层基因** | 条件满足 → 资金自动流转，与承诺结算同构 |

长期：当 Injective 上的 agent 开始互相雇佣，**Judge 就是现成的验收层**。

## 市场机会

- **已验证需求：** Forfeit — 686k 承诺、$8.7M 质押 — 单一 Web2 平台、对立模型，仍跑出这个规模  
- **我们的市场：** 相同需求 × **链上可信执行** × **小额门槛打穿**  
- **想象空间：** 随 Injective agent 经济增长 — 每一笔 agent 间活动需要验收，Judge 就在那里  

## 进度与路线图

### 已完成 · 技术可验

- [x] NinjaPact 合约部署 Injective EVM testnet  
- [x] SOLO 全流程闭环（立约 → 打卡 → AI 裁决 → 结算）  
- [x] Escrow 全流程闭环（交付 → 仲裁 → 放款）  
- [x] DUO 公共事件对赌（能力展示切片）  
- [x] 见证人争议 + Judge 复审（WitnessPage）  
- [x] AI Judge ERC-8004 注册 · Agent #48；用户 `giveFeedback` 评分 UI  
- [x] 前端 PWA 上线 [www.limlamleen.com](https://www.limlamleen.com)  

### Next · 生态扩展

- [ ] Injective mainnet 部署  
- [ ] 承诺结束后自动写入 ERC-8004 声誉（除用户主动评分外）  
- [ ] 开放 Judge API · 任何第三方 agent 可调用 Judge 做验收  
- [ ] Judge 成为 Injective agent 生态的公共验收基础设施  

## 仓库结构

```
contracts/   Solidity + Foundry（NinjaPact、MockUSD、Badge）
frontend/    Vite + React + TypeScript 移动 PWA（viem / wagmi / Privy）
judge/       Express + GLM 多模态裁决 + EIP-712 签名
keeper/      定时：到期结算、超时取消、claim 辅助
deploy/      nginx + pm2 部署说明
docs/        自测清单、部署工单等
NinjaPact_MVP开发文档.md、HANDOFF.md、CLAUDE.md — 在仓库根目录
```

## 本地开发

**环境：** Foundry、Node 18+、pnpm  

```bash
# 合约
cd contracts && forge test

# 前端
cd frontend && pnpm install && pnpm dev

# Judge + Keeper（从 .env.example 复制配置，勿提交私钥）
cd judge && npm install && npm run dev
cd keeper && npm install && npm run dev
```

**Injective EVM 测试网**

- Chain ID：`1439`  
- RPC：`https://testnet.sentry.chain.json-rpc.injective.network`  
- 水龙头：https://testnet.faucet.injective.network/  

**贡献者文档**

| 文件 | 用途 |
|---|---|
| `HANDOFF.md` | 当前状态、部署、待办 |
| `CLAUDE.md` | 工程铁律 |
| `NinjaPact_MVP开发文档.md` | 产品宪法 |
| `NinjaPact_one-pager.md` | 完整 pitch |

## 产品截图（Pitch Deck 对应页）

| 场景 | 页面 |
|---|---|
| 立约对话 + AI 承诺摘要 | CreatePact |
| 打卡 / 交付 + Judge 裁决 | PactDetail / DeliverPage |
| 段位 + 守诺勋章 + Judge 身份 | ProfilePage |
| 公共事件对赌 | BetPage |
| 见证人争议 | WitnessPage |

UI 设计系统见 `frontend/设计系统.dc.html` 与 `frontend/src/index.css`（玉绿 / 金 / 墨底 token）。

---

## 免责声明

仅为测试网演示 — 使用 mock 稳定币（mUSD），非真实资金。

---

**English version → [README.md](README.md)**
