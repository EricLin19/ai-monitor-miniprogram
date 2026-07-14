const fs = require("fs");
const path = require("path");
const https = require("https");

const rootDir = path.resolve(__dirname, "..");
const miniMetricsPath = path.join(rootDir, "miniprogram", "data", "mockMetrics.js");
const cloudMetricsPath = path.join(rootDir, "cloudfunctions", "fetchMetrics", "mockMetrics.js");
const miniMetaPath = path.join(rootDir, "miniprogram", "data", "cacheMeta.js");
const miniHistoryPath = path.join(rootDir, "miniprogram", "data", "metricHistory.js");
const publicCachePath = path.join(rootDir, "public", "ai-monitor-cache.json");
const manualOverridesPath = path.join(rootDir, "data", "manual-overrides.json");
const rampDir = path.join(rootDir, "data", "ramp");

const CICC_CORE_META = {
  aa_us_score: { group: "① 需求", title: "能力供给：美国前沿模型评分", unit: "分", change: "环比 7% / 同比 82%", cadence: "月/季", access: "半自动", source: "Artificial Analysis / 中金整理", note: "前沿模型评分衡量最强模型能力供给。美国分数上行，说明头部模型能力仍在推进，是需求和商业化继续扩张的基础。" },
  aa_cn_score: { group: "① 需求", title: "能力供给：中国前沿模型评分", unit: "分", change: "环比 11% / 同比 155%", cadence: "月/季", access: "半自动", source: "Artificial Analysis / 中金整理", note: "中国前沿模型评分反映国产模型能力追赶速度，也会影响中国模型在 OpenRouter 等平台的调用份额。" },
  openrouter_us_tokens: { group: "① 需求", title: "真实调用：OpenRouter 美国模型日度 Token 使用量", unit: "万亿/日", change: "环比 -3% / 同比 823%", cadence: "日/周", access: "自动", source: "OpenRouter Datasets API / 中金整理", note: "按 OpenRouter 模型提供方归类估算美国模型日均 token 调用量。它不是全球总量，但能观察真实调用需求的方向变化。" },
  openrouter_cn_tokens: { group: "① 需求", title: "真实调用：OpenRouter 中国模型日度 Token 使用量", unit: "万亿/日", change: "环比 30% / 同比 6946%", cadence: "日/周", access: "自动", source: "OpenRouter Datasets API / 中金整理", note: "按 DeepSeek、Qwen、Kimi、MiniMax、智谱等模型归类估算中国模型日均 token 调用量，用来观察低成本模型扩散速度。" },
  silicon_token_expenditure: { group: "① 需求", title: "使用成本：LLM token 支出指数", unit: "美元/百万 token", change: "环比 -6% / 同比 32%", cadence: "日/周", access: "半自动", source: "Silicon Data / 中金整理", note: "跟踪单位 token 的支出成本。成本下降有利于应用放量，但也会压缩高价模型和上游算力的定价权。" },
  llm_token_spend_index: { group: "① 需求", title: "使用成本：使用量加权 LLM token 支出指数", cadence: "日", access: "自动" },
  ramp_enterprise_paid_ratio: { group: "① 需求", title: "渗透质量：美国企业模型付费比例", unit: "企业付费比例", change: "环比 2% / 同比 29%", cadence: "月/季", access: "半自动", source: "Ramp AI Index / 中金整理", note: "企业付费比例衡量 AI 从试用走向预算化采购的程度，是比单纯用户数更接近商业质量的指标。" },
  openai_app_revenue: { group: "② 现金流", title: "应用端：OpenAI iOS 和 Google Play 月均用户收入", unit: "美元/用户/月", change: "环比 3% / 同比 45%", cadence: "月", access: "半自动", source: "Sensor Tower / 中金整理", note: "移动端月均用户收入观察 OpenAI 的 C 端付费质量，能辅助判断 ChatGPT 订阅是否继续提价或提渗透。" },
  anthropic_app_revenue: { group: "② 现金流", title: "应用端：Anthropic iOS 和 Google Play 月均用户收入", unit: "美元/用户/月", change: "环比 -2% / 同比 475%", cadence: "月", access: "半自动", source: "Sensor Tower / 中金整理", note: "移动端月均用户收入观察 Anthropic 的 C 端变现能力，也能反映 Claude 在付费用户中的渗透质量。" },
  openai_arr: { group: "② 现金流", title: "应用端：OpenAI 年化经常性收入 ARR", cadence: "事件/月", access: "自动" },
  anthropic_arr: { group: "② 现金流", title: "应用端：Anthropic 年化经常性收入 ARR", cadence: "事件/月", access: "自动" },
  hyperscaler_cloud_revenue: { group: "② 现金流", title: "云厂商：微软、谷歌、亚马逊和甲骨文云收入", unit: "十亿美元", change: "环比 7% / 同比 36%", cadence: "季", access: "半自动", source: "公司财报 / 中金整理", note: "云收入验证 AI 资本开支能否转化为收入，是从算力投入走向现金流兑现的核心指标。" },
  hyperscaler_fcf: { group: "② 现金流", title: "云厂商：Big 5 自由现金流", unit: "十亿美元", change: "环比 -81% / 同比 -78%", cadence: "季", access: "半自动" },
  hyperscaler_capex_ocf_ratio: { group: "② 现金流", title: "云厂商：Big 5 资本开支 vs. 经营性现金流", unit: "CapEx / OCF", change: "环比 22% / 同比 29%", cadence: "季", access: "半自动" },
  big5_debt_equity_ratio: { group: "③ 资金来源", title: "存量杠杆：Big 5 负债权益比", unit: "Big 5 负债权益比", change: "环比 4% / 同比 6%", cadence: "季/年", access: "半自动" },
  big5_bond_issuance: { group: "③ 资金来源", title: "外部融资：Big 5 企业债新增发行规模", unit: "十亿美元", change: "环比 0% / 同比 39%", cadence: "月/季", access: "半自动", source: "Bloomberg / 中金整理", note: "企业债新增发行规模观察 AI 投资是否开始更多依赖外部融资。发行放大时，利率和信用环境的重要性会上升。" },
  big5_cds: { group: "③ 资金来源", title: "外部融资：Big 5 信用违约互换 CDS", unit: "bp", change: "环比 +4.8 / 同比 +58.1", cadence: "日/周", access: "半自动", source: "Bloomberg / 中金整理", note: "CDS 反映市场对云厂商信用风险的定价。CDS 上行说明外部融资约束正在变强。" },
  ig_credit_spread: { group: "③ 资金来源", title: "外部融资：美国投资级信用债利差", cadence: "日", access: "自动" },
  silicon_vc_confidence: { group: "③ 资金来源", title: "风险投资：硅谷 VC 信心指数", unit: "分", change: "环比 -6% / 同比 5%", cadence: "季", access: "半自动", source: "Silicon Valley Venture Capitalist Confidence Index / 中金整理", note: "VC 信心指数衡量一级市场风险偏好，对 AI 创业融资和估值锚有领先意义。" },
  ai_risk_investment: { group: "③ 资金来源", title: "风险投资：AI 风险投资额", unit: "十亿美元", change: "环比 268% / 同比 404%", cadence: "季", access: "半自动", source: "PitchBook / 中金整理", note: "AI 风险投资额观察一级市场资金是否继续涌入。若投资额放缓，应用层和模型公司的融资节奏会承压。" },
  tech_finance_employment: { group: "④ 外部约束", title: "就业冲击：美国科技和金融就业人数", unit: "万人", change: "环比 -0.3 / 同比 -21.6", cadence: "月", access: "半自动", source: "BLS / 中金整理", note: "科技和金融就业人数用于观察 AI 自动化是否开始形成就业冲击。就业压力上升可能引发监管和政治约束。" },
  tech_finance_layoff_share: { group: "④ 外部约束", title: "就业冲击：科技和金融行业裁员人数占比 3mma", unit: "%", change: "环比 0% / 同比 25%", cadence: "月", access: "半自动", source: "Layoffs.fyi / 中金整理", note: "科技和金融裁员占比观察 AI 替代叙事是否在就业层面扩散，是监管风险和社会反馈的重要代理指标。" },
  data_center_construction: { group: "④ 外部约束", title: "数据中心：美国数据中心年化建筑额", unit: "十亿美元", change: "环比 1% / 同比 23%", cadence: "月", access: "半自动", source: "US Census / 中金整理", note: "数据中心建筑额衡量电力、土地、施工等物理约束。若建设放缓，算力供给和云扩张都会受限。" }
};

const EXTRA_METRIC_TEMPLATES = [
  { id: "orcl_capex", group: "③ CapEx", title: "Oracle CapEx", value: "待更新", unit: "季度", change: "SEC", trend: "flat", cadence: "季", access: "自动", source: "SEC Company Facts API", sourceUrl: "https://www.sec.gov/edgar/sec-api-documentation", note: "Oracle 资本开支，和 Microsoft、Alphabet、Amazon、Meta 一起观察云厂商 AI 基建投入强度。" },
  { id: "ramp_ai_adoption", group: "① 需求", title: "Ramp AI Index：企业 AI 采用率", value: "待更新", unit: "%", change: "Ramp CSV", trend: "flat", cadence: "月", access: "本地CSV", source: "Ramp AI Index CSV", sourceUrl: "https://ramp.com/data/ai-index", note: "Ramp 基于企业支出数据观察 AI 工具采用率，更接近企业预算化采购，而不是普通用户热度。" },
  { id: "ramp_sector_technology_media", group: "① 需求", title: "Ramp：科技与媒体行业 AI 采用率", value: "待更新", unit: "%", change: "Ramp CSV", trend: "flat", cadence: "月", access: "本地CSV", source: "Ramp AI Index CSV", sourceUrl: "https://ramp.com/data/ai-index", note: "科技与媒体行业通常是 AI 工具最先渗透的企业样本，用来观察早期采用者是否继续加速。" },
  { id: "ramp_sector_finance_insurance", group: "① 需求", title: "Ramp：金融保险行业 AI 采用率", value: "待更新", unit: "%", change: "Ramp CSV", trend: "flat", cadence: "月", access: "本地CSV", source: "Ramp AI Index CSV", sourceUrl: "https://ramp.com/data/ai-index", note: "金融保险行业采用率能观察 AI 从科技圈向严肃企业预算扩散的速度。" },
  { id: "ramp_model_openai", group: "① 需求", title: "Ramp：OpenAI 企业支出份额", value: "待更新", unit: "%", change: "Ramp CSV", trend: "flat", cadence: "月", access: "本地CSV", source: "Ramp AI Index CSV", sourceUrl: "https://ramp.com/data/ai-index", note: "OpenAI 在 Ramp 企业 AI 支出样本中的份额，观察企业端模型选择是否继续集中。" },
  { id: "ramp_model_anthropic", group: "① 需求", title: "Ramp：Anthropic 企业支出份额", value: "待更新", unit: "%", change: "Ramp CSV", trend: "flat", cadence: "月", access: "本地CSV", source: "Ramp AI Index CSV", sourceUrl: "https://ramp.com/data/ai-index", note: "Anthropic 在 Ramp 企业 AI 支出样本中的份额，观察 Claude 在企业和 coding 场景的商业化渗透。" },
  { id: "ramp_model_google", group: "① 需求", title: "Ramp：Google 企业支出份额", value: "待更新", unit: "%", change: "Ramp CSV", trend: "flat", cadence: "月", access: "本地CSV", source: "Ramp AI Index CSV", sourceUrl: "https://ramp.com/data/ai-index", note: "Google 模型在 Ramp 企业 AI 支出样本中的份额，观察 Gemini 企业端渗透。" },
  { id: "ramp_model_deepseek", group: "① 需求", title: "Ramp：DeepSeek 企业支出份额", value: "待更新", unit: "%", change: "Ramp CSV", trend: "flat", cadence: "月", access: "本地CSV", source: "Ramp AI Index CSV", sourceUrl: "https://ramp.com/data/ai-index", note: "DeepSeek 在 Ramp 企业 AI 支出样本中的份额，观察低成本模型是否进入海外企业预算。" },
  { id: "ramp_model_xai", group: "① 需求", title: "Ramp：xAI 企业支出份额", value: "待更新", unit: "%", change: "Ramp CSV", trend: "flat", cadence: "月", access: "本地CSV", source: "Ramp AI Index CSV", sourceUrl: "https://ramp.com/data/ai-index", note: "xAI 在 Ramp 企业 AI 支出样本中的份额，观察新模型供给方的企业端突破。" }
];

loadDotEnv(path.join(rootDir, ".env"));

async function main() {
  const current = ensureMetricTemplates(require(miniMetricsPath).metrics);
  const currentById = Object.fromEntries(current.map((item) => [item.id, item]));
  const existingHistory = readHistory();
  const updates = {};

  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (openRouterKey) {
    try {
      Object.assign(updates, await fetchOpenRouterUsage(openRouterKey));
    } catch (error) {
      console.warn(`OpenRouter usage update failed: ${error.message}`);
    }
  } else {
    console.warn("OPENROUTER_API_KEY is not set. Keeping OpenRouter usage cache unchanged.");
  }

  await mergeUpdate(updates, fetchTrakTokenIndex(), "TrakToken spend index");
  await mergeUpdate(updates, fetchRampAiIndex(), "Ramp AI Index");
  await mergeUpdate(updates, fetchOpenRouterModelPricing(), "OpenRouter model pricing");
  await mergeUpdate(updates, fetchVastGpuRentalPrices(), "Vast GPU rental prices");
  await mergeUpdate(updates, fetchSacraArrSignals(), "Sacra ARR signals");
  await mergeUpdate(updates, fetchSecCapex(), "SEC capex");
  await mergeUpdate(updates, fetchCiccCashFlowSnapshot(), "CICC hyperscaler cash flow snapshot");
  await mergeUpdate(updates, fetchCiccFundingSnapshot(), "CICC funding snapshot");
  await mergeUpdate(updates, fetchFredTechJobPostings(), "FRED tech job postings");
  await mergeUpdate(updates, fetchFredInvestmentGradeSpread(), "FRED investment grade spread");
  await mergeUpdate(updates, fetchCrowdingUnwind(), "AI crowding unwind");

  // Manual overrides are now only a fallback for real user-provided values.
  // Placeholder values such as "寰呭～" are ignored so they do not erase auto data.
  Object.assign(updates, readManualOverrides());

  const next = current.map((item) => ({
    ...item,
    ...(updates[item.id] || fallbackFailureNote(currentById[item.id], updates[item.id]))
  }));
  Object.assign(updates, buildDerivedMetricUpdates(next, existingHistory));
  const finalNext = next.map((item) => ({
    ...normalizeCiccMetricMetadata(item),
    ...(updates[item.id] || {})
  }));

  const updatedAt = formatTime(new Date());
  const history = updateHistory(existingHistory, finalNext, updatedAt);
  writeMetrics(miniMetricsPath, finalNext);
  writeMetrics(cloudMetricsPath, finalNext);
  writeMeta(miniMetaPath, updatedAt);
  writeHistory(miniHistoryPath, history);
  writePublicCache(publicCachePath, {
    metrics: finalNext,
    history,
    updatedAt,
    source: "github-actions-cache"
  });

  console.log(JSON.stringify({
    updatedAt,
    updatedIds: Object.keys(updates),
    output: [
      path.relative(rootDir, miniMetricsPath),
      path.relative(rootDir, cloudMetricsPath),
      path.relative(rootDir, miniMetaPath),
      path.relative(rootDir, miniHistoryPath),
      path.relative(rootDir, publicCachePath)
    ]
  }, null, 2));
}

async function mergeUpdate(updates, promise, label) {
  try {
    Object.assign(updates, await promise);
  } catch (error) {
    console.warn(`${label} update failed: ${error.message}`);
  }
}

function readManualOverrides() {
  if (!fs.existsSync(manualOverridesPath)) return {};
  const raw = fs.readFileSync(manualOverridesPath, "utf8");
  const parsed = JSON.parse(raw);
  const placeholders = new Set(["待填", "待接入", "手动", "待建模", "报告", "季报", ""]);

  return Object.fromEntries(Object.entries(parsed).filter(([, value]) => {
    if (!value || typeof value !== "object") return false;
    return !placeholders.has(String(value.value || "").trim());
  }));
}

function ensureMetricTemplates(metrics) {
  const existingIds = new Set(metrics.map((item) => item.id));
  const missing = EXTRA_METRIC_TEMPLATES.filter((item) => !existingIds.has(item.id));
  return [...metrics, ...missing];
}

function normalizeCiccMetricMetadata(item) {
  const meta = CICC_CORE_META[item.id];
  return meta ? { ...item, ...meta } : item;
}

async function fetchOpenRouterUsage(key) {
  const endDate = formatDate(addDays(new Date(), -1));
  const startDate = formatDate(addDays(new Date(), -7));
  const url = `https://openrouter.ai/api/v1/datasets/rankings-daily?start_date=${startDate}&end_date=${endDate}`;
  const payload = await getJson(url, {
    Authorization: `Bearer ${key}`
  });

  const rows = Array.isArray(payload.data) ? payload.data : [];
  if (!rows.length) return {};

  const totalTokens = rows.reduce((sum, row) => sum + Number(row.total_tokens || 0), 0);
  const byModel = new Map();
  const byProvider = new Map();
  const byCountryDate = new Map();

  for (const row of rows) {
    const model = row.model_permaslug || "unknown";
    const provider = model.includes("/") ? model.split("/")[0] : "unknown";
    const tokens = Number(row.total_tokens || 0);
    const date = getRowDate(row);
    const country = getProviderCountry(provider);
    byModel.set(model, (byModel.get(model) || 0) + tokens);
    byProvider.set(provider, (byProvider.get(provider) || 0) + tokens);
    if (date && country) {
      const key = `${country}|${date}`;
      byCountryDate.set(key, (byCountryDate.get(key) || 0) + tokens);
    }
  }

  const topModels = [...byModel.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  const topShare = topModels.reduce((sum, item) => sum + item[1], 0) / Math.max(1, totalTokens);
  const anthropicShare = (byProvider.get("anthropic") || 0) / Math.max(1, totalTokens);

  const usDaily = averageCountryDailyTokens(byCountryDate, "us");
  const cnDaily = averageCountryDailyTokens(byCountryDate, "cn");
  const updates = {
    openrouter_tokens: {
      value: formatLargeToken(totalTokens),
      unit: "7d",
      change: `${startDate} to ${endDate}`,
      access: "自动",
      note: "OpenRouter 平台口径，观察跨模型开发者调用需求，不代表全球 token 总量。"
    },
    openrouter_share: {
      value: `${Math.round(topShare * 100)}%`,
      unit: "Top10",
      change: `Anthropic ${round1(anthropicShare * 100)}%`,
      access: "自动",
      note: `Top10 模型集中度；第一模型：${topModels[0] ? topModels[0][0] : "N/A"}。`
    }
  };

  if (usDaily > 0) {
    updates.openrouter_us_tokens = {
      value: formatTrillion(usDaily),
      unit: "万亿/日",
      change: `${startDate} to ${endDate}`,
      trend: "flat",
      access: "自动",
      source: "OpenRouter Datasets API",
      sourceUrl: "https://openrouter.ai/data",
      note: "按 OpenRouter 模型提供方归类估算美国模型日均 token 调用量。该口径只代表 OpenRouter，不等同全球总量。"
    };
  }
  if (cnDaily > 0) {
    updates.openrouter_cn_tokens = {
      value: formatTrillion(cnDaily),
      unit: "万亿/日",
      change: `${startDate} to ${endDate}`,
      trend: "up",
      access: "自动",
      source: "OpenRouter Datasets API",
      sourceUrl: "https://openrouter.ai/data",
      note: "按 DeepSeek、Qwen、Kimi、MiniMax、智谱等模型归类估算中国模型日均 token 调用量。"
    };
  }

  return updates;
}

async function fetchTrakTokenIndex() {
  const payload = await getJsonFetch("https://www.traktoken.com/api/index/history", {
    "User-Agent": "AI Monitor Mini Program"
  });
  const rows = Array.isArray(payload.data) ? payload.data : [];
  if (!rows.length) return {};
  const csvRows = await fetchTrakTokenCsvRows();

  const latest = rows[rows.length - 1];
  const latestCsv = csvRows[csvRows.length - 1] || {};
  const previous = rows[Math.max(0, rows.length - 29)];
  const price = Number(latest.spend_price_usd_ma7 || latest.spend_price_usd);
  const ttsi = Number(latest.ttsi_ma7 || latest.ttsi);
  const previousPrice = previous ? Number(previous.spend_price_usd_ma7 || previous.spend_price_usd) : NaN;
  const change = Number.isFinite(previousPrice) ? pctChange(previousPrice, price) : 0;
  const frontierPrice = Number(latest.spend_price_f_usd_ma7 || latest.spend_price_f_usd);
  const openWeightPrice = Number(latest.spend_price_o_usd_ma7 || latest.spend_price_o_usd);
  const freeShare = Number(latestCsv.free_share);
  const premium = Number(latest.frontier_premium);

  const updates = {
    llm_token_spend_index: {
      value: formatUsd(price),
      unit: "$/1M weighted",
      change: `TTSI ${round1(ttsi)} / 28d ${round1(change)}%`,
      trend: change > 3 ? "up" : change < -3 ? "down" : "flat",
      access: "自动",
      source: "TrakToken Spend Index",
      sourceUrl: "https://www.traktoken.com/spend-index",
      note: "TTSI 是 OpenRouter Top50 模型用量加权价格指数，混合价格采用 input 80% + output 20%，更贴近 coding agent 场景。"
    },
    frontier_premium: {
      value: `${round1(premium)}x`,
      unit: "frontier / open-weight",
      change: `frontier ${formatUsd(frontierPrice)} / open-weight ${formatUsd(openWeightPrice)}`,
      trend: premium > 8 ? "up" : premium < 4 ? "down" : "flat",
      access: "自动",
      source: "TrakToken Spend Index",
      sourceUrl: "https://www.traktoken.com/spend-index",
      note: "前沿闭源模型相对开源权重模型的用量加权价格溢价。溢价扩大说明高价值任务仍留在前沿模型；溢价收敛说明低成本模型替代压力增强。"
    }
  };

  if (Number.isFinite(freeShare)) {
    updates.free_token_share = {
      value: `${round1(freeShare * 100)}%`,
      unit: "free token share",
      change: `basket ${latestCsv.basket_size || rows.length} models`,
      trend: freeShare > 0.15 ? "down" : "up",
      access: "自动",
      source: "TrakToken Spend Index",
      sourceUrl: "https://www.traktoken.com/spend-index",
      note: "TTSI 篮子里的免费 token 用量占比。若免费占比下降而总支出上升，说明付费意愿没有塌，更多是量补价和结构迁移。"
    };
  }

  return updates;
}

function fetchRampAiIndex() {
  const headlinePath = path.join(rampDir, "ramp-ai-index-headline.csv");
  const sectorPath = path.join(rampDir, "ramp-ai-index-sector.csv");
  const modelPath = path.join(rampDir, "ramp-ai-index-models.csv");
  if (!fs.existsSync(headlinePath)) return {};

  const rows = parseCsvRows(fs.readFileSync(headlinePath, "utf8"))
    .filter((row) => row.series === "Ramp AI Index")
    .filter((row) => Number.isFinite(Number(row.adoption_rate_pct)))
    .sort((a, b) => String(a.date_month).localeCompare(String(b.date_month)));
  if (!rows.length) return {};

  const updates = {};
  const latest = rows[rows.length - 1];
  const headlineCard = rampCurrentCard(latest, "企业采用率", "Ramp AI Index 基于企业支出数据观察美国企业 AI 工具采用率。它更接近企业预算化采购，而不是普通用户热度。");
  updates.ramp_enterprise_paid_ratio = headlineCard;
  updates.ramp_ai_adoption = {
    ...headlineCard,
    unit: "enterprise adoption",
    note: "Ramp AI Index headline series."
  };

  if (fs.existsSync(sectorPath)) {
    const sectorRows = parseCsvRows(fs.readFileSync(sectorPath, "utf8"));
    const sectorMap = {
      ramp_sector_technology_media: "Technology and media",
      ramp_sector_finance_insurance: "Finance and insurance"
    };
    for (const [id, sector] of Object.entries(sectorMap)) {
      const record = latestRampRow(sectorRows, (row) => row.sector === sector);
      if (record) updates[id] = rampCurrentCard(record, sector, `${sector} sector adoption rate from Ramp AI Index CSV.`);
    }
  }

  if (fs.existsSync(modelPath)) {
    const modelRows = parseCsvRows(fs.readFileSync(modelPath, "utf8"));
    const modelMap = {
      ramp_model_openai: "OpenAI",
      ramp_model_anthropic: "Anthropic",
      ramp_model_google: "Google",
      ramp_model_deepseek: "DeepSeek",
      ramp_model_xai: "xAI"
    };
    for (const [id, company] of Object.entries(modelMap)) {
      const record = latestRampRow(modelRows, (row) => row.model_company === company);
      if (record) updates[id] = rampCurrentCard(record, company, `${company} share/adoption series from Ramp AI Index model-company CSV.`);
    }
  }

  return updates;
}

function latestRampRow(rows, predicate) {
  const filtered = rows
    .filter(predicate)
    .filter((row) => Number.isFinite(Number(row.adoption_rate_pct)))
    .sort((a, b) => String(a.date_month).localeCompare(String(b.date_month)));
  return filtered[filtered.length - 1] || null;
}

function rampCurrentCard(row, unit, note) {
  const value = Number(row.adoption_rate_pct);
  const mom = Number(row.mom_change_pp);
  const yoy = Number(row.yoy_change_pp);
  const changeParts = [];
  if (Number.isFinite(mom)) changeParts.push(`环比 ${round1(mom)}ppt`);
  if (Number.isFinite(yoy)) changeParts.push(`同比 ${round1(yoy)}ppt`);
  return {
    value: `${round1(value)}%`,
    unit,
    change: changeParts.join(" / ") || row.date_month,
    trend: Number.isFinite(mom) ? (mom > 0 ? "up" : mom < 0 ? "down" : "flat") : "flat",
    access: "本地CSV",
    source: "Ramp AI Index CSV",
    sourceUrl: "https://ramp.com/data/ai-index",
    note
  };
}

async function fetchTrakTokenCsvRows() {
  const csv = await getTextFetch("https://www.traktoken.com/downloads/ttsi.csv", {
    "User-Agent": "AI Monitor Mini Program"
  });
  return parseCsvRows(csv).filter((row) => row.date);
}

async function fetchOpenRouterModelPricing() {
  const payload = await getJson("https://openrouter.ai/api/v1/models");
  const rows = Array.isArray(payload.data) ? payload.data : [];
  const providers = ["openai", "anthropic", "google", "deepseek"];
  const providerMedians = [];
  const details = [];

  for (const provider of providers) {
    const prices = rows
      .filter((model) => {
        const id = String(model.id || "");
        const modality = model.architecture && model.architecture.modality;
        const prompt = Number(model.pricing && model.pricing.prompt);
        const completion = Number(model.pricing && model.pricing.completion);
        return id.startsWith(`${provider}/`)
          && String(modality || "").includes("->text")
          && Number.isFinite(prompt)
          && Number.isFinite(completion)
          && prompt > 0
          && completion > 0
          && !id.includes(":free");
      })
      .map((model) => {
        const inputPerMillion = Number(model.pricing.prompt) * 1e6;
        const outputPerMillion = Number(model.pricing.completion) * 1e6;
        return {
          id: model.id,
          inputPerMillion,
          outputPerMillion,
          blended: inputPerMillion * 0.3 + outputPerMillion * 0.7
        };
      })
      .sort((a, b) => a.blended - b.blended);

    if (!prices.length) continue;
    const median = prices[Math.floor(prices.length / 2)];
    providerMedians.push(median.blended);
    details.push(`${provider} ${formatUsd(median.blended)}`);
  }

  if (!providerMedians.length) return {};
  const index = providerMedians.reduce((sum, value) => sum + value, 0) / providerMedians.length;

  return {
    api_price_index: {
      value: formatUsd(index),
      unit: "$/1M blended",
      change: `${details.join(" / ")}`,
      access: "自动",
      source: "OpenRouter Models API",
      sourceUrl: "https://openrouter.ai/api/v1/models",
      note: "自动抓取 OpenRouter models pricing，按 OpenAI、Anthropic、Google、DeepSeek 各自付费文本模型的中位价格计算；blended = 30% input + 70% output。"
    }
  };
}

async function fetchVastGpuRentalPrices() {
  const targets = [
    { label: "H100", queryName: "H100 SXM" },
    { label: "H200", queryName: "H200" },
    { label: "B200", queryName: "B200" }
  ];
  const results = [];

  for (const target of targets) {
    const query = {
      verified: { eq: true },
      external: { eq: false },
      rentable: { eq: true },
      gpu_name: { eq: target.queryName }
    };
    const url = `https://console.vast.ai/api/v0/bundles/?q=${encodeURIComponent(JSON.stringify(query))}`;
    const payload = await getJson(url);
    const offers = Array.isArray(payload.offers) ? payload.offers : [];
    const prices = offers
      .map((offer) => Number(offer.dph_total) / Math.max(1, Number(offer.num_gpus || 1)))
      .filter((price) => Number.isFinite(price) && price > 0)
      .sort((a, b) => a - b);

    if (!prices.length) continue;
    const p25 = prices[Math.floor((prices.length - 1) * 0.25)];
    const median = prices[Math.floor((prices.length - 1) * 0.5)];
    results.push({ ...target, p25, median, offers: prices.length });
  }

  if (!results.length) return {};
  const h100 = results.find((item) => item.label === "H100") || results[0];
  const change = results
    .map((item) => `${item.label} ${formatUsd(item.p25)}/h`)
    .join(" / ");

  return {
    gpu_rental_price: {
      value: `${formatUsd(h100.p25)}/h`,
      unit: `${h100.label} p25`,
      change,
      access: "自动",
      source: "Vast.ai public offers API",
      sourceUrl: "https://cloud.vast.ai/",
      note: "自动抓取 Vast.ai verified rentable offers，按单 GPU 每小时价格计算 25 分位。它代表现货供给代理指标，不等同于大厂长期合约价。"
    },
    revenue_per_gpu: {
      value: `${formatUsd(h100.p25 * 24)}/day`,
      unit: `${h100.label} spot proxy`,
      change: `median ${formatUsd(h100.median * 24)}/day`,
      access: "自动",
      source: "Vast.ai public offers API",
      sourceUrl: "https://cloud.vast.ai/",
      note: "第一版用 GPU 租赁现货价格估算单卡每日收入上限代理；后续可加入云厂商收入和 GPU 数量估算，升级为利润/ROI 指标。"
    }
  };
}
async function fetchSacraArrSignals() {
  const companies = [
    {
      id: "anthropic_arr",
      name: "Anthropic",
      url: "https://sacra.com/c/anthropic/"
    },
    {
      id: "openai_arr",
      name: "OpenAI",
      url: "https://sacra.com/c/openai/"
    }
  ];
  const entries = [];

  for (const company of companies) {
    const html = await getText(company.url, {
      "User-Agent": "AI Monitor Mini Program"
    });
    const text = htmlToText(html);
    const pattern = new RegExp(`Sacra estimates that\\s+${company.name}\\s+hit\\s+\\$\\s?([0-9]+(?:\\.[0-9]+)?)([BM])\\s+in annualized revenue\\s+in\\s+([^,.]+)`, "i");
    const match = text.match(pattern);
    if (!match) continue;
    const value = `$${match[1]}${match[2].toUpperCase()}`;
    entries.push([company.id, {
      value,
      unit: "annualized revenue",
      change: match[3].trim(),
      access: "自动",
      source: "Sacra estimates",
      sourceUrl: company.url,
      note: "自动抓取 Sacra 公司页中的 annualized revenue 估算。该项不是公司官方财报披露，适合做商业化方向性跟踪。"
    }]);
  }

  return Object.fromEntries(entries);
}

async function fetchSecCapex() {
  const userAgent = process.env.SEC_USER_AGENT || "AI Monitor Mini Program contact@example.com";
  const companies = [
    { id: "msft_capex", name: "Microsoft", cik: "0000789019" },
    { id: "googl_capex", name: "Alphabet", cik: "0001652044" },
    { id: "amzn_capex", name: "Amazon", cik: "0001018724" },
    { id: "meta_capex", name: "Meta", cik: "0001326801" },
    { id: "orcl_capex", name: "Oracle", cik: "0001341439" }
  ];

  const entries = await Promise.all(companies.map(async (company) => {
    const capex = await fetchAnnualCapex(company.cik, userAgent);
    if (!capex) return null;
    return [company.id, {
      title: `${company.name} CapEx`,
      value: formatUsdBillions(capex.val),
      unit: `FY${capex.fy}`,
      change: capex.filed ? `filed ${capex.filed}` : "SEC",
      access: "自动",
      source: "SEC Company Facts API",
      sourceUrl: "https://www.sec.gov/edgar/sec-api-documentation",
      note: `SEC companyconcept annual capex. Metric: ${capex.concept}.`
    }];
  }));

  return Object.fromEntries(entries.filter(Boolean));
}

async function fetchCiccCashFlowSnapshot() {
  return {
    hyperscaler_fcf: {
      value: "$9.5B",
      unit: "十亿美元",
      change: "环比 -81% / 同比 -78%",
      trend: "down",
      access: "半自动",
      source: "中金：如何监测AI泡沫",
      sourceUrl: "https://mp.weixin.qq.com/s/W4P14CggnGVJCdV51jJirg",
      note: "中金第二层现金流口径：Big 5 自由现金流。它回答的是云厂商还能不能用内部现金流覆盖 AI 投资；若持续收缩，说明资本开支越来越依赖外部融资。"
    },
    hyperscaler_capex_ocf_ratio: {
      value: "94%",
      unit: "CapEx / OCF",
      change: "环比 22% / 同比 29%",
      trend: "down",
      access: "半自动",
      source: "中金：如何监测AI泡沫",
      sourceUrl: "https://mp.weixin.qq.com/s/W4P14CggnGVJCdV51jJirg",
      note: "中金第二层现金流压力口径：Big 5 资本开支相对经营性现金流。比例越高，说明内生现金流覆盖 AI 投资的余量越薄。"
    }
  };
}

async function fetchCiccFundingSnapshot() {
  return {
    big5_debt_equity_ratio: {
      value: "43%",
      unit: "Big 5 负债权益比",
      change: "环比 4% / 同比 6%",
      trend: "flat",
      access: "半自动",
      source: "中金：如何监测AI泡沫",
      sourceUrl: "https://mp.weixin.qq.com/s/W4P14CggnGVJCdV51jJirg",
      note: "中金第三层存量杠杆口径：Big 5 负债权益比。杠杆越高，后续资本开支越容易受到融资成本和信用风险约束。"
    }
  };
}
async function fetchSecCashFlowPressure() {
  return {};
}

async function fetchSecFundingMetrics() {
  return {};
}
async function fetchFredTechJobPostings() {
  const endDate = formatDate(new Date());
  const startDate = formatDate(addDays(new Date(), -120));
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=IHLIDXUSTPSOFTDEVE&cosd=${startDate}&coed=${endDate}`;
  const csv = await getTextFetch(url, {
    "User-Agent": "AI Monitor Mini Program"
  });
  const rows = parseFredCsv(csv);
  if (!rows.length) return {};

  const latest = rows[rows.length - 1];
  const previous = rows[Math.max(0, rows.length - 29)];
  const change = previous ? pctChange(previous.value, latest.value) : 0;
  const label = change < -5 ? "招聘降温" : change > 5 ? "招聘回暖" : "招聘平稳";

  return {
    tech_job_postings: {
      value: round1(latest.value),
      unit: "Feb 2020=100",
      change: `${label} / 28d ${round1(change)}%`,
      trend: change > 3 ? "up" : change < -3 ? "down" : "flat",
      access: "自动",
      source: "FRED / Indeed Hiring Lab",
      sourceUrl: "https://fred.stlouisfed.org/series/IHLIDXUSTPSOFTDEVE",
      note: "Indeed 美国软件开发岗位招聘指数，7 日均值，2020-02-01=100。用来观察 AI 渗透和科技裁员叙事是否开始压低软件岗位需求。"
    }
  };
}

async function fetchFredInvestmentGradeSpread() {
  const endDate = formatDate(new Date());
  const startDate = formatDate(addDays(new Date(), -120));
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=BAMLC0A0CM&cosd=${startDate}&coed=${endDate}`;
  const csv = await getTextFetch(url, {
    "User-Agent": "AI Monitor Mini Program"
  });
  const rows = parseFredCsv(csv);
  if (!rows.length) return {};

  const latest = rows[rows.length - 1];
  const previous = rows[Math.max(0, rows.length - 29)];
  const change = previous ? latest.value - previous.value : 0;

  return {
    ig_credit_spread: {
      value: `${round1(latest.value)}ppt`,
      unit: "US IG OAS",
      change: `28d ${round1(change)}ppt`,
      trend: change > 0.1 ? "down" : change < -0.1 ? "up" : "flat",
      access: "自动",
      source: "FRED ICE BofA US Corporate Index OAS",
      sourceUrl: "https://fred.stlouisfed.org/series/BAMLC0A0CM",
      note: "中金第三层外部融资成本口径：美国投资级信用利差。利差上行意味着 AI 投资从内生现金流转向外部融资时，资金成本压力加大。"
    }
  };
}
async function fetchCrowdingUnwind() {
  return {};
}
function buildDerivedMetricUpdates() {
  return {};
}
async function fetchAnnualCapex(cik, userAgent) {
  const concepts = [
    "PaymentsToAcquirePropertyPlantAndEquipment",
    "PaymentsToAcquireProductiveAssets",
    "PropertyPlantAndEquipmentAdditions"
  ];

  let best = null;
  for (const concept of concepts) {
    try {
      const url = `https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/us-gaap/${concept}.json`;
      const payload = await getJson(url, {
        "User-Agent": userAgent,
        Accept: "application/json"
      });
      const rows = payload && payload.units && Array.isArray(payload.units.USD) ? payload.units.USD : [];
      const annualRows = rows
        .filter((row) => row.form === "10-K" && row.fp === "FY" && Number.isFinite(Number(row.val)))
        .sort((a, b) => {
          const fyDiff = Number(b.fy || 0) - Number(a.fy || 0);
          if (fyDiff) return fyDiff;
          return String(b.filed || "").localeCompare(String(a.filed || ""));
        });

      if (annualRows[0] && (!best || Number(annualRows[0].fy || 0) > Number(best.fy || 0))) {
        best = { ...annualRows[0], concept };
      }
    } catch (error) {
      // Some companies do not report every capex concept.
    }
  }
  return best;
}

async function fetchAnnualConcept(cik, concepts, userAgent) {
  let best = null;
  for (const concept of concepts) {
    try {
      const url = `https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/us-gaap/${concept}.json`;
      const payload = await getJson(url, {
        "User-Agent": userAgent,
        Accept: "application/json"
      });
      const rows = payload && payload.units && Array.isArray(payload.units.USD) ? payload.units.USD : [];
      const annualRows = rows
        .filter((row) => row.form === "10-K" && row.fp === "FY" && Number.isFinite(Number(row.val)))
        .sort((a, b) => {
          const fyDiff = Number(b.fy || 0) - Number(a.fy || 0);
          if (fyDiff) return fyDiff;
          return String(b.filed || "").localeCompare(String(a.filed || ""));
        });

      if (annualRows[0] && (!best || Number(annualRows[0].fy || 0) > Number(best.fy || 0))) {
        best = { ...annualRows[0], concept };
      }
    } catch (error) {
      // Some companies do not report every concept.
    }
  }
  return best;
}

function fallbackFailureNote(current, update) {
  if (update || !current) return {};
  return {};
}

function writeMetrics(filePath, metrics) {
  const body = `const metrics = ${JSON.stringify(metrics, null, 2)};\n\nmodule.exports = { metrics };\n`;
  fs.writeFileSync(filePath, body, "utf8");
}

function writeMeta(filePath, updatedAt) {
  const body = `const cacheMeta = ${JSON.stringify({ updatedAt }, null, 2)};\n\nmodule.exports = { cacheMeta };\n`;
  fs.writeFileSync(filePath, body, "utf8");
}

function readHistory() {
  if (!fs.existsSync(miniHistoryPath)) return {};
  delete require.cache[require.resolve(miniHistoryPath)];
  return require(miniHistoryPath).metricHistory || {};
}

function updateHistory(history, metrics, updatedAt) {
  const next = { ...history };
  const date = updatedAt.slice(0, 10);

  for (const metric of metrics) {
    if (isQuarterlyHistoryMetric(metric.id)) continue;
    const value = parseMetricNumber(metric.value);
    if (!Number.isFinite(value)) continue;

    const records = Array.isArray(next[metric.id]) ? [...next[metric.id]] : [];
    const entry = {
      date,
      value,
      label: String(metric.value || ""),
      unit: String(metric.unit || "")
    };
    const lastIndex = records.findIndex((item) => item.date === date);
    if (lastIndex >= 0) {
      records[lastIndex] = entry;
    } else {
      records.push(entry);
    }
    records.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    next[metric.id] = trimHistory(records, metric);
  }

  return next;
}

function trimHistory(records, metric) {
  return records.filter((item) => {
    const date = new Date(`${item.date}T00:00:00`);
    return !Number.isNaN(date.getTime());
  });
}

function getHistoryWindowDays(metric) {
  if (isLongHistoryMetric(metric.id)) return 1460;
  if (isQuarterlyHistoryMetric(metric.id)) return 370;
  return 100;
}

function isLongHistoryMetric(id) {
  return new Set(["openai_arr", "anthropic_arr"]).has(id);
}

function isQuarterlyHistoryMetric(id) {
  const quarterlyIds = new Set([
    "msft_capex",
    "googl_capex",
    "amzn_capex",
    "meta_capex",
    "orcl_capex",
    "nvda_dc_revenue",
    "ai_capex_roi"
  ]);
  return quarterlyIds.has(id);
}

function parseMetricNumber(value) {
  const raw = String(value || "").replace(/,/g, "").trim();
  const match = raw.match(/-?\d+(?:\.\d+)?/);
  if (!match) return NaN;
  const number = Number(match[0]);
  if (!Number.isFinite(number)) return NaN;
  const suffix = raw.slice(match.index + match[0].length).trim().charAt(0).toUpperCase();
  const multipliers = {
    K: 1e3,
    M: 1e6,
    B: 1e9,
    T: 1e12
  };
  return number * (multipliers[suffix] || 1);
}

function writeHistory(filePath, history) {
  const body = `const metricHistory = ${JSON.stringify(history, null, 2)};\n\nmodule.exports = { metricHistory };\n`;
  fs.writeFileSync(filePath, body, "utf8");
}

function writePublicCache(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function getJson(url, headers = {}, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
          if (redirectCount >= 5) {
            reject(new Error("Too many redirects"));
            return;
          }
          const nextUrl = new URL(response.headers.location, url).toString();
          getJson(nextUrl, headers, redirectCount + 1).then(resolve, reject);
          return;
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode}: ${body.slice(0, 180)}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.setTimeout(30000, () => {
      request.destroy(new Error("Request timeout"));
    });
    request.on("error", reject);
  });
}

async function getJsonFetch(url, headers = {}) {
  const response = await fetch(url, { headers });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${body.slice(0, 180)}`);
  }
  return JSON.parse(body);
}

function getText(url, headers = {}, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
          if (redirectCount >= 5) {
            reject(new Error("Too many redirects"));
            return;
          }
          const nextUrl = new URL(response.headers.location, url).toString();
          getText(nextUrl, headers, redirectCount + 1).then(resolve, reject);
          return;
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode}: ${body.slice(0, 180)}`));
          return;
        }
        resolve(body);
      });
    });
    request.setTimeout(30000, () => {
      request.destroy(new Error("Request timeout"));
    });
    request.on("error", reject);
  });
}

async function getTextFetch(url, headers = {}) {
  const response = await fetch(url, { headers });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${body.slice(0, 180)}`);
  }
  return body;
}

function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/\s+/g, " ")
    .trim();
}

function parseFredCsv(csv) {
  return String(csv)
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => {
      const [date, rawValue] = line.split(",");
      const value = Number(rawValue);
      return { date, value };
    })
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && Number.isFinite(row.value));
}

function getRowDate(row) {
  const raw = row.date || row.day || row.start_date || row.end_date || row.timestamp || row.created_at || row.updated_at;
  if (!raw) return "";
  return String(raw).slice(0, 10);
}

function getProviderCountry(provider) {
  const normalized = String(provider || "").toLowerCase();
  const usProviders = new Set(["openai", "anthropic", "google", "meta-llama", "x-ai", "perplexity", "cohere"]);
  const cnProviders = new Set([
    "deepseek",
    "qwen",
    "alibaba",
    "moonshotai",
    "minimax",
    "z-ai",
    "thudm",
    "xiaomi",
    "tencent",
    "hunyuan",
    "baidu",
    "bytedance",
    "stepfun",
    "01-ai"
  ]);
  if (usProviders.has(normalized)) return "us";
  if (cnProviders.has(normalized)) return "cn";
  return "";
}

function averageCountryDailyTokens(byCountryDate, country) {
  const values = [];
  for (const [key, value] of byCountryDate.entries()) {
    if (key.startsWith(`${country}|`)) values.push(value);
  }
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function parseCsvRows(csv) {
  const lines = String(csv)
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.startsWith("#"));
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((item) => item.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(",");
    return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
  });
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatDate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatTime(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatLargeToken(value) {
  if (value >= 1e12) return `${(value / 1e12).toFixed(1)}T`;
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  return String(Math.round(value));
}

function formatTrillion(value) {
  return `${round1(Number(value) / 1e12)}`;
}

function formatUsdBillions(value) {
  return `$${(Number(value) / 1e9).toFixed(1)}B`;
}

function formatUsd(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "$0.00";
  if (number >= 10) return `$${number.toFixed(1)}`;
  return `$${number.toFixed(2)}`;
}

function formatUsdMillions(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "$0M";
  return `$${(number / 1e6).toFixed(1)}M`;
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  return number.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function pctChange(start, end) {
  const firstValue = Number(start);
  const lastValue = Number(end);
  if (!Number.isFinite(firstValue) || !Number.isFinite(lastValue) || firstValue === 0) return 0;
  return ((lastValue / firstValue) - 1) * 100;
}

function first(records) {
  return records[0];
}

function last(records) {
  return records[records.length - 1];
}

function withCurrentHistory(records, metric) {
  const next = Array.isArray(records) ? [...records] : [];
  const currentValue = parseMetricNumber(metric && metric.value);
  if (Number.isFinite(currentValue)) {
    next.push({
      date: formatDate(new Date()),
      value: currentValue,
      label: String(metric.value || ""),
      unit: String(metric.unit || "")
    });
  }
  return next
    .filter((item) => Number.isFinite(Number(item.value)))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});










