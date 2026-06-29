# CLAUDE.md — Ninja Pact

## 项目是什么

链上承诺托管 + AI 裁判(Judge)。用户用自然语言立约并质押稳定币,Judge 验收每日证据并签名裁决上链,合约按预写规则自动结算。叙事三拍:入口是自律质押,生意是小额担保,终局是 agent 经济的验收层。

**当前范围 = MVP P0:单人模式全真闭环。** 产品规则的唯一权威来源是 `docs/NinjaPact_MVP开发文档.md`(产品宪法),与本文件冲突时以产品宪法为准。

## 技术栈(已锁定,禁止更换或"顺手升级")

- **合约**:Solidity + Foundry,部署 **Injective EVM Testnet**(chainId `1439`,RPC `https://testnet.sentry.chain.json-rpc.injective.network`,水龙头 https://testnet.faucet.injective.network/)
- **前端**:Vite + React + TypeScript,移动优先 PWA;链交互用 **viem**(+ wagmi);钱包:嵌入式钱包(Privy)为主,注入式钱包(MetaMask/Keplr EVM)为辅
- **Judge 服务**:Node.js 18+(ESM)+ TypeScript;多模态验证调 DeepSeek API;用自己的 EVM 私钥对裁决签名并上链
- **Judge 链上身份**:`@injective/agent-sdk` 注册为 ERC-8004 agent(身份 NFT + 声誉注册表;README 即 API 参考)
- **质押币**:测试网自部署 mock ERC-20 稳定币(demo 用)
- **存储**:证据照片存服务器磁盘/R2;链上只存 sha256 hash

## 权威参考(Injective 相关 API 必须对照出处,禁止凭记忆编写)

- 文档总索引(先抓这个发现页面):https://docs.injective.network/llms.txt
- 官方文档:https://docs.injective.network
- AI 开发者文档:https://docs.injective.network/developers-ai/index
  - 按其指引使用 **Injective documentation MCP server**(本项目已添加/应添加到 Claude Code)
  - 按其指引使用 **Injective EVM developer skill**
- Agent SDK:https://github.com/InjectiveLabs/injective-agent-sdk
- Build 页面:https://injective.com/build

**纪律**:通用 EVM/Solidity 知识可直接使用;但凡涉及 Injective 特定内容(chainId、RPC、预编译、gas 行为、合约地址、agent-sdk 用法),必须先经文档 MCP 或上述链接确认。查不到 → 停下来向我提问,**不要编造 API**。

## 架构铁律(违反 = 返工,无例外)

1. **链是唯一真相源**:承诺状态、资金、判决 hash 全部上链;前端直接读链,不得引入后端数据库作为状态源
2. **后端无状态**,只做三件事:Judge 裁决、证据存储、keeper 定时;随时可销毁重建
3. **Judge 零资金权限**:Judge 地址只能调 `submitVerdict`;整个合约不存在任何把用户资金转给第三方的代码路径——资金出口只有两个:成功即退本人 / 时间锁到期 claim 退本人
4. **多方结构第一天落地**:`Party[] parties` + `OpenSlot[] openSlots`;SOLO/DUO 是同一合约的参数化形态
5. **失败不罚没**:Fail → Locked(6 个月)→ Claimable → 原路退还
6. **免卡券(restCards)是立约参数**,写入 evidencePolicy,任何角色事后不可增减
7. **救赎**:`redeemLock(lockedId, successId)`——同一地址、successId 已 Success 且未被用于其他救赎;一胜赎一败
8. 邀请 secret 只走 URL fragment(`#`);合约验证通过后 inviteHash **立即置零作废**
9. 成功只奖励 soulbound 勋章(不可转让 ERC-721)与履约记录;**不发现金、不发任何可交易资产**
10. 照片永不上链(只上 hash);原图加密存储;私钥只经 `.env`(已 gitignore),任何代码、日志、commit、输出中不得出现私钥

## 工程纪律

- **测试先行**:合约每条状态转换、每个权限检查、每个边界条件(错误 secret、重复救赎、非 Judge 调 verdict、超时取消、重复 claim、免卡券耗尽)都必须有 Foundry 测试;**无测试的合约改动一律不接受**。先在本地 anvil 全绿,再碰 testnet
- **工单制**:一次会话只做当前工单;不顺手重构、不提前实现 POOL / MILESTONE / DEPOSIT(只留枚举占位)
- **版本锁定**:依赖版本精确锁定,禁止擅自升级
- **每个工单收尾必须输出**:已完成 / 未完成 / 已知问题 / 需要人工真机验证的点
- 前端文案与 UI 为中文,忍者主题;段位命名用通用段位/带色,**禁用火影专有名词**

## 目录结构

```
contracts/   # Foundry 工程(NinjaPact.sol、MockUSD.sol、Badge.sol、test/)
frontend/    # Vite + React PWA
judge/       # Judge 服务(收证据 → DeepSeek → 裁决 → 签名 → 上链)
keeper/      # cron:到期结算、超时取消、claim 代触发
docs/        # NinjaPact_MVP开发文档.md(产品宪法)、one-pager
```

## 常用命令

```
# 合约
cd contracts && forge build && forge test -vvv
anvil                                  # 本地链
forge script ... --rpc-url $INJ_EVM_TESTNET_RPC --broadcast   # 测试网部署

# 前端 / 服务
pnpm dev / pnpm build
```

## 当前里程碑

W1:Foundry 合约骨架(Commitment 多方结构 + SOLO 状态机 + 免卡券 + 救赎)+ 全量测试本地全绿 → 部署 Injective EVM testnet 并在浏览器验证。
