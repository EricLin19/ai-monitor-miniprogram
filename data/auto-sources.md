# AI Monitor 自动抓取口径

当前 `scripts/update-cache.js` 已经尽量把核心指标改成自动更新。

| 指标 | 自动来源 | 说明 |
| --- | --- | --- |
| OpenRouter token / 模型份额 | OpenRouter Datasets API | 需要 GitHub Secret `OPENROUTER_API_KEY` |
| 主流模型 API 价格指数 | OpenRouter Models API | 不需要 key；按 OpenAI、Anthropic、Google、DeepSeek 付费文本模型中位价计算 |
| GPU 租赁价格 | Vast.ai public offers API | 不需要 key；用 verified rentable offers 的 H100/H200/B200 单卡小时价做代理指标 |
| 单位 GPU 每日收入 | Vast.ai public offers API | 第一版用 H100 现货小时价 * 24 估算，不等同于云厂商真实毛利 |
| OpenAI / Anthropic ARR | Sacra company pages | 不需要 key；这是 Sacra estimates，不是公司官方财报 |
| Microsoft / Alphabet / Amazon / Meta CapEx | SEC companyconcept API | 免费；建议配置 `SEC_USER_AGENT` |

`data/manual-overrides.json` 仍然保留，但只作为兜底。里面的 `待填`、`手动`、`待建模` 等占位值不会覆盖自动抓取结果。
