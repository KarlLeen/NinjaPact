# 工单:合并 Redeploy(joiner 索引 + DUO 公共事件对赌)

> 状态:**✅ 已完成(2026-06-28) — 保留作存档**
> 执行结果:合约 + 4 个 env + live box 均已上线;新地址见 `HANDOFF.md` §4。
> 归属里程碑:把两处「已写好+本地全绿、未上线」的合约改动一次性部署到 Injective EVM testnet。
> 关联:`HANDOFF.md` §4(已部署状态)、§7(部署方法)、§11(backlog)。
> 剩余:owner 真机 E2E(对赌全闭环 + 安全网各退各) — 见 §4 验收清单。

---

## 1) 目标与范围

把以下**已在代码里完成、`forge test` 全绿、但尚未上链**的两项一起 redeploy 上线:

1. **joiner 索引**:`joinCommitment` 里 `_userCommitments[msg.sender].push(id)` —— 让交付方/对手也能被 `getUserCommitments` 枚举(干掉 Dashboard 的 localStorage deliver-jobs 兜底)。
2. **DUO 公共事件对赌(能力展示切片)**:`createBet` / `resolveBet` / `_settleBet`(赢家通吃)/ `getCreatorBetsYes` / `BetResolved` / `settle` 的 DUO 安全网分支;配套 judge(`/resolve-bet/:id`、`/bet-result/:id`)、keeper(DUO 分支)、前端(🎲 对赌 tab + `/b/:id`)。
   - ⚠️ **有意的 owner override**:对赌会罚没输家(突破宪法决策#1「失败不罚没」)+ AI 当外部事件预言机。本工单执行 = 默认 owner 已确认要在真机演示里展示该能力。

**不在本工单范围**:POOL/MILESTONE、custody/evidence→R2、Path B escrow、AI 联网检索。

---

## 2) 前提 / 风险(执行前必须确认)

- ⚠️ **每次合约 redeploy 会作废所有现有承诺**(id 归零重排)、重铸全新 MockUSD/Badge。现网上的任何 demo 承诺都会失效。**需 owner 明确同意**再做。
- 当前没有任何线上 DUO 对赌(本功能从未上线),所以对赌部分零迁移成本;joiner 索引同理(只影响新承诺)。
- 本地必须先 `cd contracts && forge test` **全绿(当前 80 passed)**,且保持 foundry optimizer 设置(§2:`optimizer=true, optimizer_runs=1, via_ir=true`)。
- 私钥只在 `*.env`(已 gitignore):部署用 `contracts/.env` 的 `PRIVATE_KEY`(deployer)。任何输出/commit/日志中不得出现私钥。

---

## 3) 执行步骤

### A. 部署前
1. `cd contracts && forge build && forge test` → 必须全绿。
2. 与 owner 确认:接受「作废现有承诺、重铸代币」。

### B. 部署合约(§7 的可用方法 —— `forge script` 会因 sentry RPC fork-init 超时,改用 `cast send --create` 重试循环)
3. 依次部署,记录新地址:
   - `MockUSD`(无构造参数)
   - `Badge`(无构造参数)
   - `NinjaPact(_token=<MockUSD>, _badge=<Badge>)` —— 构造参数 abi-encode 后拼到 bytecode 末尾。
4. 初始化与铸币:
   - `cast send <Badge> "initialize(address)" <NinjaPact>` —— 让 Badge 只认新 NinjaPact 铸勋章。
   - `cast send <MockUSD> "mint(address,uint256)" <Privy 嵌入式测试钱包> <额度>`(给 demo 账户),按需也给 deployer。
5. 确认 gas:Judge 钱包 `0xfBA7…2A18`、Keeper 钱包 `0x3801…72c4` 各还有 ≥0.5 INJ(不够就从 deployer 转或走水龙头)。

> Judge 的 ERC-8004 agentId **#48 不受影响**(在 IdentityRegistry 上,独立于 NinjaPact)。ReputationRegistry 地址 `0x8004B663…8713` 不变。**无需重新注册 agent**,只要 `judge/.env` 的 `JUDGE_PRIVATE_KEY` 不变。

### C. 更新 4 个 env(把三个新地址写进去)
6. 同步以下文件的 `NINJAPACT`/`MOCKUSD`/`BADGE` 地址(其余键不动):
   - `frontend/.env.local`、`frontend/.env.production`(`VITE_NINJAPACT_ADDRESS` / `VITE_MOCKUSD_ADDRESS` / `VITE_BADGE_ADDRESS`)
   - `judge/.env`(`NINJAPACT_ADDRESS`)
   - `keeper/.env`(`NINJAPACT_ADDRESS`)
   - 保留 `VITE_JUDGE_AGENT_ID=48` / `JUDGE_AGENT_ID=48` / `CUSTODY_KEY=…` 等不变。

### D. 部署应用(§7;SSH 单连接,严禁 burst。SSH 不通则走 gist→Tencent VNC console 法)
7. 同步代码到 `/var/www/ninjapact/`(含本次 judge/keeper/frontend/contracts 改动 + 新 env)。
8. 远端:`cd frontend && pnpm build`。
9. **顺手把 nginx `client_max_body_size` 50m → 12m**(§6.2 遗留;`grep -rl client_max_body_size /etc/nginx/` 定位后改,与 repo `deploy/nginx-ninjapact.conf` 一致),`sudo systemctl reload nginx`。
10. `pm2 restart np-judge np-keeper`(judge 新增 `/resolve-bet`、`/bet-result`;keeper 新增 DUO 分支,都需重启)。

---

## 4) 验收清单(从外部真机/浏览器验证,别假设步骤跑过了)

回归(确保 redeploy 没打断既有闭环):
- [ ] SOLO 自律打卡:立约→打卡→裁决→结算,正常。
- [ ] DEPOSIT 交付托管:立约→交付方接单→交付→验收放款,正常。
- [ ] **joiner 索引**:交付方接单后,**无需 localStorage**,刷新 Dashboard 即出现「我接的交付」(由 `getUserCommitments` 直接枚举)。

DUO 对赌新闭环:
- [ ] 「🎲 对赌」tab 创建对赌(事件问题 + 选 YES/NO + 押注额 + 截止日)→ 授权+createBet+fund 成功,跳 `/b/:id`。
- [ ] 发起方在 `/b/:id` 复制对手邀请链接;**对手**打开链接 → 等额 approve + joinCommitment 成功 → 状态进 `进行中`,双方各自 Dashboard 都能看到(creator + joiner 均已索引)。
- [ ] 到截止日:keeper 触发 `POST /resolve-bet/:id`(或手动 `curl -X POST <judge>/resolve-bet/<id>`)→ Judge `resolveEvent` 裁定 → `resolveBet` 上链 → 赢家拿走全部奖池 + 得 soulbound 勋章;`/b/:id` 显示裁定结果 / 赢家 / 裁判理由 / tx;`/bet-result/:id` 有记录。
- [ ] **安全网**:模拟 Judge 失联(不调 resolve),过 `endTime + 3 天宽限`后 `settle` → 各退各(本金原路退回双方),`/b/:id` 显示「裁判未裁定,已退款」。
- [ ] 铁律#3 复核:赢家恒为两固定方之一;合约无任何把资金转给第三方的路径。

---

## 5) 回滚 / 注意

- redeploy 不可回滚到旧地址的旧状态(旧承诺已作废)。若新合约有问题,只能修复后再 redeploy。
- 部署后务必重新给 demo 用的 Privy 嵌入式钱包铸 mUSD,否则前端无法立约。
- 别 burst SSH(触发 IP 封禁,见 §7);一次一连接或走 gist+console。

## 6) 完成定义(DoD)

- 三个新合约地址写入 4 个 env 并已上线;`forge test` 部署前全绿。
- 上面验收清单全部勾选(含 DUO 正常裁定 + 安全网退款两条路径)。
- `HANDOFF.md` §4 更新为新地址,§11 把 joiner 索引 / DUO 对赌从「待 redeploy」改为「已上线」。
