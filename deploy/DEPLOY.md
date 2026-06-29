# NinjaPact 部署指南 — www.limlamleen.com (Ubuntu + nginx + pm2)

架构：单域名 `www.limlamleen.com`
- `/`      → 前端静态 PWA（Vite build）
- `/api/*` → 反代到 Judge 服务（localhost:3001）
- Keeper   → 纯后台进程（pm2 守护，无对外端口）

> 变量约定：下文 `SERVER_IP` = 你服务器公网 IP，代码部署在 `/var/www/ninjapact`。

---

## 0. 前置：确认 DNS

在你**本地电脑**（不是服务器）执行，确认解析到服务器真实 IP：
```bash
dig +short www.limlamleen.com
```
必须返回你服务器的公网 IP。不对就先去 DNS 服务商把 A 记录指向服务器，等生效。

---

## 1. 服务器装环境（一次性）

SSH 上服务器后：
```bash
# Node 18+ (用 NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs nginx
sudo npm i -g pnpm pm2

# certbot (Let's Encrypt)
sudo apt-get install -y certbot python3-certbot-nginx
```

---

## 2. 把代码传上服务器

在你**本地电脑** NP 目录的上一级执行（排除 node_modules、dist、本地 dev env、合约部署私钥）：
```bash
rsync -avz \
  --exclude node_modules \
  --exclude 'frontend/dist' \
  --exclude 'frontend/.env.local' \
  --exclude contracts \
  --exclude '.git' \
  /Users/karl4chill/dev/NP/ root@SERVER_IP:/var/www/ninjapact/
```

说明：
- 排除 `frontend/.env.local`（本地用 localhost judge），构建只用 `.env.production`
- 排除 `contracts/`——部署私钥不该出现在 Web 服务器上
- **保留** `judge/.env` 和 `keeper/.env`（含 GLM key、Judge/Keeper 私钥，服务运行必需，rsync over SSH 是加密的）

---

## 3. 服务器上：构建前端 + 装服务依赖

```bash
cd /var/www/ninjapact

# 前端构建（产出 frontend/dist）
cd frontend && pnpm install && pnpm build && cd ..

# Judge + Keeper 依赖
cd judge  && npm install && cd ..
cd keeper && npm install && cd ..
```

---

## 4. 改 Judge 的 CORS 来源

编辑 `/var/www/ninjapact/judge/.env`，把 `FRONTEND_ORIGIN` 改成生产域名：
```
FRONTEND_ORIGIN=https://www.limlamleen.com
```
（CORS 已支持逗号分隔多来源，想同时留本地调试可写
`https://www.limlamleen.com,http://localhost:5173`）

---

## 5. nginx + HTTPS 证书

```bash
# 安装站点配置
sudo cp /var/www/ninjapact/deploy/nginx-ninjapact.conf /etc/nginx/sites-available/ninjapact
sudo ln -sf /etc/nginx/sites-available/ninjapact /etc/nginx/sites-enabled/ninjapact

# 确保 dist 可读
sudo chown -R www-data:www-data /var/www/ninjapact/frontend/dist

# 测试 + 重载
sudo nginx -t && sudo systemctl reload nginx

# 申请证书（certbot 会自动改写配置，加 443 + HTTP→HTTPS 跳转）
sudo certbot --nginx -d www.limlamleen.com

sudo systemctl reload nginx
```

---

## 6. 启动 Judge + Keeper（pm2 守护）

```bash
cd /var/www/ninjapact
pm2 start deploy/ecosystem.config.cjs
pm2 save
pm2 startup    # 按提示复制粘贴它输出的那行命令，开机自启

# 看日志确认
pm2 logs np-judge --lines 30   # 应看到 Judge address + INJ balance
pm2 logs np-keeper --lines 20  # 应看到 keeper tick
```

健康检查：
```bash
curl https://www.limlamleen.com/api/health
# {"ok":true,"judgeAddress":"0xfBA77..."}
```

---

## 7. Privy 后台加域名（关键，否则登录被拦）

登录 https://dashboard.privy.io → 选 App (`cmqespu1j02hd0ckyj6a8ykmk`)
→ Settings → Allowed origins / domains → 添加：
```
https://www.limlamleen.com
```
保存。

---

## 8. 手机测试清单

手机浏览器打开 `https://www.limlamleen.com`：
1. 社交/邮箱登录 → 嵌入式钱包生成
2. 给嵌入式钱包充 INJ（gas）+ 在 app 内领测试 mUSD
3. 立约 → approve + create + fund 三签
4. 打卡 → 首次签名认证 → **摄像头授权**（手机 HTTPS 下可用）→ 按指令拍照
5. GLM 裁决理由显示 → 链上确认
6. 「添加到主屏幕」装成 PWA

---

## 更新部署（以后改了代码）

```bash
# 本地：重新 rsync（同第 2 步命令）
# 服务器：
cd /var/www/ninjapact/frontend && pnpm build && cd ..
sudo systemctl reload nginx          # 前端是静态文件，reload 即可
pm2 restart np-judge np-keeper       # 后端服务重启
```

---

## 排错

| 现象 | 原因 / 处理 |
|---|---|
| 登录弹窗报错 / 白屏 | Privy 没加 `https://www.limlamleen.com`（第 7 步） |
| 打卡上传 413 | nginx body 限制——配置已设 `client_max_body_size 12m`，确认 reload 了 |
| `/api/health` 502 | Judge 没起来：`pm2 logs np-judge` 看错误（多半 INJ 余额或 .env） |
| 摄像头打不开 | 必须 HTTPS（证书没装好）；iOS 要先「添加到主屏幕」 |
| 裁决报 Chain write failed | Judge 钱包 INJ 不足，去水龙头充 |
| CORS 报错 | judge/.env 的 FRONTEND_ORIGIN 没设成 https 域名（第 4 步） |
