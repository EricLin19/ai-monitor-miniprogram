const fs = require("fs");
const path = require("path");
const https = require("https");

const rootDir = path.resolve(__dirname, "..");
const miniMetricsPath = path.join(rootDir, "miniprogram", "data", "mockMetrics.js");
const cloudMetricsPath = path.join(rootDir, "cloudfunctions", "fetchMetrics", "mockMetrics.js");
const miniMetaPath = path.join(rootDir, "miniprogram", "data", "cacheMeta.js");

loadDotEnv(path.join(rootDir, ".env"));

async function main() {
  const current = require(miniMetricsPath).metrics;
  const updates = {};

  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (openRouterKey) {
    try {
      Object.assign(updates, await fetchOpenRouter(openRouterKey));
    } catch (error) {
      console.warn(`OpenRouter update failed: ${error.message}`);
    }
  } else {
    console.warn("OPENROUTER_API_KEY is not set. Keeping OpenRouter cache unchanged.");
  }

  Object.assign(updates, await fetchSecCapex());

  const next = current.map((item) => ({
    ...item,
    ...(updates[item.id] || {})
  }));

  const updatedAt = formatTime(new Date());
  writeMetrics(miniMetricsPath, next);
  writeMetrics(cloudMetricsPath, next);
  writeMeta(miniMetaPath, updatedAt);

  console.log(JSON.stringify({
    updatedAt,
    updatedIds: Object.keys(updates),
    output: [
      path.relative(rootDir, miniMetricsPath),
      path.relative(rootDir, cloudMetricsPath),
      path.relative(rootDir, miniMetaPath)
    ]
  }, null, 2));
}

async function fetchOpenRouter(key) {
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
      access: "缓存",
      note: "OpenRouter 平台口径，观察跨模型开发者调用需求，不代表全球 token 总量。"
    },
    openrouter_share: {
      value: `${Math.round(topShare * 100)}%`,
      unit: "Top10",
      change: `Anthropic ${round1(anthropicShare * 100)}%`,
      access: "缓存",
      note: `Top10 模型集中度；第一模型：${topModels[0] ? topModels[0][0] : "N/A"}。`
    }
  };
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
      access: "缓存",
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

function writeMetrics(filePath, metrics) {
  const body = `const metrics = ${JSON.stringify(metrics, null, 2)};\n\nmodule.exports = { metrics };\n`;
  fs.writeFileSync(filePath, body, "utf8");
}

function writeMeta(filePath, updatedAt) {
  const body = `const cacheMeta = ${JSON.stringify({ updatedAt }, null, 2)};\n\nmodule.exports = { cacheMeta };\n`;
  fs.writeFileSync(filePath, body, "utf8");
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

function getJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
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

function round1(value) {
  return Math.round(value * 10) / 10;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
