# Ninja Pact — 全部工单清单 v1

> 用法:每张工单**新开会话**贴入。Claude Code 会自动读 CLAUDE.md 与 docs/。
> 验收时重点看 `test/` 目录(测试名是产品规则的人话版本)。
> 截止前两周 P0+P1 冻结,此后只修 bug 不加功能——这条红线高于一切。

---

## ✅ W1 已完成存档:合约骨架 + SOLO 状态机

> 不需要重发。43/43 测试通过,合约地基稳了。后续工单都在这之上叠。

---

## W2a 工单:Injective EVM 部署 + 前端 SOLO 完整闭环

```
读 CLAUDE.md 与 docs/NinjaPact_MVP开发文档.md。

# W2a 工单:部署 + 前端 SOLO 完整闭环

## 范围(包含)

1. **部署到 Injective EVM testnet**(chainId 1439)
   - RPC: https://testnet.sentry.chain.json-rpc.injective.network
   - 水龙头: https://testnet.faucet.injective.network/
   - Foundry 部署脚本:NinjaPact + MockUSD + Badge,按顺序部署 + Badge.initialize
   - 输出三个合约地址,写入前端 .env

2. **嵌入式钱包**:Privy 社交登录 → 自动生成 EVM 账户;用户全程不见助记词/gas

3. **PWA 前端**(Vite + React + TS,移动优先,忍者主题暗色调)
   - viem 读链;wagmi 管钱包
   - iOS Safari + Android Chrome 完整响应式

4. **SOLO 完整流程**:
   a. **立约页**:对话式表单(写死问题:目标/金额200-500/频率)→ 承诺摘要 → 确认
   b. **质押页**:`createCommitment` + `fund` 两笔签名 → 轮询 Active → 跳打卡
   c. **打卡页**:`getUserMedia` 实时相机(禁相册)→ 拍照上传(hash 上链)→
      **AI 模拟裁决**(固定规则,90% pass / 10% fail,无真实 DeepSeek)→ 显示结果
      → 最近 7 天打卡列表
   d. **结算页**:
      - Success:即退金额展示 + 「领取勋章」→ mint soulbound badge
      - Fail:「6 个月锁定」+「开启救赎」按钮 → 新承诺入口

5. **证据存储**:服务器本地盘加密落盘 + sha256 hash;链上只存 hash

## 不含
- Judge ECDSA 签名校验(W2b)
- 真实 DeepSeek 调用(W2b)
- Keeper cron(W2b)
- 双人/见证人(W3)

## 验收(必须全过)
1. 社交登录 → 钱包自动生成
2. 立约 + 质押 + 签名两笔
3. 链上 Created → Active 实时读取
4. 实时相机拍照 + hash 上链
5. AI 模拟裁决展示
6. 全绿到周期末 → Success + 即退 + mint badge(块浏览器可查 soulbound 不可转)
7. 漏卡超阈值 → Fail + 锁定页
8. 救赎:Fail 页发新承诺,新承诺 Success 后旧仓自动 Claimable
9. iPhone SE / 14 Pro / iPad Mini 响应式无错位
10. 无 console error

## 输出
- frontend/ 目录(`pnpm dev` 直接运行)
- scripts/Deploy.s.sol + 部署后地址清单
- .env.local 模板
- 完整流程截图或 gif

开始。
```

---

## W2b 工单:Judge 服务 + 真实裁决 + Keeper

```
读 CLAUDE.md 与 docs/NinjaPact_MVP开发文档.md 第 4 节(Judge 流水线)。

# W2b 工单:Judge 服务 + ECDSA 签名 + Keeper

## 范围(包含)

1. **Judge 服务**(`judge/` 目录,Node.js 18+ ESM + TypeScript)
   - 接前端 POST:`{commitmentId, dayIndex, evidenceHash, imageUrl}`
   - 调 DeepSeek 多模态 API 验证证据(读取 evidencePolicy 里的验收标准)
   - 输出 `{verdict: pass|fail, reasoning, confidence}`
   - 用 Judge 私钥(.env JUDGE_PRIVATE_KEY)对 `{commitmentId, dayIndex, verdict, reasoningHash}` 做 ECDSA 签名
   - 广播 `submitVerdict` 到 Injective EVM testnet
   - 完整理由原文落盘存档,hash 上链

2. **合约改造**:`submitVerdict` 加入 ECDSA 签名校验
   - 入参增加 signature 字段
   - 校验签名者 == 合约里登记的 judge 地址
   - 不再依赖 msg.sender(支持 meta-tx / 任何人代提交)
   - **新增 Foundry 测试**:错误签名拒绝、签名者非 judge 拒绝、重放攻击拒绝

3. **分级裁决**:
   - 日常打卡:走 DeepSeek 轻量档(成本几分钱)
   - 见证人质疑(预留):升级旗舰模型复核(W3 启用,此处只留接口)

4. **Keeper cron**(`keeper/` 目录,node-cron)
   - 每小时扫描:
     - `joinDeadline` 已过且未满员的 Commitment → 触发 `cancelUnfunded`
     - 周期结束的 Active → 触发 `settle`
     - 时间锁到期的 Locked → 标记可 claim(前端推送提醒)
   - 所有调用走 Keeper 自有私钥代付 gas

5. **前端对接**:
   - 打卡上传后,前端不再做模拟裁决
   - 改为 POST 到 Judge 服务 → Judge 异步处理 → 前端轮询链上 verdict 事件

## 不含
- ERC-8004 agent 身份注册(W4)
- 通知系统(W3 一起做)
- 双人 / 见证人(W3)

## 验收(必须全过)
1. 真实拍照 → Judge 调 DeepSeek → 返回带理由的 verdict → 签名上链
2. 链上事件可查:`VerdictSubmitted(commitmentId, dayIndex, verdict, reasoningHash, signer)`
3. 篡改 verdict 内容后用同签名 → 合约拒绝(签名校验单元测试)
4. 非 Judge 私钥签的 verdict → 合约拒绝
5. 重放同一笔 verdict → 合约拒绝(dayIndex 防重)
6. Keeper:joinDeadline 过期的承诺被自动 cancel,资金原路退回
7. Keeper:周期末的 Active 被自动 settle
8. **构造一次「AI 假照片攻击」实测**:用 SD/DALL-E 生成一张假打卡照,Judge 应识别并 verdict=fail(理由里写明判定依据)

## 输出
- judge/ 目录(可独立运行的服务,`pnpm dev` 启动)
- keeper/ 目录(cron 脚本)
- 合约 v2(submitVerdict 加签名校验)+ 新增测试
- 一段录屏:真实打卡 → Judge 推理日志 → 链上 verdict 事件 → 假照片被识破

开始。
```

---

## W3 工单:见证人 + 双人对锁 + 提醒栈

```
读 CLAUDE.md 与 docs/NinjaPact_MVP开发文档.md 第 2.1 节(身份系统)与 P1/P2 表。

# W3 工单:见证人 + 双人对锁 + Web Push

## 范围(包含)

### 一、见证人(P1,优先级最高)

1. **合约**:`acceptWitness(commitmentId, secret)`
   - 输入 secret,合约 keccak256(secret) 对比 witnessInviteHash
   - 通过则将 msg.sender 写入 witness 字段、inviteHash 置零作废
   - 测试覆盖:错误 secret 拒绝、重复绑定拒绝、置零后无法重绑

2. **「质疑证据」权**:`witnessDispute(commitmentId, dayIndex)`
   - 只有已绑定的 witness 可调
   - 一个 commitment 最多质疑 1 次(MVP 简化)
   - 触发 `VerdictUnderReview` 事件,Judge 服务监听后自动升级旗舰模型复核
   - 复核结果覆盖原 verdict

3. **前端**:
   - 立约页:勾选「邀请见证人」→ 生成 secret + 链接 `ninjapact.xyz/w/{id}#{secret}`
   - **secret 必须在 URL fragment(#后)**,不进任何服务器
   - 见证人页:展示承诺详情(链上读)+「绑定为见证人」按钮(社交登录后调 `acceptWitness`)
   - 见证人 dashboard:每日 verdict 实时查看 + 一次「质疑」按钮 + 一次「拍一拍」按钮(发推送给本人)
   - 见证人 = **被动观察压力**,系统不依赖人肉催办

### 二、双人对锁(P2,stretch)

1. **合约**:
   - 立约时 mode=DUO + openSlots[1] 包含对手 inviteHash + requiredStake
   - `joinCommitment(id, secret)` 同笔交易完成入伙 + 注资
   - 状态机:Created → AwaitingParties → Active(两人注资齐)
   - 超时未满员 → `cancelUnfunded` 退款发起人
   - Active 期间 Judge 同时验收两人,结算时按结果分账

2. **前端**:
   - 立约页 mode 选择(SOLO / DUO)
   - DUO 立约后生成对手邀请链接
   - 对手页:展示对方承诺 +「接受挑战并质押」→ `joinCommitment` 一笔签名
   - 双方打卡 dashboard:左右分屏显示两人进度
   - 结算:Win/Lose/Tie 三种情形分账逻辑

3. **不强求**:若时间不够,demo 视频用 UI walkthrough + 路线图替代,**绝不上不稳的功能**

### 三、Web Push 提醒(必做)

1. **A2HS 引导**:onboarding 固定一步——添加到主屏幕(iOS Push 前提)
2. **VAPID 推送服务**:打卡窗口开始时推送
3. **损失框架文案**:「你的 ¥300 还有 2 小时进入危险区」(动态读链上 stake 金额)
4. 截止前 2 小时未打卡 → 第二条紧迫推送
5. **可选 Telegram bot 绑定**(crypto 原生 + 海外用户):同事件触发 bot 消息

## 不含
- ERC-8004 agent 注册(W4)
- 双人争议复核流程(MVP 砍掉)
- 团体 / 奖池(超 MVP)

## 验收
1. 见证人链接打开 → 钱包自动生成 → 一键绑定 → 链上 witness 字段更新
2. 错误 secret 链接 → 合约拒绝、前端友好报错
3. 见证人每日收到本人 verdict 推送
4. 见证人触发 dispute → Judge 服务收到事件 → 自动复核
5. (P2 若做)DUO 完整流程:发起 → 对手入伙 → 双人打卡 → 分账结算
6. Web Push:本人 / 见证人都能收到打卡提醒
7. iOS:A2HS 后推送正常送达;Android:Chrome 原生推送送达

## 输出
- 合约 v3(见证人 + 可选 DUO)+ 新增测试
- 前端见证人页面 + dashboard
- Web Push 订阅与推送脚本
- (可选)Telegram bot 集成
- 录屏:见证人完整流程 + 推送送达截屏

开始。
```

---

## W4 工单:ERC-8004 Judge 身份注册 + 履约信用

```
读 CLAUDE.md。参考 https://github.com/InjectiveLabs/injective-agent-sdk(README 即 API)。

# W4 工单:Judge 上链身份 + 履约信用图谱

## 范围

### 一、Judge 注册为 ERC-8004 链上 agent

1. 用 `@injective/agent-sdk` 把 Judge 注册到 Injective testnet IdentityRegistry
   (地址:0x8004A818BFB912233c491871b3d84c89A494BD9e)
2. Agent Card(IPFS via Pinata):
   - name: "Ninja Pact Judge"
   - type: "other"
   - description: 说明这是承诺裁决 agent
   - services: 至少一个 MCP 或 A2A 端点(可指向 Judge 服务的 /mcp)
   - x402Support: true(预留未来 agent 经济结算)
3. 把 `agentId` 和 `identityTuple` 写入前端展示
4. Judge 每次裁决后,前端展示「裁决者:Ninja Pact Judge #N(已注册为 Injective ERC-8004 agent)」+ 链接到 agents.injective.com/{agentId}

### 二、履约信用图谱

1. **合约扩展**:`mapping(address => ReputationData) reputation;`
   - `successCount, failCount, redeemedCount, totalStakedHistorical`
2. **链上事件**:每次 settle / claim / redeem 时触发 ReputationUpdated
3. **前端「我的忍者档案」页**:
   - 段位(通用带色:白带/黄带/绿带/蓝带/红带/黑带,**禁火影专有词**)
   - 连胜计数
   - 完成承诺总数 / 历史总质押
   - 已获勋章列表(从 Badge 合约拉)
4. **公开档案页** `/profile/{address}`:可分享、可作为信任凭证

## 不含
- 跨地址聚合 / 隐私保护(超 MVP)
- 信用分查询的对外 API(SDK 化在 W5)

## 验收
1. agents.injective.com 上能搜到 Ninja Pact Judge,卡片信息完整
2. 前端裁决展示带 ERC-8004 链接
3. 用户档案页正确读取链上 reputation
4. 段位逻辑:successCount 阈值(如 1/3/5/10/20)自动晋段,前端有晋段动画
5. 公开档案分享链接可在微信打开正常渲染

## 输出
- judge/register-agent.ts 注册脚本(一次性 + 幂等)
- 合约 v4 + reputation 数据结构 + 测试
- 前端档案页 + 公开档案页
- 录屏:注册 Judge → 用户完成承诺 → 段位晋升

开始。
```

---

## W5 工单:Demo 视频 + Pitch Deck + GitHub 整理

```
读 CLAUDE.md 与 docs/NinjaPact_MVP开发文档.md 第 7 节(Demo 视频脚本)。

# W5 工单:提交物准备(非工程,但极重要)

## 一、Demo 视频(≤ 3 分钟)

### 脚本结构(严格按时长)
- 0:00–0:20  钩子 + 三拍叙事:「人类 99% 的承诺没有执行层 → 入口是自律 → 生意是担保 → 终局是 agent 验收」
- 0:20–1:50  SOLO 全真闭环实拍(真人手机录屏):对话立约 → 锁仓 → 实时打卡 → AI 判决上链(展示理由 + 签名)→ 结算退款
- 1:50–2:05  插入 15 秒:「用 AI 生成的假照片作弊 → Judge 识破」
- 2:05–2:25  见证人质疑 → Judge 升级复核(展示链上判决记录)
- 2:25–3:00  引擎与三拍 + 担保层市场画面 + agent 验收层 + 「支付宝从担保交易开始」收尾
  (P2 双人若做出来,替换 1:50–2:05 段为双人对赌实拍)

### 录制规范
- 真机录屏(iPhone 实机,非模拟器)
- 中文配音 + 字幕(中英双语字幕)
- BGM 选忍者风格但不喧宾夺主
- 关键链上事件用浮窗放大展示

## 二、Pitch Deck(10 页)

1. 封面 + 项目一句话定义
2. 问题:人类 99% 的承诺没有执行层(数据)
3. 为什么是现在:AI 裁决成本 + 稳定币 + 近零 gas 的交汇
4. 解决方案:一台引擎,三拍叙事
5. 核心机制:退还制 + 三权分立 + 救赎(用图)
6. 技术:Injective EVM + ERC-8004 Judge + 多方合约(架构图)
7. 竞品对照:StickK / Beeminder / Forfeit 全是裁判兼庄家,我们不是
8. 商业模式:GMV 抽成 + 浮存金 + 信用图谱
9. GTM:校园(Web3Labs 渠道) + crypto 原生场景
10. 团队 + 路线图 + Ask

## 三、GitHub 仓库整理

1. README.md:中英双语
   - 一句话定义
   - Demo gif(嵌入)
   - 在线 demo 链接(ninjapact.xyz)
   - Quick start
   - 架构图
   - 测试覆盖率
   - License (MIT)
2. 完整目录:contracts/ frontend/ judge/ keeper/ docs/
3. CONTRIBUTING.md(欢迎搭子)
4. LICENSE
5. **代码注释**:核心合约逻辑全部加注释
6. **Demo 截图**:6-8 张关键流程截图放在 docs/screenshots/

## 输出
- demo.mp4(≤ 100MB,1080p)
- pitch.pdf
- GitHub repo 完整,带 README gif

不要写代码,这是最后冲刺的内容整理。

开始。
```

---

## 应急 W6 工单(可选):压力测试 + Bug 修复

```
读 CLAUDE.md。

# W6 工单:截止前两周冻结期 — 只修 bug 不加功能

## 范围
- 完整跑通 10 个真实用户故事(找 5 个朋友实测)
- 记录所有 bug,按严重度分级
- 修 P0/P1 bug(影响主流程的),P2 留着
- 性能优化:首屏加载 < 2s、签名响应 < 500ms
- 错误处理:网络中断、签名拒绝、相机权限拒绝 全部友好提示

## 不做
- 任何新功能
- 任何重构
- 任何 UI 大改

## 验收
- 5 个朋友独立跑完闭环,记录痛点
- console 无 error
- 主流程零崩溃

开始。
```

---

## 通用执行纪律(每张工单都适用)

1. **新会话 + 整张工单一次发**,Claude Code 自己读 CLAUDE.md + docs/
2. **验收先看 test/**:测试名 = 产品规则的人话版本,逐条勾决策记录第 9 节
3. **未通过的功能 → 砍**,而不是"凑合上线"——尤其 W3 的 DUO
4. **每张工单尾巴让 Claude 输出**:已完成 / 未完成 / 已知问题 / 需要真机验证的点
5. **审计会话**:合约改动后开独立新会话扮演审计员,丢合约进去找漏洞——建造者和审计者分会话,避免护短
6. **截止前 2 周冻结**:此后只允许 W6 范围内的 bug 修复

## 节奏建议(假设 6 周)

| 周 | 工单 |
|---|---|
| W1 | ✅ 已完成 |
| W2 | W2a(部署+前端) → W2b(Judge+签名)|
| W3 | 见证人(必)+ Web Push(必)+ DUO(stretch)|
| W4 | ERC-8004 + 履约信用 |
| W5 | Demo 视频 + Deck + GitHub |
| W6 | 冻结期,只修 bug |

并行任务(不占工程时间):
- 本周内 one-pager 进 Nova 微信群找搭子
- 50 人问卷(意愿 / 质押额 / 锁定接受度)→ 数据汇入 deck

去吧。
