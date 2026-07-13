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
| LLM Token 支出指数 / 前沿溢价 / 免费占比 | TrakToken Spend Index | 不需要 key；TTSI 使用 OpenRouter Top50 用量加权价格，input/output mix 为 80/20，数据 CC BY 4.0 |
| 云厂商 CapEx / 经营现金流 | SEC companyconcept API | 不需要 key；第一版使用 Microsoft、Alphabet、Amazon、Meta、Oracle 年度 CapEx / OCF |
| Token / ARR 商业化效率 | OpenRouter + Sacra estimates | 不需要新 key；用 OpenAI + Anthropic ARR 除以 OpenRouter 年化 token 用量 |
| AI 暴露工资池覆盖率 | 国金宏观文章口径 + Sacra estimates | 不需要新 key；用 $1.45T 实际暴露薪资池和 $5.68T 理论薪资池做分母 |
| 软件开发岗位招聘指数 | FRED / Indeed Hiring Lab | 不需要 key；日频 7 日均值，2020-02-01=100 |

`data/manual-overrides.json` 仍然保留，但只作为兜底。里面的 `待填`、`手动`、`待建模` 等占位值不会覆盖自动抓取结果。

## 中金四层监测框架映射

中金《如何监测AI泡沫?》把泡沫监测分成四层：需求、现金流、资金来源、外部约束。当前小程序的对应关系：

| 层级 | 已接入指标 | 后续可补 |
| --- | --- | --- |
| 需求和收入 | OpenRouter token、TTSI、前沿溢价、免费 Token 占比、API 价格指数、Token / ARR 商业化效率 | 中国模型 token 份额、美元支出份额、付费企业比例 |
| 商业化与现金流 | OpenAI / Anthropic ARR、AI CapEx ROI 覆盖率、云厂商 CapEx / 经营现金流 | 模型公司毛利率、自由现金流转正时间、云收入增量 |
| 资金来源 | CapEx、GPU 租赁价格、单位 GPU 每日收入 | 云厂商信用债发行、CDS、AI 私募融资集中度、IPO 管线 |
| 外部约束 | 软件开发岗位招聘指数、AI 暴露工资池覆盖率 | 数据中心取消/延期、电力并网等待、AI 税/分红/监管事件 |

## 历史回填口径

`scripts/backfill-history.js` 用来补历史数据，并已接入 GitHub Actions：

| 指标 | 回填窗口 | 回填方式 |
| --- | --- | --- |
| OpenRouter token | 近 90 天 | OpenRouter `rankings-daily`，按每日滚动 7 天 token 合计计算 |
| OpenRouter Top10 份额 | 近 90 天 | OpenRouter `rankings-daily`，按每日滚动 7 天 Top10 模型集中度计算 |
| LLM Token 支出指数 | 近 100 天 | TrakToken `/api/index/history`，取 7 日均线支出价格 |
| 前沿模型价格溢价 | 近 100 天 | TrakToken `/api/index/history`，frontier / open-weight |
| 免费 Token 占比 | 近 100 天 | TrakToken `/downloads/ttsi.csv`，free_share |
| Microsoft / Alphabet / Amazon / Meta CapEx | 最近 6 个季度 | SEC companyconcept；若披露为年初至今累计值，则自动拆成单季度值 |
| 软件开发岗位招聘指数 | 近 100 天 | FRED CSV，直接拉取 `IHLIDXUSTPSOFTDEVE` |
| Token / ARR 商业化效率 | 近 90 天 | 用 OpenRouter token 历史和最近一次 ARR 事件口径派生 |
| AI 暴露工资池覆盖率 | ARR 事件点 | 用 OpenAI / Anthropic ARR 历史事件点派生 |

暂时不能可靠回填历史的指标：

| 指标 | 原因 |
| --- | --- |
| GPU 租赁价格 | Vast.ai 当前公开接口是现货报价，没有稳定历史价格接口 |
| 主流模型 API 价格指数 | OpenRouter models API 返回当前价格，没有官方历史价格序列 |
| OpenAI / Anthropic ARR | Sacra 页面是当前估算/事件口径，没有稳定可机读的完整历史序列 |
| Revenue per GPU | 由当前 GPU 现货价格代理计算，历史依赖 GPU 租赁价格历史 |
