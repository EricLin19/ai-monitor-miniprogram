const fs = require("fs");
const path = require("path");
const https = require("https");

const rootDir = path.resolve(__dirname, "..");
const historyPath = path.join(rootDir, "miniprogram", "data", "metricHistory.js");

loadDotEnv(path.join(rootDir, ".env"));

async function main() {
  const history = readHistory();
  const updates = {};

  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (openRouterKey) {
    try {
      Object.assign(updates, await backfillOpenRouter(openRouterKey));
    } catch (error) {
      console.warn(`OpenRouter history backfill failed: ${error.message}`);
      if (process.env.REQUIRE_OPENROUTER_API_KEY === "true") throw error;
    }
  } else {
    const message = "OPENROUTER_API_KEY is not set. Skipping OpenRouter history backfill.";
    console.warn(message);
    if (process.env.REQUIRE_OPENROUTER_API_KEY === "true") throw new Error(message);
  }

  try {
    Object.assign(updates, await backfillSecCapex());
  } catch (error) {
    console.warn(`SEC capex history backfill failed: ${error.message}`);
  }

  try {
    Object.assign(updates, await backfillSacraArrMilestones());
  } catch (error) {
    console.warn(`Sacra ARR history backfill failed: ${error.message}`);
  }

  try {
    Object.assign(updates, await backfillFredTechJobPostings());
  } catch (error) {
    console.warn(`FRED tech job postings history backfill failed: ${error.message}`);
  }

  const next = { ...history, ...updates };
  Object.assign(next, buildDerivedHistory(next));
  writeHistory(historyPath, next);

  console.log(JSON.stringify({
    updatedIds: Object.keys(updates),
    output: path.relative(rootDir, historyPath)
  }, null, 2));
}

async function backfillOpenRouter(key) {
  const endDate = formatDate(addDays(new Date(), -1));
  const startDate = formatDate(addDays(new Date(), -105));
  const url = `https://openrouter.ai/api/v1/datasets/rankings-daily?start_date=${startDate}&end_date=${endDate}`;
  const payload = await getJson(url, {
    Authorization: `Bearer ${key}`
  });

  const rows = Array.isArray(payload.data) ? payload.data : [];
  if (!rows.length) return {};

  const byDate = new Map();
  for (const row of rows) {
    const date = getRowDate(row);
    if (!date) continue;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(row);
  }

  const dates = [...byDate.keys()].sort();
  const tokenHistory = [];
  const shareHistory = [];

  for (const date of dates) {
    const windowStart = formatDate(addDays(new Date(`${date}T00:00:00`), -6));
    const windowRows = dates
      .filter((item) => item >= windowStart && item <= date)
      .flatMap((item) => byDate.get(item) || []);
    if (!windowRows.length) continue;

    const totalTokens = sumTokens(windowRows);
    const top10Share = calcTop10Share(windowRows, totalTokens);
    tokenHistory.push({
      date,
      value: totalTokens,
      label: formatLargeToken(totalTokens),
      unit: "7d"
    });
    shareHistory.push({
      date,
      value: Math.round(top10Share * 1000) / 10,
      label: `${Math.round(top10Share * 1000) / 10}%`,
      unit: "Top10"
    });
  }

  return {
    openrouter_tokens: keepRecent(tokenHistory, 92),
    openrouter_share: keepRecent(shareHistory, 92)
  };
}

async function backfillSacraArrMilestones() {
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
    const current = text.match(new RegExp(`Sacra estimates that\\s+${company.name}\\s+hit\\s+\\$\\s?([0-9]+(?:\\.[0-9]+)?)([BM])\\s+in annualized revenue\\s+in\\s+([^,.]+)`, "i"));
    if (!current) continue;

    const records = [];
    const previous = text.match(/up from\s+\$\s?([0-9]+(?:\.[0-9]+)?)([BM])\s+at the end of\s+(\d{4})/i);
    if (previous) {
      records.push({
        date: `${previous[3]}-12-31`,
        value: moneyToNumber(previous[1], previous[2]),
        label: `$${previous[1]}${previous[2].toUpperCase()}`,
        unit: "annualized revenue"
      });
    }

    records.push({
      date: monthPhraseToDate(current[3].trim()),
      value: moneyToNumber(current[1], current[2]),
      label: `$${current[1]}${current[2].toUpperCase()}`,
      unit: "annualized revenue"
    });

    entries.push([company.id, dedupeHistory(records)]);
  }

  return Object.fromEntries(entries);
}

async function backfillSecCapex() {
  const userAgent = process.env.SEC_USER_AGENT || "AI Monitor Mini Program contact@example.com";
  const companies = [
    { id: "msft_capex", cik: "0000789019" },
    { id: "googl_capex", cik: "0001652044" },
    { id: "amzn_capex", cik: "0001018724" },
    { id: "meta_capex", cik: "0001326801" }
  ];
  const entries = [];

  for (const company of companies) {
    const rows = await fetchQuarterlyCapex(company.cik, userAgent);
    if (!rows.length) continue;
    entries.push([company.id, rows.slice(-6).map((row) => ({
      date: row.end,
      value: Number(row.val),
      label: formatUsdBillions(row.val),
      unit: normalizeQuarterUnit(row)
    }))]);
  }

  return Object.fromEntries(entries);
}

async function backfillFredTechJobPostings() {
  const endDate = formatDate(new Date());
  const startDate = formatDate(addDays(new Date(), -120));
  const csv = await getTextFetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=IHLIDXUSTPSOFTDEVE&cosd=${startDate}&coed=${endDate}`, {
    "User-Agent": "AI Monitor Mini Program"
  });
  const records = parseFredCsv(csv)
    .slice(-110)
    .map((row) => ({
      date: row.date,
      value: row.value,
      label: String(row.value),
      unit: "Feb 2020=100"
    }));

  return records.length ? { tech_job_postings: keepRecent(records, 100) } : {};
}

function buildDerivedHistory(history) {
  const updates = {};
  const wagePoolRecords = buildWagePoolCoverageHistory(history);
  if (wagePoolRecords.length) updates.ai_wage_pool_coverage = wagePoolRecords;
  const tokenArrRecords = buildTokenArrConversionHistory(history);
  if (tokenArrRecords.length) updates.token_arr_conversion = tokenArrRecords;
  return updates;
}

function buildWagePoolCoverageHistory(history) {
  const observedWagePool = 1.45e12;
  const dates = mergeHistoryDates(history.openai_arr, history.anthropic_arr);
  return dates.map((date) => {
    const openaiArr = valueAtOrBefore(history.openai_arr, date);
    const anthropicArr = valueAtOrBefore(history.anthropic_arr, date);
    const totalArr = openaiArr + anthropicArr;
    if (!Number.isFinite(totalArr) || totalArr <= 0) return null;
    const value = totalArr / observedWagePool * 100;
    return {
      date,
      value,
      label: `${round1(value)}%`,
      unit: "ARR / exposed wage pool"
    };
  }).filter(Boolean);
}

function buildTokenArrConversionHistory(history) {
  const tokenRecords = Array.isArray(history.openrouter_tokens) ? history.openrouter_tokens : [];
  return tokenRecords.map((record) => {
    const openaiArr = valueAtOrBefore(history.openai_arr, record.date);
    const anthropicArr = valueAtOrBefore(history.anthropic_arr, record.date);
    const totalArr = openaiArr + anthropicArr;
    const weeklyTokens = Number(record.value);
    if (!Number.isFinite(totalArr) || !Number.isFinite(weeklyTokens) || totalArr <= 0 || weeklyTokens <= 0) return null;
    const annualizedTokenTrillions = weeklyTokens * 52 / 1e12;
    const value = totalArr / annualizedTokenTrillions;
    return {
      date: record.date,
      value,
      label: `$${(value / 1e6).toFixed(1)}M`,
      unit: "ARR / annualized 1T OR tokens"
    };
  }).filter(Boolean).slice(-100);
}

async function fetchQuarterlyCapex(cik, userAgent) {
  const concepts = [
    "PaymentsToAcquirePropertyPlantAndEquipment",
    "PaymentsToAcquireProductiveAssets",
    "PropertyPlantAndEquipmentAdditions"
  ];

  let best = [];
  let bestLatest = "";
  for (const concept of concepts) {
    try {
      const url = `https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/us-gaap/${concept}.json`;
      const payload = await getJson(url, {
        "User-Agent": userAgent,
        Accept: "application/json"
      });
      const rows = payload && payload.units && Array.isArray(payload.units.USD) ? payload.units.USD : [];
      const reportedRows = rows
        .filter((row) => ["10-Q", "10-K"].includes(row.form) && Number.isFinite(Number(row.val)))
        .filter((row) => row.start && row.end)
        .sort((a, b) => {
          const startDiff = String(a.start || "").localeCompare(String(b.start || ""));
          if (startDiff) return startDiff;
          return String(a.end || "").localeCompare(String(b.end || ""));
        });
      const quarterly = deriveQuarterlyRows(reportedRows);
      const latest = quarterly.length ? quarterly[quarterly.length - 1].end : "";
      if (latest > bestLatest || (latest === bestLatest && quarterly.length > best.length)) {
        best = quarterly;
        bestLatest = latest;
      }
    } catch (error) {
      // Some companies do not report every capex concept.
    }
  }

  return best;
}

function deriveQuarterlyRows(rows) {
  const deduped = dedupeByPeriod(rows);
  const byStart = new Map();
  for (const row of deduped) {
    if (!byStart.has(row.start)) byStart.set(row.start, []);
    byStart.get(row.start).push(row);
  }

  const quarterly = [];
  for (const groupRows of byStart.values()) {
    const sorted = groupRows.sort((a, b) => String(a.end || "").localeCompare(String(b.end || "")));
    for (let index = 0; index < sorted.length; index += 1) {
      const row = sorted[index];
      const duration = durationDays(row.start, row.end);
      if (duration >= 70 && duration <= 110) {
        quarterly.push({ ...row, val: Number(row.val) });
        continue;
      }

      const previous = sorted[index - 1];
      if (!previous) continue;
      const quarterDuration = durationDays(previous.end, row.end);
      const value = Number(row.val) - Number(previous.val);
      if (quarterDuration >= 70 && quarterDuration <= 120 && Number.isFinite(value) && value >= 0) {
        quarterly.push({
          ...row,
          val: value,
          start: addDays(new Date(`${previous.end}T00:00:00`), 1).toISOString().slice(0, 10)
        });
      }
    }
  }

  return dedupeByEndDate(quarterly).sort((a, b) => String(a.end || "").localeCompare(String(b.end || "")));
}

function dedupeByEndDate(rows) {
  const byEnd = new Map();
  for (const row of rows) {
    const existing = byEnd.get(row.end);
    if (!existing || String(row.filed || "") > String(existing.filed || "")) {
      byEnd.set(row.end, row);
    }
  }
  return [...byEnd.values()].sort((a, b) => String(a.end || "").localeCompare(String(b.end || "")));
}

function dedupeByPeriod(rows) {
  const byPeriod = new Map();
  for (const row of rows) {
    const key = `${row.start}|${row.end}`;
    const existing = byPeriod.get(key);
    if (!existing || String(row.filed || "") > String(existing.filed || "")) {
      byPeriod.set(key, row);
    }
  }
  return [...byPeriod.values()];
}

function normalizeQuarterUnit(row) {
  if (/^CY\d{4}Q[1-4]$/.test(String(row.frame || ""))) return row.frame;
  const inferred = inferCalendarQuarter(row.end);
  if (inferred) return inferred;
  return `${row.fy || ""}${row.fp || ""}`;
}

function inferCalendarQuarter(end) {
  const year = String(end || "").slice(0, 4);
  const month = String(end || "").slice(5, 7);
  const quarterByMonth = {
    "03": "Q1",
    "06": "Q2",
    "09": "Q3",
    "12": "Q4"
  };
  return year && quarterByMonth[month] ? `CY${year}${quarterByMonth[month]}` : "";
}

function durationDays(start, end) {
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return NaN;
  return Math.round((endDate - startDate) / 86400000);
}

function sumTokens(rows) {
  return rows.reduce((sum, row) => sum + Number(row.total_tokens || 0), 0);
}

function calcTop10Share(rows, totalTokens) {
  const byModel = new Map();
  for (const row of rows) {
    const model = row.model_permaslug || row.model || "unknown";
    byModel.set(model, (byModel.get(model) || 0) + Number(row.total_tokens || 0));
  }
  const top10 = [...byModel.values()].sort((a, b) => b - a).slice(0, 10);
  return top10.reduce((sum, value) => sum + value, 0) / Math.max(1, totalTokens);
}

function getRowDate(row) {
  const raw = row.date || row.day || row.start_date || row.end_date || row.timestamp || row.created_at || row.updated_at;
  if (!raw) return "";
  return String(raw).slice(0, 10);
}

function readHistory() {
  if (!fs.existsSync(historyPath)) return {};
  delete require.cache[require.resolve(historyPath)];
  return require(historyPath).metricHistory || {};
}

function writeHistory(filePath, history) {
  const body = `const metricHistory = ${JSON.stringify(history, null, 2)};\n\nmodule.exports = { metricHistory };\n`;
  fs.writeFileSync(filePath, body, "utf8");
}

function keepRecent(records, days) {
  const cutoff = addDays(new Date(), -days);
  return records.filter((item) => {
    const date = new Date(`${item.date}T00:00:00`);
    return !Number.isNaN(date.getTime()) && date >= cutoff;
  });
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

function mergeHistoryDates(...seriesList) {
  const dates = new Set();
  for (const series of seriesList) {
    if (!Array.isArray(series)) continue;
    for (const item of series) {
      if (item && item.date) dates.add(item.date);
    }
  }
  return [...dates].sort();
}

function valueAtOrBefore(series, date) {
  if (!Array.isArray(series)) return NaN;
  let found = NaN;
  for (const item of series) {
    if (String(item.date) > String(date)) break;
    const value = Number(item.value);
    if (Number.isFinite(value)) found = value;
  }
  return found;
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

function round1(value) {
  return Math.round(value * 10) / 10;
}

function moneyToNumber(value, suffix) {
  const multiplier = String(suffix).toUpperCase() === "T" ? 1e12 : String(suffix).toUpperCase() === "B" ? 1e9 : 1e6;
  return Number(value) * multiplier;
}

function monthPhraseToDate(value) {
  const match = String(value).match(/([A-Za-z]+)\s+(\d{4})/);
  if (!match) return formatDate(new Date());
  const months = {
    january: "01",
    february: "02",
    march: "03",
    april: "04",
    may: "05",
    june: "06",
    july: "07",
    august: "08",
    september: "09",
    october: "10",
    november: "11",
    december: "12"
  };
  return `${match[2]}-${months[match[1].toLowerCase()] || "01"}-01`;
}

function dedupeHistory(records) {
  const byDate = new Map();
  for (const record of records) byDate.set(record.date, record);
  return [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
