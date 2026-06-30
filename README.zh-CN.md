# NinjaPact · 忍者之约

**The Commitment Layer** — 链上承诺 · AI 裁决 · 自动结算 · Built on Injective EVM

**语言：** [中文](#中文) · [English](README.md)

---

<a id="中文"></a>

## website

**https://www.limlamleen.com** — Injective EVM 测试网（chainId `1439`）。Privy 邮箱 / Google 登录；应用内可领取测试 mUSD。

## 问题：承诺从来没有可信的执行层

社会只给两种承诺配了「牙齿」：

- **大额合同** → 归法律（但诉讼成本让万元以下不值得打官司）
- **平台内承诺** → 归平台（出了平台就管不着）

剩下的呢？朋友间 50 块的代办、答应粉丝的周更、小额交付合同——**违约的社会成本被默认为零**。

不是没人想管，是**管不起**：人工裁决一单纠纷的成本，远高于 200 块的标的。

### 在位者验证了需求，但修不了根本缺陷

Forfeit · StickK · Beeminder——三家做「习惯承诺」的 Web2 产品，合计运营超 18 年。模式相同：你承诺目标，押钱，失败了钱归平台。

Beeminder FAQ 原话：*"收罚金就是我们的商业模式"*。

**裁判兼庄家**——判你失败，它就赚钱。这个利益结构，Web2 在位者永远修不了；修了就杀死自己的商业模式。

## 为什么是现在

三条线在 **2025–26 年第一次同年交汇**：

1. **AI 裁决成本归零** — 多模态证据验证打到几分钱；两年前用 GPT-4V 做同样的事，费率倒挂，商业上不成立  
2. **执行成本归零** — 稳定币 + Injective 近零 gas；托管和结算不再需要任何机构  
3. **入口成熟** — 嵌入式钱包与账户抽象；普通人第一次用得起链  

这个产品在 2024 年之前造不出来；在 2027 年之后轮不到我们造。

## 解决方案

**把承诺变成链上可执行对象** — 同一个引擎，两种承诺都能执行：

1. **链上托管** — 资金进合约，无人可动  
2. **AI Judge** — 多模态验收 / 交付仲裁，EIP-712 签名，裁决上链可审计  
3. **自动结算** — 成功退本金 + 守诺勋章；失败锁定 6 个月后退还，**永不罚没**  

### 机制设计的两刀

- **伪造证据骗过裁判**，你「偷」到的只是自己的钱提前六个月解锁 — 时间价值不到几块钱，低于伪造成本，攻击在经济上不成立  
- **AI 判错的代价也只是流动性，不是本金** — 最难做好的组件被机制设计降级为非关键组件，v1 即可安全上线  

**裁判 · 托管 · 受益人 — 三权分立，上链可查。**

## 商业模式

**从第一单起自负盈亏，随交易量复利：**

| 阶段 | 模式 |
|---|---|
| **一** | 固定服务费 — 成本价 +，覆盖 AI token，第一单起正向现金流 |
| **二** | 浮存金收益 — 托管资金在合约锁定期间的链上收益，透明可查 |
| **三** | GMV 抽成（核心生意）— 每一笔经过引擎的交易留下费率，**不依赖用户失败** |
| **长期** | 履约征信查询 — 判例库 + 履约信用图谱，为法律够不着的领域建征信局 |

**护城河资产：** 判例库（普通法式积累，裁决越多越一致）· 履约信用图谱（在交易场景里即卖家信誉）· 证据集成网络（健康 app / GitHub / 物流 API，越接越宽）

## 护城河：Judge 链上声誉，越跑越厚

```
Habit 用户（低门槛入口，零冷启动）
  → 每次裁决，Judge on-chain reputation +1
  → 判例库积累，AI 判准率提升
  → Escrow 客户自然导入（信任已建立，客单价更高）
  → Judge 成为 ERC-8004 注册 Agent，声誉链上可查
  → 第三方 agent 调用 Judge 做验收
  → Agent 间经济活动的公共验收基础设施
```

竞争对手可以复制合约，**无法复制链上声誉**。

支付宝从淘宝的担保交易长成支付帝国 — **担保是入口，结算是生意**。

**现状：** Judge 已注册为 ERC-8004 [Agent #48](https://testnet.blockscout.injective.network/token/0x8004A818BFB912233c491871b3d84c89A494BD9e/instance/48)；用户可在承诺结束后通过 `giveFeedback` 链上评分。全自动声誉写入与公开 Judge API 仍在路线图中。

## 怎么用（三步）

```
① 立约    自然语言描述目标 → AI 生成承诺摘要 → 质押稳定币 → 规则写死上链
② AI 验收  每日上传证据 / 提交交付物 + demo → Judge 多模态审核 → EIP-712 签名裁决上链
③ 自动结算  条件满足 → 合约自动执行，无需任何人审批
```

## 技术架构

两个业务场景，共用同一个 Judge 引擎；每一次裁决积累同一个 Agent 的链上声誉。

```
用户 (Privy 嵌入式钱包)
    ↓ 自然语言立约 / 上传证据 / 提交交付
Judge 服务 (Node.js · TypeScript)
    ├── SOLO：GLM-4V 视觉验收（每日证据）
    ├── Escrow 日常：GLM 文本仲裁（vs 验收标准）
    ├── Escrow 终局裁决：Azure OpenAI GPT-5.4 (Microsoft Foundry) — 修改次数用尽后旗舰模型终局仲裁
    ├── EIP-712 签名裁决
    └── ERC-8004 on-chain identity · Agent #48
        https://testnet.blockscout.injective.network/token/0x8004A818BFB912233c491871b3d84c89A494BD9e/instance/48

NinjaPact 合约 (Injective EVM · chainId 1439)
    ├── SOLO 状态机：进行中 → 成功/失败 → 锁定 → 可领取
    └── Escrow 状态机：交付 → 验收 → 修改 → 仲裁 → 结算
```

**架构铁律（摘要）**

- 链是唯一真相源 — 前端直读链  
- 后端无状态 — Judge、加密托管、Keeper 定时  
- Judge 零资金裁量权 — 仅签名 `submitVerdict` / `arbitrate`；收款方在立约时写死  

### 测试网合约

| 合约 | 地址 |
|---|---|
| NinjaPact | `0x88d50C6e0701AB68AF180a8b98D673EBf80850fE` |
| MockUSD | `0x463607175d238f7ede1ED62157C3a89c99D8b150` |
| Badge | `0x04126c34e7A2Fd77f94e82050B9b08854961Bc90` |
| Judge (ERC-8004) | Agent **#48** — [Blockscout](https://testnet.blockscout.injective.network/token/0x8004A818BFB912233c491871b3d84c89A494BD9e/instance/48) |

## 为什么选 Injective

小额承诺结算是 Injective 金融 DNA 最自然的延伸 — 不是在通用链上强行部署，而是在做它本该有的那一层。

| | 意义 |
|---|---|
| **~$0.00008/tx**（Pitch 材料） | $20 承诺合约第一次经济上成立 |
| **~0.64s 出块**（Pitch 材料） | 裁决瞬间确认 — Web2 体验，链上不可篡改 |
| **结算层基因** | 条件满足 → 资金自动流转 |

**对 Injective 的双向漏斗：** 自律入口把圈外人静默带进 Injective（嵌入式钱包，登录即开户）；担保层把真实结算量与稳定币沉淀留在链上 — **一头带人，一头带钱**。

长期：当 Injective 上的 agent 开始互相雇佣，**Judge 就是现成的验收层**。

## 市场机会

**已验证市场：** Forfeit — 686,000 次承诺 · $8.7M 质押 · 单一平台、对立模型，仍跑出这个规模。

**我们的市场** = 相同需求 × 链上可信执行 × 小额门槛打穿。

每个微信 / Telegram 大群里都坐着一个收 1–5% 的人肉中间人 — 代购、约稿、接单、链上资产 OTC，全靠江湖信誉裸奔。AI 把单笔裁决成本打到几分钱后，**$50 的交易第一次担保得起**。

**想象空间：** 不预测具体数字 — 随 Injective agent 经济增长，每一笔 agent 间活动需要验收，Judge 就在那里。

## 进度与路线图

### 已完成 · 技术可验

- [x] NinjaPact 合约部署 Injective EVM testnet  
- [x] SOLO 全流程闭环（立约 → 打卡 → AI 裁决 → 结算）  
- [x] Escrow 全流程闭环（交付 → 仲裁 → 放款）  
- [x] AI Judge ERC-8004 注册 · [Agent #48](https://testnet.blockscout.injective.network/token/0x8004A818BFB912233c491871b3d84c89A494BD9e/instance/48)（Blockscout 可查）  
- [x] 上线 [limlamleen.com](https://www.limlamleen.com)  
- [x] Solo builder + AI 工具链，从零到全栈闭环  

### Next · 生态扩展

- [ ] Injective mainnet 部署  
- [ ] 开放 Judge API · 任何第三方 agent 可调用 Judge 做验收  
- [ ] Judge 成为 Injective agent 生态的公共验收基础设施  

## 现在就试

| | |
|---|---|
| **产品** | [limlamleen.com](https://www.limlamleen.com) |
| **Judge API 合作 / 联系** | limlamleen@gmail.com |
| **代码** | [github.com/KarlLeen/NinjaPact](https://github.com/KarlLeen/NinjaPact) |

## 仓库结构

```
contracts/   Solidity + Foundry（NinjaPact、MockUSD、Badge）
frontend/    Vite + React + TypeScript 移动 PWA（viem / wagmi / Privy）
judge/       Express + GLM / Azure OpenAI 多模态裁决 + EIP-712 签名
keeper/      定时：到期结算、超时取消、claim 辅助
deploy/      nginx + pm2 部署说明
docs/        自测清单、部署工单等
```

## 本地开发

**环境：** Foundry、Node 18+、pnpm  

```bash
cd contracts && forge test
cd frontend && pnpm install && pnpm dev
cd judge && npm install && npm run dev   # 复制 .env，勿提交私钥
cd keeper && npm install && npm run dev
```

**Injective EVM 测试网：** chainId `1439` · RPC `https://testnet.sentry.chain.json-rpc.injective.network` · [水龙头](https://testnet.faucet.injective.network/)

## 产品截图（Pitch Deck 对应页）

| 场景 | 页面 |
|---|---|
| 立约对话 + AI 承诺摘要 | CreatePact |
| 打卡 / 交付 + Judge 裁决 | PactDetail / DeliverPage |
| 段位 + 守诺勋章 + Judge 身份 | ProfilePage |
| 公共事件对赌 | BetPage |
| 见证人争议 | WitnessPage |


---

## 免责声明

仅为测试网演示 — 使用 mock 稳定币（mUSD），非真实资金。非投资建议。

---

**The Commitment Layer · Built on Injective** · [English → README.md](README.md)
