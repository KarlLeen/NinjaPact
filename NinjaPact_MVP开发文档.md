# Ninja Pact(兑)— MVP 开发文档 v1.1

> 目标:在 Injective Nova 截止前交付一个**单人模式全真闭环**(P0),力争**双人对锁**(P2),所有合约与数据结构从第一天按多方设计。
> 叙事三拍:入口是自律,生意是小额担保,终局是 agent 经济的验收层。

---

## 1. 范围分档(每项标注服务的评分维度)

**维度代号**:①创新性 ②技术实现 ③应用价值 ④产品体验 ⑤生态契合度

### P0 — 核心闭环(必须 done-done,不可妥协)

| 功能 | 说明 | 维度 |
|---|---|---|
| 对话式立约 | 用户用自然语言描述承诺,Judge 追问澄清(频率?什么算一次?证据形式?),生成结构化 Commitment 对象,展示确认后签名锁仓 | ①②④ |
| 链上托管 | Solidity 合约(Injective EVM 测试网,chainId 1439),稳定币质押(测试网用自部署 mock ERC-20);成功即退,失败转入 6 个月时间锁池,到期可 claim 原路退还 | ② |
| 每日验收 | 强制实时拍摄(getUserMedia,禁相册上传)+ 随机即时指令(如「比出数字 3」)+ 服务器时间戳 | ②④ |
| AI 裁决 | DeepSeek V4 多模态验证 → 裁决 + 理由 → Judge 私钥签名 → 上链 → 触发合约状态变更 | ①② |
| 结算 | 周期结束自动判定成败;keeper 触发退款 / 入池;6 个月后 claim | ② |
| 嵌入式钱包 + gas 代付 | 社交登录即生成钱包(Privy / Web3Auth 类),用户全程不见助记词与 gas | ④ |
| 提醒 | 打卡窗口开始 → Web Push(损失框架文案:「你的 ¥300 还有 2 小时进入危险区」);可选 Telegram bot 绑定(crypto 原生 + 海外)。onboarding 固定一步:添加到主屏幕(iOS 推送前提) | ③④ |
| soulbound 守诺勋章 | 完成即 mint 不可转让 NFT;**忍者段位体系**(连胜晋段,呼应 Injective 忍者品牌;命名用通用段位/带色,避开火影专有词) | ①④⑤ |

### P1 — 社交层(便宜,优先于 P2)

| 功能 | 说明 | 维度 |
|---|---|---|
| 见证人 | 立约时邀请一位朋友(链接即可,无需质押)。定位是**被动观察压力**(霍桑效应):每日自动收到判决结果,无需任何动作;附一个可选「拍一拍」催办按钮与一次「质疑证据」权(触发 Judge 升级复核)。提醒责任在系统(提醒升级栈),不外包给人情 | ①③④ |
| 分享卡片 | 立约 / 完成时生成可发微信的图片卡(含勋章与连胜),链接即产品 | ③ |

### P2 — Stretch(时间盒:P0+P1 done-done 之后才允许动工)

| 功能 | 说明 | 维度 |
|---|---|---|
| 双人对锁挑战 | 发起 → 对方接受并对锁 → 共用 Judge → 判决分账。砍掉争议复核等一切旁支,只做最窄路径 | ①③ |

**铁律**:截止前两周冻结 P0+P1,此后只修 bug 不加功能。P2 做不完就在 demo 视频里以 UI walkthrough + 路线图呈现,绝不上一个不稳的功能。

---

## 2. 系统架构

```
[手机浏览器 PWA]
  Vite + React,移动优先,HTTPS(Let's Encrypt)
  嵌入式钱包 SDK(Privy)| viem 直读链上状态
        │
        ├──────────────► [Injective EVM 测试网(chainId 1439)]
        │                 Solidity 托管合约(资金与状态的唯一真相源)
        │                 Judge 裁决记录(签名 + 理由 hash)
        │                 soulbound 勋章合约(不可转让 ERC-721)
        │
        └──────────────► [自有服务器(nginx)]
                          ① Judge 服务(Node.js 单体):
                             收证据 → 调 DeepSeek → 裁决 → 签名 → 广播上链
                          ② 证据存储:照片加密落盘 / R2,链上只存 hash
                          ③ keeper cron:到期结算、超时判负、claim 提醒
```

设计原则:**链是数据库**(承诺状态、资金、判决全部上链,前端不依赖后端读状态);**后端只做三件事**(裁决、存证、定时),无状态、可随时重建;**Judge 是独立服务**而非 app 后端的一部分(第四颗钉子,为开放协议留门)。

### 2.1 身份与账号体系:没有传统账号系统

- **地址即身份**:普通用户社交登录 → 嵌入式钱包(Privy / Web3Auth)静默生成 Injective 密钥;crypto 原生用户连 Keplr / Leap。无用户名密码表、无用户数据库;昵称头像 MVP 不做(地址缩写 + 忍者头像生成器)。
- **服务器唯一的认证**:上传证据前,前端用用户私钥对服务器 nonce 签名 → 验签发短时效 JWT(SIWE 模式)。无 session 表、无状态。链上操作的认证就是交易签名本身。
- **邀请凭证模式(claim pattern)**:被邀请者(见证人 / 对手)立约时尚无钱包,无法预写地址。合约存 `invite_hash = hash(secret)`;链接 `ninjapact.xyz/w/{id}#{secret}`(secret 在 URL fragment,不经任何服务器);被邀请者点开 → 前端凭 id 直接从链上读承诺详情(无需发起人在线、无需后端)→ 登录生成钱包 → 调 `accept_witness` / `join_commitment` 携带 secret → 合约验 hash 后将调用者地址写入。**多方场景自始至终是同一个原语:空位 + 凭证 + 注资入伙**。

---

## 3. 合约设计

### 3.1 Commitment 数据对象(多方,第一天起)

```solidity
struct Commitment {
  uint64 id;
  Mode mode;                     // SOLO | DUO | POOL | MILESTONE | DEPOSIT(枚举占位)
  Party[] parties;               // 已入伙方;SOLO 时长度 1
  OpenSlot[] openSlots;          // 空位:DUO 为 1 个,SOLO 为空
  address judge;                 // Judge 地址(verdict 签名校验)
  address witness;               // P1 见证人(绑定后写入,零值 = 未绑定)
  bytes32 witnessInviteHash;     // 见证人邀请凭证(用后置零)
  bytes32 termsHash;             // 承诺全文 + 验收标准 hash(原文存链下)
  EvidencePolicy evidencePolicy; // 频率、证据类型、免卡券额度、判负阈值
  Schedule schedule;             // 起止、打卡窗口
  uint64 joinDeadline;           // 入伙超时(如 48h),逾期发起人可取消退款
  State state;
}

struct Party    { address addr; uint256 stake; Role role; bool funded; }
struct OpenSlot { Role role; uint256 requiredStake; bytes32 inviteHash; }
// Role: COMMITTER | CHALLENGER;质押币种:测试网 mock ERC-20 稳定币
```

### 3.2 状态机

```
Created ─发起人注资→ AwaitingParties(SOLO 自动跳过)
  ├─ 空位全部入伙注资 → Active ─(每日 verdict 累积)→ 期末判定
  │    ├─ Success → Settled:即时全额退款 + mint 勋章 + 信用 +1
  │    └─ Fail    → Locked(6 个月时间锁)
  │           ├─ 到期 → Claimable → claim 原路退还
  │           └─ 救赎:本人完成任意一个新承诺(Success)→ 旧 Locked 立即转 Claimable
  └─ 超过 join_deadline 未满员 → Cancelled:发起人取消,原路退款
```

- 判负规则在 evidence_policy 里前置写死(如:缺卡 N 次即败,**免卡券额度内的缺卡不计**),Judge 只裁决单次证据真伪,**成败由合约按规则自动汇总**——把主观性压到最小。
- **免卡券**:立约时自选额度(如 30 天含 3 张)或连胜挣取(每连续 7 天 +1),写死在 evidence_policy,Judge 无权事后增减——宽限是合约条款,不是裁判心软。
- **救赎机制**:失败不是死路,是"欠自己的一局"。解锁旧仓的唯一钥匙是真完成一个新承诺(单人退还制下,刷新约骗解锁的成本 ≥ 真做的成本)。流失悬崖 → 回流钩子;免费 app 给不出这个机制,因为它们手里没有抵押物。
- claim / cancel / redeem 任何人可代触发(keeper 代付 gas)。

### 3.3 关键入口(execute msgs)

`create_commitment` / `fund` / `join_commitment(id, secret)`(凭证入伙 + 同笔交易注资)/ `accept_witness(id, secret)`(见证人绑定)/ `cancel_unfunded`(超时退款)/ `submit_verdict`(仅 Judge 签名可调,附理由 hash)/ `witness_dispute`(P1,触发复核标记)/ `settle` / `claim` / `redeem_lock(locked_id, success_id)`(救赎:验证 success_id 为同一地址的已 Success 承诺且未被用于其他救赎,旧仓转 Claimable)

### 3.4 模板族

单锁(SOLO)与对锁(DUO)是同一合约的参数化形态——parties 长度与分账规则不同,代码路径共用。POOL / MILESTONE / DEPOSIT 仅保留枚举与接口占位,不实现。

---

## 4. Judge 流水线

1. **立约对话**(LLM 会话):把模糊承诺规范化——逼出可裁决的定义(「健身」=什么画面算数?)、频率、宽限、证据形式 → 输出结构化 terms + evidence_policy,用户确认后 hash 上链。**验收标准前置是产品,不只是流程**。默认模板用**频率制**(「本月 12 次」)而非每日制——每日制 + 真钱锁定 = 最陡的失败螺旋;对话中主动引导用户配置免卡券额度。
2. **证据采集**:页面调起实时相机(禁相册);随机即时指令注入(防预拍 / AI 生成);上传附服务器时间戳;原图加密存储,hash 上链。
3. **分级裁决**:日常打卡走轻量模型(成本几分钱);见证人质疑或模型置信度低时升级旗舰模型复核;每份裁决输出 `{verdict, confidence, reasoning}`。
4. **签名上链**:Judge 私钥(服务器 KMS / 环境隔离)签名,调 `submit_verdict`。裁决理由原文存链下、hash 上链——**可审计是三权分立承诺的实物证据**。
5. **判例记录**:每次裁决落库(承诺类型、证据、判决、理由),作为后续一致性参照与 pitch 中"判例库"叙事的种子。

**链上 agent 身份**(②维深度分):Judge 用 `@injective/agent-sdk` 注册为 **ERC-8004 链上 agent**(身份 NFT + 声誉注册表,可在 agents.injective.com 检索)——它有正式身份、有签名史、有不可抵赖的判决记录,且走的是 Injective 官方的 agent 身份标准。pitch 单独给一页。

---

## 5. 安全与隐私

- **风险封顶(机制层)**:单人退还制下,作弊收益 = 自己资金提前 6 个月解锁的时间价值(≈几元),低于伪造成本;AI 错判代价同样只是流动性。v1 不追求完美裁判。
- **防伪(采集层)**:实时拍摄 + 随机指令 + 时间戳交叉。web 拿不到硬件级 attestation——已知降级,第一环风险预算内可接受;第三环(奖池)前升级原生 app。demo 里专门演示「AI 假照片被抓」。
- **隐私**:人脸照片永不上链;链上仅 hash;链下加密存储,保留期满即删。
- **资金安全**:合约不可升级部分最小化;Judge 仅有 verdict 权限,**无任何资金转移权限**(资金路径只有:退还本人 / 时间锁后退还本人)——把"被盗 Judge 私钥"的最坏后果也封顶。

---

## 6. 里程碑(以 6 周为模板,按实际截止日压缩)

- **W1**:Foundry 合约骨架(Commitment 多方结构 + SOLO 状态机 + 免卡券 + 救赎)+ 全量测试本地 anvil 全绿 → 部署 Injective EVM 测试网;前端脚手架 + 嵌入式钱包打通
- **W2**:Judge 服务最小版(收图 → DeepSeek → 裁决 → 签名上链);实时拍摄组件
- **W3**:立约对话流;keeper;端到端闭环首次全真跑通 ← **本周末是去/留判断点**
- **W4**:P1(见证人 + 分享卡);UI 打磨;勋章合约
- **W5**:冻结 P0+P1;压力测试与修 bug;(若余量)P2 双人最窄路径
- **W6**:demo 视频 + pitch deck + 开源仓库整理;50 人问卷数据汇入 deck

并行任务(不占工程时间):本周内把 one-pager 发进 Nova 微信群找搭子;问卷(立 flag 意愿 / 可接受质押额 / 6 个月锁定接受度)发出去滚数据。

---

## 7. Demo 视频脚本(≤3 分钟)

1. **0:00–0:20** 钩子:「人类 99% 的承诺没有执行层」→ 三拍叙事一句话带过
2. **0:20–1:50** 单人全真闭环实拍:对话立约 → 锁仓 → 实时打卡 → AI 判决上链(展示裁决理由与签名)→ 结算退款。中间插 15 秒「用 AI 假照片作弊 → 被 Judge 抓获」
3. **1:50–2:20** 见证人质疑 → 升级复核(结合深度 + 体验);浏览器里展示链上判决记录(可审计)
4. **2:20–3:00** 引擎与三拍:担保层的市场(人肉中间人画面)→ agent 验收层 → 「支付宝从担保交易开始」收尾。P2 若完成,此段替换为双人对赌实拍

---

## 8. 成本与运维清单

| 项 | 方案 | 成本 |
|---|---|---|
| 前端托管 | 自有服务器 nginx / Cloudflare Pages | 0 |
| 合约 | Injective 测试网 | 0 |
| Judge + keeper | 自有服务器 | 0(电费) |
| 图片存储 | 本地盘或 R2 | ~0 |
| LLM | DeepSeek V4 API,分级调用 | 唯一变动成本,~¥0.1–0.3/次验证 |
| 钱包 SDK | Privy / Web3Auth 免费层 | 0 |
| 域名/HTTPS | 已有 + Let's Encrypt | 0 |

---

## 9. 已拍板的决策记录(防止未来自我推翻)

1. 失败**不罚没**:6 个月时间锁后原路全退——同时封顶作弊收益与错判代价,且使产品脱离赌博定义
2. 平台收入与用户输赢**解耦**:固定服务费 + 透明浮存收益;成功奖励只发信用与 soulbound 勋章,**不发现金、不发可交易资产**(防 farm)
3. 合约与数据结构**从第一天多方设计**;SOLO/DUO 同族参数化
4. Judge 是**独立服务 + 链上 agent 身份**,裁决签名上链,无资金权限
5. 履约信用从第一笔承诺开始记录
6. 交易担保(第三环)标的**白名单制**,从可验证交付的数字商品与服务起步;大陆法币场景不碰,crypto 原生场景先行
7. **免卡券是合约条款**:立约时定额或连胜挣取,Judge 无权事后增减(留存科学进合约,不进裁判)
8. **救赎机制**:Locked 期间完成任意新承诺 → 旧仓立即可领;一个 Success 只能救赎一个旧仓
9. 默认模板**频率制**而非每日制
10. 提醒责任在系统(Web Push 损失框架文案 + 可选 TG bot),**不外包给见证人**;见证人 = 被动观察压力 + 可选拍一拍
11. 合约层走 **Injective EVM(Solidity + Foundry)**而非 CosmWasm:AI 辅助开发的强区 + Injective 当前官方主推路径;Judge 身份用 `@injective/agent-sdk` 注册 ERC-8004;开发时挂 Injective 文档 MCP server 防 API 幻觉
