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

  // Manual overrides are now only a fallback for real user-provided values.
  // Placeholder values such as "待填" are ignored so they do not erase auto data.
  Object.assign(updates, readManualOverrides());

  const next = current.map((item) => ({
    ...item,
    ...(updates[item.id] || fallbackFailureNote(currentById[item.id], updates[item.id]))
  }));

  const updatedAt = formatTime(new Date());
  const history = updateHistory(readHistory(), next, updatedAt);
  writeMetrics(miniMetricsPath, next);
  writeMetrics(cloudMetricsPath, next);
  writeMeta(miniMetaPath, updatedAt);
  writeHistory(miniHistoryPath, history);
  writePublicCache(publicCachePath, {
    metrics: next,
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

function round1(value) {
  return Math.round(value * 10) / 10;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
