# 口袋账本（有鱼记账风格）

一个纯前端记账 Web App，参考「有鱼记账」的交互，数据通过 **Supabase** 实时同步，代码托管在 **GitHub**（可一键部署到 GitHub Pages）。

- 📒 单一账本（默认账本，专注记账本身）
- 💰 资产：银行存款 / 现金 / 支付宝 / 微信，点击可改余额、看总资产
- 🏷️ 收支分类（自带常用分类，可自定义）
- ＋ 一键记一笔（金额 / 分类 / 日期 / 备注）
- 📊 统计：支出构成环形图、分类排行、月度结余、预算进度
- 🔄 **实时同步**：一处记账，所有设备（同一 Supabase 配置）秒级更新
- 💾 未配置 Supabase 时自动用浏览器本地存储，照常使用

> 架构说明：
> - **代码 → GitHub**：本仓库就是 App 本身（纯静态文件，无需后端构建）。
> - **实时数据 → Supabase**：记账数据存在你的 Supabase 项目里，前端直连，多端实时同步。
> - GitHub 不存放你的记账数据，只存放 App 代码。

---

## 一、本地预览（无需任何配置）

直接用浏览器打开 `index.html` 即可，或用任意静态服务器：

```bash
# 在项目目录执行
python3 -m http.server 8080
# 然后浏览器访问 http://localhost:8080
```

此时为「本地存储模式」，数据只存在当前浏览器，方便你先体验与审核。

---

## 二、接入 Supabase（实现实时同步）

你已有 Supabase 账号，按下面 4 步操作即可，**全程在网页界面点一点**：

### 1. 新建项目
登录 https://supabase.com → New Project → 填名字、设密码、选地区 → Create。

### 2. 建表 + 开实时
进入项目 → 左侧 **SQL Editor** → **New query** →
把本仓库 `sql/schema.sql` 的**全部内容**粘贴进去 → 点 **Run**。

这会建好 4 张表（ledgers / categories / transactions / budgets），
配置好匿名访问权限，并把它们加入 Realtime 发布（实时同步的关键）。

### 3. 拿到连接信息
进入项目 → 左侧 **Project Settings → API**：
- `Project URL` → 复制，形如 `https://xxxx.supabase.co`
- `anon public` 那个 **key**（Project API keys 里的 Publishable key）→ 复制

> ⚠️ 用 `anon` 公开密钥即可，它本来就是给前端用的；本应用是个人记账、已对匿名开放读写。
> 若日后要多人隔离数据，再改成基于登录账号的 RLS 策略。

### 4. 在 App 里填好
打开 App → 右下「我的」→ **Supabase 设置** →
粘贴 URL 和 Anon Key → 点「连接并保存」。

连接成功顶部会显示「● 已连接 Supabase 实时同步」。
此后：A 设备记一笔，B 设备（同样填了这段配置）立刻刷新。

> 提示：每个浏览器/设备只需填一次；配置存在该浏览器本地，不会进 GitHub。

---

## 三、把代码传到 GitHub

1. 在 GitHub 新建一个**公开**仓库，例如 `xiaoyu-jizhang`。
2. 本地初始化并提交（在项目根目录）：
   ```bash
   git init
   git add .
   git commit -m "feat: 口袋账本 App 初版"
   git branch -M main
   git remote add origin https://github.com/<你的用户名>/<仓库名>.git
   git push -u origin main
   ```
3. 开启 GitHub Pages：仓库 **Settings → Pages → Source 选 `main` / root → Save**。
   几分钟后访问 `https://<用户名>.github.io/<仓库名>/` 即可在线使用。

（如需我帮你执行上面的 git 推送，请在「审核通过」后告诉我。）

---

## 四、目录结构

```
index.html          页面骨架
style.css           样式
config.js          默认 Supabase 配置（可留空，改用 App 内设置页填写）
store.js           数据层：本地 / Supabase 双后端 + 实时订阅
seed.js            默认账本与分类种子数据
app.js             页面渲染与交互
schema.sql         Supabase 表结构 / 权限 / 实时发布
```

---

## 五、常见问题

- **连不上 Supabase？** 检查 URL 末尾有没有多余斜杠、key 是否完整；确认 `schema.sql` 已完整执行。
- **数据没实时刷新？** 确认 SQL 里的 Realtime 发布步骤已执行（App 内状态应为「实时同步中」）。
- **想改分类 / 预算 / 资产？** 「我的」页面里都能管理；资产在底部「资产」页直接点改。
- **隐私？** 配置用 `anon` key，数据在你自己的 Supabase 项目里，别人看不到（除非你分享项目）。
