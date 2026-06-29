const cloud = require("wx-server-sdk");
const https = require("https");
const { metrics: mockMetrics } = require("./mockMetrics");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event = {}) => {
  if (!event.live) {
    return {
      metrics: mockMetrics,
      updatedAt: "2026-06-29 21:18",
      source: "cached",
      errors: []
    };
  }

  const results = await Promise.allSettled([
    fetchOpenRouterMetrics(),
    fetchArtificialAnalysisMetrics(),
    fetchCloudflareMetrics(),
    fetchSecCapexMetrics()
  ]);

  const liveById = {};
  const errors = [];

  for (const result of results) {
    if (result.status === "fulfilled" && Array.isArray(result.value)) {
      for (const item of result.value) {
        liveById[item.id] = item;
      }
    } else if (result.status === "rejected") {
      errors.push(result.reason && result.reason.message ? result.reason.message : String(result.reason));
    }
  }

  const metrics = mockMetrics.map((item) => ({
    ...item,
    ...(liveById[item.id] || {})
  }));

  return {
    metrics,
    updatedAt: formatTime(new Date()),
    source: Object.keys(liveById).length ? "cloud" : "mock",
    errors
  };
};

async function fetchOpenRouterMetrics() {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return [];

  const endDate = formatDate(addDays(new Date(), -1));
  const startDate = formatDate(addDays(new Date(), -7));
  const url = `https://openrouter.ai/api/v1/datasets/rankings-daily?start_date=${startDate}&end_date=${endDate}`;
  const payload = await getJson(url, {
    Authorization: `Bearer ${key}`
  });

  const rows = Array.isArray(payload.data) ? payload.data : [];
  if (!rows.length) return [];

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
  const anthropicTokens = byProvider.get("anthropic") || 0;
  const anthropicShare = anthropicTokens / Math.max(1, totalTokens);

  return [
    {
      id: "openrouter_tokens",
      title: "OpenRouter platform token usage",
      value: formatLargeToken(totalTokens),
      unit: "7d",
      change: `${startDate} to ${endDate}`,
      note: "OpenRouter platform only. This is a developer API demand proxy, not global token usage."
    },
    {
      id: "openrouter_share",
      title: "OpenRouter model share",
      value: `${Math.round(topShare * 100)}%`,
      unit: "Top10",
      change: topModels[0] ? topModels[0][0].split("/").pop() : "Top model",
      note: `Top 10 model concentration. Anthropic share: ${Math.round(anthropicShare * 1000) / 10}%.`
    }
  ];
}

async function fetchArtificialAnalysisMetrics() {
  const key = process.env.ARTIFICIAL_ANALYSIS_API_KEY;
  if (!key) return [];
  return [];
}

async function fetchCloudflareMetrics() {
  return [];
}

async function fetchSecCapexMetrics() {
  const userAgent = process.env.SEC_USER_AGENT || "AI Monitor Mini Program contact@example.com";
  const companies = [
    { id: "msft_capex", name: "Microsoft", cik: "0000789019" },
    { id: "googl_capex", name: "Alphabet", cik: "0001652044" },
    { id: "amzn_capex", name: "Amazon", cik: "0001018724" },
    { id: "meta_capex", name: "Meta", cik: "0001326801" }
  ];

  const results = [];
  for (const company of companies) {
    const annualCapex = await fetchAnnualCapex(company.cik, userAgent);
    if (!annualCapex) continue;

    results.push({
      id: company.id,
      title: `${company.name} CapEx`,
      value: formatUsdBillions(annualCapex.val),
      unit: `FY${annualCapex.fy}`,
      change: annualCapex.filed ? `filed ${annualCapex.filed}` : "SEC",
      note: `SEC companyconcept annual capex. Metric: us-gaap ${annualCapex.concept}.`
    });
  }

  return results;
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
      // Some companies do not report every capex concept. Try the next concept.
    }
  }

  return best;
}

function formatTime(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
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

function formatLargeToken(value) {
  if (value >= 1e12) return `${(value / 1e12).toFixed(1)}T`;
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  return String(Math.round(value));
}

function formatUsdBillions(value) {
  return `$${(Number(value) / 1e9).toFixed(1)}B`;
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
