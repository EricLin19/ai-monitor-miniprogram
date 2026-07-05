# AI Monitor 微信小程序 Demo

这是一个面向微信小程序的 AI 景气度监控 MVP。第一版目标是把 12 个核心指标的展示、刷新、数据源口径和云函数接入结构先跑通。

## 你需要先准备

1. 微信公众平台账号
   - 类型：小程序
   - 地址：https://mp.weixin.qq.com/
   - 拿到 `AppID`

2. 微信开发者工具
   - 地址：https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html
   - 导入本目录：`outputs/ai-monitor-miniprogram`

3. 云开发环境
   - 在微信开发者工具里打开“云开发”
   - 新建一个环境，复制环境 ID
   - 把环境 ID 填到 `miniprogram/app.js` 的 `env` 字段

4. 免费或低成本 API
   - OpenRouter：需要 API key，用于模型 token 用量和模型份额
   - Artificial Analysis：免费 API 需要账号和 API key，用于模型能力/价格/速度
   - Cloudflare Radar：优先用免费 Radar API，用于 AI crawler/bot 趋势
   - SEC EDGAR：免费、无需 key，但请求必须带合规 User-Agent
   - ARR 类媒体数据：OpenAI / Anthropic 暂时手动录入或半自动抓取

## 运行方式

1. 用微信开发者工具导入项目。
2. 修改 `project.config.json` 里的 `appid`。
3. 修改 `miniprogram/app.js` 里的云环境 ID。
4. 上传并部署云函数 `cloudfunctions/fetchMetrics`。
5. 编译运行。

如果云函数还没部署，前端会自动使用 mock 数据，方便先看 UI。

## 更新缓存数据

当前小程序默认读取本地缓存，避免每次打开都等待外部 API。更新缓存时，在项目根目录运行：

```bash
node scripts/update-cache.js
```

如果要更新 OpenRouter 指标，先在本机设置环境变量，或新建不会提交到 Git 的 `.env` 文件：

```env
OPENROUTER_API_KEY=你的 OpenRouter API key
SEC_USER_AGENT=AI Monitor Mini Program your-email@example.com
```

脚本会更新：

- `miniprogram/data/mockMetrics.js`
- `cloudfunctions/fetchMetrics/mockMetrics.js`
- `miniprogram/data/cacheMeta.js`

### 手动指标

没有稳定 API 的指标先填在：

```text
data/manual-overrides.json
```

适合手动维护：

- GPU 租赁价格
- 主流模型 API 价格指数
- Agent Token 占比
- 单位 GPU 每日收入
- OpenAI / Anthropic ARR 事件更新

改完 `manual-overrides.json` 后运行：

```bash
node scripts/update-cache.js
```

小程序会读到最新手动值。

### 自动更新

项目已加入 GitHub Actions：

```text
.github/workflows/update-cache.yml
```

它会每天自动运行一次 `node scripts/update-cache.js`，更新缓存并提交到仓库。你也可以在 GitHub 页面手动触发：

```text
Actions → Update AI monitor cache → Run workflow
```

需要在 GitHub 仓库配置 Secrets：

```text
OPENROUTER_API_KEY = 你的 OpenRouter API key
SEC_USER_AGENT = AI Monitor Mini Program your-email@example.com
```

配置位置：

```text
GitHub 仓库 → Settings → Secrets and variables → Actions → New repository secret
```

不能自动抓的数据仍然放在：

```text
data/manual-overrides.json
```

你把新的 ARR、GPU 租赁价格、Agent Token 占比等发给我，我来帮你改这个文件并提交。

## 12 个指标接入状态

| 指标 | 接入方式 | 是否尽量免费 |
| --- | --- | --- |
| OpenRouter weekly token 总量 | OpenRouter Datasets API | 需要 key，通常低成本 |
| OpenRouter Top 10 模型份额 | OpenRouter Datasets API | 需要 key，通常低成本 |
| Artificial Analysis 模型性价比 | Artificial Analysis free API | 免费 key |
| Cloudflare AI crawler traffic | Cloudflare Radar API | 免费 |
| Anthropic ARR / run-rate | 手动录入 + 来源链接 | 免费 |
| OpenAI ARR / run-rate | 手动录入 + 来源链接 | 免费 |
| Ramp 企业 AI 采用率 | 报告/页面更新 | 免费 |
| Microsoft CapEx | SEC companyfacts + IR | 免费 |
| Alphabet CapEx | SEC companyfacts + IR | 免费 |
| Amazon CapEx | SEC companyfacts + IR | 免费 |
| Meta CapEx | SEC companyfacts + IR | 免费 |
| NVIDIA data center revenue / guidance | SEC/IR，部分需手动口径 | 免费 |

## 不要把 API key 放在前端

小程序包会被下载到用户手机，前端里的 key 不安全。把 key 放在云函数环境变量里：

- `OPENROUTER_API_KEY`
- `ARTIFICIAL_ANALYSIS_API_KEY`
- `CLOUDFLARE_API_TOKEN`，如果 Radar API 需要认证
- `SEC_USER_AGENT`，例如 `yourname your@email.com`
