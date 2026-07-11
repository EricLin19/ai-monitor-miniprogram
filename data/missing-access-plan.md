# 待接入指标和你需要做的事

## 已经不需要额外权限

这些指标已经改成自动或模型计算：

| 指标 | 状态 | 数据源/口径 |
| --- | --- | --- |
| `token_price_elasticity` | 已自动 | OpenRouter token 历史 + API 价格指数 |
| `ai_capex_roi` | 已自动 | OpenAI/Anthropic ARR + Big 4 CapEx |
| `ai_crowding_unwind` | 已自动尝试 | Yahoo Finance chart API，失败时保留旧值 |

## 需要你申请/配置的 Secret

| 指标 | Secret 名称 | 去哪里弄 | 备注 |
| --- | --- | --- | --- |
| `aa_value` | `ARTIFICIAL_ANALYSIS_API_KEY` | Artificial Analysis API | 免费 key，但需要账号申请 |
| `cloudflare_ai_bots` | `CLOUDFLARE_API_TOKEN` | Cloudflare Dashboard -> API Tokens | 需要 Radar/Account Analytics 读权限 |
| `ramp_ai_adoption` | `RAMP_API_TOKEN` | Ramp Developer API 或 Ramp MCP | Ramp 企业付款数据通常需要账号/权限 |

把 Secret 加到 GitHub：

```text
GitHub repo -> Settings -> Secrets and variables -> Actions -> New repository secret
```

## 暂时仍然只能用框架/半自动

| 指标 | 原因 |
| --- | --- |
| `hbm_dram_pressure` | TrendForce/DRAMeXchange 通常是付费或新闻口径，暂无稳定免费 API |
| `agent_token_share` | OpenRouter 当前公开数据没有稳定的 agent 分类字段，需要 Fireworks/OpenRouter 后续披露或人工文章录入 |
| `nvda_dc_revenue` | NVIDIA Data Center segment 是财报/新闻稿口径，SEC XBRL 不稳定提供分部历史 |
| `ai_hardware_heat` / `ai_downstream_odds` | 这是策略框架指标，不是单一 API 数据 |
