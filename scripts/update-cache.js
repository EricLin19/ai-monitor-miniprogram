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

loadDotEnv(path.join(rootDir, ".env"));

async function main() {
  const current = require(miniMetricsPath).metrics;
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

  await mergeUpdate(updates, fetchOpenRouterModelPricing(), "OpenRouter model pricing");
  await mergeUpdate(updates, fetchVastGpuRentalPrices(), "Vast GPU rental prices");
  await mergeUpdate(updates, fetchSacraArrSignals(), "Sacra ARR signals");
  await mergeUpdate(updates, fetchSecCapex(), "SEC capex");
  await mergeUpdate(updates, fetchFredTechJobPostings(), "FRED tech job postings");
  await mergeUpdate(updates, fetchCrowdingUnwind(), "AI crowding unwind");

  // Manual overrides are now only a fallback for real user-provided values.
  // Placeholder values such as "待填" are ignored so they do not erase auto data.
  Object.assign(updates, readManualOverrides());

  const next = current.map((item) => ({
    ...item,
    ...(updates[item.id] || fallbackFailureNote(currentById[item.id], updates[item.id]))
  }));
  Object.assign(updates, buildDerivedMetricUpdates(next, existingHistory));
  const finalNext = next.map((item) => ({
    ...item,
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

  for (const row of rows) {
    const model = row.model_permaslug || "unknown";
    const provider = model.includes("/") ? model.split("/")[0] : "unknown";
    const tokens = Number(row.total_tokens || 0);
    byModel.set(model, (byModel.get(model) || 0) + tokens);
    byProvider.set(provider, (byProvider.get(provider) || 0) + tokens);
  }

  const topModels = [...byModel.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  const topShare = topModels.reduce((sum, item) => sum + item[1], 0) / Math.max(1, totalTokens);
  const anthropicShare = (byProvider.get("anthropic") || 0) / Math.max(1, totalTokens);

  return {
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
      note: "自动抓取 OpenRouter models pricing，按 OpenAI/Anthropic/Google/DeepSeek 各自付费文本模型的中位价格计算；blended = 30% input + 70% output。"
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
      note: "自动抓取 Vast.ai verified rentable offers，按单 GPU 每小时价格计算 25 分位。它代表现货/长尾供给代理指标，不等同于大厂长期合约价。"
    },
    revenue_per_gpu: {
      value: `${formatUsd(h100.p25 * 24)}/day`,
      unit: `${h100.label} spot proxy`,
      change: `median ${formatUsd(h100.median * 24)}/day`,
      access: "自动",
      source: "Vast.ai public offers API",
      sourceUrl: "https://cloud.vast.ai/",
      note: "第一版用 GPU 租赁现货价格估算单卡每日收入上限代理；后续可加入云厂商收入和 GPU 数量估算，提升为利润/ROI 指标。"
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
    { id: "meta_capex", name: "Meta", cik: "0001326801" }
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
      note: `SEC companyconcept annual capex. Metric: ${capex.concept}.`
    }];
  }));

  return Object.fromEntries(entries.filter(Boolean));
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
      note: "Indeed 美国软件开发岗位招聘指数，7日均值，2020-02-01=100。用来观察 AI 渗透和科技裁员叙事是否开始压低软件岗位需求。"
    }
  };
}

async function fetchCrowdingUnwind() {
  const [soxx, spy, qqq, rsp] = await Promise.all([
    fetchYahooReturns("SOXX"),
    fetchYahooReturns("SPY"),
    fetchYahooReturns("QQQ"),
    fetchYahooReturns("RSP")
  ]);

  if (!soxx || !spy || !qqq || !rsp) return {};
  const semiRelative = soxx.return20d - spy.return20d;
  const megaCapRelative = qqq.return20d - rsp.return20d;
  const pressure = -(semiRelative + megaCapRelative) / 2;
  const label = pressure > 5 ? "出清升温" : pressure > 0 ? "轻度出清" : "拥挤未退";

  return {
    ai_crowding_unwind: {
      value: `${round1(pressure)}pt`,
      unit: label,
      change: `SOXX-SPY ${round1(semiRelative)}pt / QQQ-RSP ${round1(megaCapRelative)}pt`,
      access: "自动",
      source: "Yahoo Finance chart API",
      sourceUrl: "https://finance.yahoo.com/",
      note: "用 SOXX 相对 SPY、QQQ 相对 RSP 的 20 日收益差构造拥挤交易出清代理。数值越高，代表 AI/科技拥挤交易相对市场更弱。"
    }
  };
}

async function fetchYahooReturns(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=3mo&interval=1d`;
  const payload = await getJson(url);
  const result = payload && payload.chart && payload.chart.result && payload.chart.result[0];
  const closes = result && result.indicators && result.indicators.quote && result.indicators.quote[0]
    ? result.indicators.quote[0].close
    : [];
  const prices = closes.filter((value) => Number.isFinite(Number(value))).map(Number);
  if (prices.length < 21) return null;
  const last = prices[prices.length - 1];
  const previous = prices[prices.length - 21];
  return {
    symbol,
    return20d: ((last / previous) - 1) * 100
  };
}

function buildDerivedMetricUpdates(metrics, history) {
  const byId = Object.fromEntries(metrics.map((item) => [item.id, item]));
  return {
    ...buildTokenPriceElasticity(byId, history),
    ...buildCapexRoiCoverage(byId),
    ...buildTokenArrConversion(byId),
    ...buildWagePoolCoverage(byId)
  };
}

function buildTokenPriceElasticity(byId, history) {
  const tokenHistory = withCurrentHistory(history.openrouter_tokens, byId.openrouter_tokens);
  const priceHistory = withCurrentHistory(history.api_price_index, byId.api_price_index);
  if (tokenHistory.length < 2 || priceHistory.length < 2) {
    return {
      token_price_elasticity: {
        value: "累积中",
        unit: "",
        change: "需要价格和 token 至少 2 个点",
        access: "自动",
        source: "OpenRouter + API price index",
        sourceUrl: "https://openrouter.ai/data",
        note: "用 OpenRouter token 用量变化和主流模型 API 价格指数变化估算价格弹性。"
      }
    };
  }

  const tokenChange = pctChange(first(tokenHistory).value, last(tokenHistory).value);
  const priceChange = pctChange(first(priceHistory).value, last(priceHistory).value);
  const elasticity = Math.abs(priceChange) < 0.1 ? null : tokenChange / Math.abs(priceChange);

  return {
    token_price_elasticity: {
      value: elasticity === null ? "价格未变" : round1(elasticity),
      unit: elasticity === null ? "" : "x",
      change: `token ${round1(tokenChange)}% / price ${round1(priceChange)}%`,
      access: "自动",
      source: "OpenRouter + OpenRouter Models API",
      sourceUrl: "https://openrouter.ai/data",
      note: "价格弹性 = token 用量变化率 / API 价格指数绝对变化率。价格不变时显示价格未变，继续积累历史。"
    }
  };
}

function buildCapexRoiCoverage(byId) {
  const capexIds = ["msft_capex", "googl_capex", "amzn_capex", "meta_capex"];
  const totalCapex = capexIds.reduce((sum, id) => sum + parseMetricNumber(byId[id] && byId[id].value), 0);
  const openaiArr = parseMetricNumber(byId.openai_arr && byId.openai_arr.value);
  const anthropicArr = parseMetricNumber(byId.anthropic_arr && byId.anthropic_arr.value);
  const totalArr = openaiArr + anthropicArr;
  if (!Number.isFinite(totalCapex) || !Number.isFinite(totalArr) || totalCapex <= 0 || totalArr <= 0) return {};
  const coverage = totalArr / totalCapex * 100;

  return {
    ai_capex_roi: {
      value: `${round1(coverage)}%`,
      unit: "ARR / Big4 CapEx",
      change: `ARR ${formatUsdBillions(totalArr)} / CapEx ${formatUsdBillions(totalCapex)}`,
      access: "自动",
      source: "Sacra estimates + SEC CapEx",
      sourceUrl: "https://www.sec.gov/search-filings/edgar-application-programming-interfaces",
      note: "第一版 ROI 代理：OpenAI + Anthropic annualized revenue 相对 Microsoft/Alphabet/Amazon/Meta 年度 CapEx。不是严格投资回报率，但能观察商业化收入相对资本开支的覆盖程度。"
    }
  };
}

function buildTokenArrConversion(byId) {
  const weeklyTokens = parseMetricNumber(byId.openrouter_tokens && byId.openrouter_tokens.value);
  const openaiArr = parseMetricNumber(byId.openai_arr && byId.openai_arr.value);
  const anthropicArr = parseMetricNumber(byId.anthropic_arr && byId.anthropic_arr.value);
  const totalArr = openaiArr + anthropicArr;
  if (!Number.isFinite(weeklyTokens) || !Number.isFinite(totalArr) || weeklyTokens <= 0 || totalArr <= 0) return {};

  const annualizedTokenTrillions = weeklyTokens * 52 / 1e12;
  const arrPerTrillionTokens = totalArr / annualizedTokenTrillions;

  return {
    token_arr_conversion: {
      value: formatUsdMillions(arrPerTrillionTokens),
      unit: "ARR / annualized 1T OR tokens",
      change: `ARR ${formatUsdBillions(totalArr)} / OR ${formatNumber(annualizedTokenTrillions)}T annualized`,
      access: "自动",
      source: "OpenRouter + Sacra estimates",
      sourceUrl: "https://openrouter.ai/data",
      note: "商业化效率代理：OpenAI + Anthropic ARR 相对 OpenRouter token 年化用量。若 token 增速快于 ARR，该值会下行，提示低价值调用或价格竞争加剧。"
    }
  };
}

function buildWagePoolCoverage(byId) {
  const observedWagePool = 1.45e12;
  const theoreticalWagePool = 5.68e12;
  const openaiArr = parseMetricNumber(byId.openai_arr && byId.openai_arr.value);
  const anthropicArr = parseMetricNumber(byId.anthropic_arr && byId.anthropic_arr.value);
  const totalArr = openaiArr + anthropicArr;
  if (!Number.isFinite(totalArr) || totalArr <= 0) return {};

  const observedCoverage = totalArr / observedWagePool * 100;
  const theoreticalCoverage = totalArr / theoreticalWagePool * 100;

  return {
    ai_wage_pool_coverage: {
      value: `${round1(observedCoverage)}%`,
      unit: "ARR / exposed wage pool",
      change: `theoretical pool ${round1(theoreticalCoverage)}%`,
      access: "自动",
      source: "国金宏观 AI洪流三部曲 + Sacra estimates",
      sourceUrl: "https://mp.weixin.qq.com/s/2MIroW_eh2hyaybRaACAXg",
      note: "用文章中的美国 AI 实际暴露薪资池 $1.45T 和理论潜在薪资池 $5.68T 做分母，观察模型商 ARR 离“工资池重定价”还有多远。"
    }
  };
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
  const days = getHistoryWindowDays(metric);
  const cutoff = addDays(new Date(), -Math.max(days, 370));
  return records.filter((item) => {
    const date = new Date(`${item.date}T00:00:00`);
    return !Number.isNaN(date.getTime()) && date >= cutoff;
  });
}

function getHistoryWindowDays(metric) {
  if (isQuarterlyHistoryMetric(metric.id)) return 370;
  return 100;
}

function isQuarterlyHistoryMetric(id) {
  const quarterlyIds = new Set([
    "msft_capex",
    "googl_capex",
    "amzn_capex",
    "meta_capex",
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
