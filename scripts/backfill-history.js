const fs = require("fs");
const path = require("path");
const https = require("https");

const rootDir = path.resolve(__dirname, "..");
const historyPath = path.join(rootDir, "miniprogram", "data", "metricHistory.js");
const rampDir = path.join(rootDir, "data", "ramp");

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
    Object.assign(updates, await backfillTrakTokenIndex());
  } catch (error) {
    console.warn(`TrakToken history backfill failed: ${error.message}`);
  }

  try {
    Object.assign(updates, backfillRampAiIndex());
  } catch (error) {
    console.warn(`Ramp AI Index history backfill failed: ${error.message}`);
  }

  try {
    Object.assign(updates, await backfillSecCapex());
  } catch (error) {
    console.warn(`SEC capex history backfill failed: ${error.message}`);
  }

  try {
    Object.assign(updates, await backfillSecBig5CashFunding());
  } catch (error) {
    console.warn(`SEC Big5 cash/funding history backfill failed: ${error.message}`);
  }

  try {
    Object.assign(updates, await backfillSacraArrMilestones());
  } catch (error) {
    console.warn(`Sacra ARR history backfill failed: ${error.message}`);
  }

  try {
    Object.assign(updates, backfillChinaModelArrMilestones());
  } catch (error) {
    console.warn(`China model ARR history backfill failed: ${error.message}`);
  }

  try {
    Object.assign(updates, await backfillFredTechJobPostings());
  } catch (error) {
    console.warn(`FRED tech job postings history backfill failed: ${error.message}`);
  }

  try {
    Object.assign(updates, await backfillFredInvestmentGradeSpread());
  } catch (error) {
    console.warn(`FRED investment grade spread history backfill failed: ${error.message}`);
  }

  try {
    Object.assign(updates, await backfillDataCenterConstruction());
  } catch (error) {
    console.warn(`Data center construction history backfill failed: ${error.message}`);
  }

  try {
    Object.assign(updates, await backfillTechFinanceEmploymentProxy());
  } catch (error) {
    console.warn(`Tech and finance employment proxy backfill failed: ${error.message}`);
  }

  const next = { ...dropRampHistory(history), ...updates };
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
  const usTokenHistory = [];
  const cnTokenHistory = [];

  for (const date of dates) {
    const windowStart = formatDate(addDays(new Date(`${date}T00:00:00`), -6));
    const windowRows = dates
      .filter((item) => item >= windowStart && item <= date)
      .flatMap((item) => byDate.get(item) || []);
    if (!windowRows.length) continue;

    const totalTokens = sumTokens(windowRows);
    const top10Share = calcTop10Share(windowRows, totalTokens);
    const usDailyTokens = sumCountryTokens(byDate.get(date) || [], "us");
    const cnDailyTokens = sumCountryTokens(byDate.get(date) || [], "cn");
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
    if (usDailyTokens > 0) {
      usTokenHistory.push({
        date,
        value: usDailyTokens / 1e12,
        label: `${round1(usDailyTokens / 1e12)}T`,
        unit: "万亿/日"
      });
    }
    if (cnDailyTokens > 0) {
      cnTokenHistory.push({
        date,
        value: cnDailyTokens / 1e12,
        label: `${round1(cnDailyTokens / 1e12)}T`,
        unit: "万亿/日"
      });
    }
  }

  return {
    openrouter_tokens: keepRecent(tokenHistory, 92),
    openrouter_share: keepRecent(shareHistory, 92),
    openrouter_us_tokens: keepRecent(usTokenHistory, 92),
    openrouter_cn_tokens: keepRecent(cnTokenHistory, 92)
  };
}

async function backfillTrakTokenIndex() {
  const payload = await getJsonFetch("https://www.traktoken.com/api/index/history", {
    "User-Agent": "AI Monitor Mini Program"
  });
  const rows = Array.isArray(payload.data) ? payload.data : [];
  if (!rows.length) return {};
  const csv = await getTextFetch("https://www.traktoken.com/downloads/ttsi.csv", {
    "User-Agent": "AI Monitor Mini Program"
  });
  const csvRows = parseCsvRows(csv);

  return {
    llm_token_spend_index: keepRecent(rows.map((row) => ({
      date: row.date,
      value: Number(row.spend_price_usd_ma7 || row.spend_price_usd),
      label: `$${Number(row.spend_price_usd_ma7 || row.spend_price_usd).toFixed(2)}`,
      unit: "$/1M weighted"
    })).filter((row) => Number.isFinite(row.value)), 100),
    frontier_premium: keepRecent(rows.map((row) => ({
      date: row.date,
      value: Number(row.frontier_premium),
      label: `${Number(row.frontier_premium).toFixed(1)}x`,
      unit: "frontier / open-weight"
    })).filter((row) => Number.isFinite(row.value)), 100),
    free_token_share: keepRecent(csvRows.map((row) => ({
      date: row.date,
      value: Number(row.free_share) * 100,
      label: `${(Number(row.free_share) * 100).toFixed(1)}%`,
      unit: "free token share"
    })).filter((row) => Number.isFinite(row.value)), 100)
  };
}

function backfillRampAiIndex() {
  const headlineRows = readRampCsv("ramp-ai-index-headline.csv");
  const sectorRows = readRampCsv("ramp-ai-index-sector.csv");
  const modelRows = readRampCsv("ramp-ai-index-models.csv");
  const updates = {};

  const rampHeadline = headlineRows
    .filter((row) => row.series === "Ramp AI Index")
    .map((row) => rampHistoryPoint(row, "enterprise adoption"))
    .filter(Boolean);
  if (rampHeadline.length) {
    updates.ramp_enterprise_paid_ratio = dedupeHistory(rampHeadline);
    updates.ramp_ai_adoption = dedupeHistory(rampHeadline);
  }

  for (const sector of allRampNames(sectorRows, "sector")) {
    const id = `ramp_sector_${slugifyRampName(sector)}`;
    const records = sectorRows
      .filter((row) => row.sector === sector)
      .map((row) => rampHistoryPoint(row, sector))
      .filter(Boolean);
    if (records.length) updates[id] = dedupeHistory(records);
  }

  for (const company of allRampNames(modelRows, "model_company")) {
    const id = `ramp_model_${slugifyRampName(company)}`;
    const records = modelRows
      .filter((row) => row.model_company === company)
      .map((row) => rampHistoryPoint(row, company))
      .filter(Boolean);
    if (records.length) updates[id] = dedupeHistory(records);
  }

  return updates;
}

function allRampNames(rows, nameField) {
  return [...new Set(rows.map((row) => row[nameField]).filter(Boolean))].sort();
}

function dropRampHistory(history) {
  return Object.fromEntries(
    Object.entries(history).filter(([id]) => !id.startsWith("ramp_"))
  );
}

function slugifyRampName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function readRampCsv(fileName) {
  const filePath = path.join(rampDir, fileName);
  if (!fs.existsSync(filePath)) return [];
  return parseCsvRows(fs.readFileSync(filePath, "utf8"));
}

function rampHistoryPoint(row, unit) {
  const value = Number(row.adoption_rate_pct);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(row.date_month || "")) || !Number.isFinite(value)) return null;
  return {
    date: row.date_month,
    value,
    label: `${round1(value)}%`,
    unit
  };
}

async function backfillSacraArrMilestones() {
  const epochEntries = await backfillEpochRevenueReports();
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

    const epochRecords = epochEntries[company.id] || [];
    entries.push([company.id, dedupeHistory([...epochRecords, ...records])]);
  }

  const merged = { ...epochEntries, ...Object.fromEntries(entries) };
  return Object.fromEntries(Object.entries(merged).map(([id, records]) => [id, dedupeHistory(records)]));
}

function backfillChinaModelArrMilestones() {
  // Data rule: keep the longest public history we can verify. For listed peers,
  // earlier points may be reported revenue while newer points are ARR/run-rate;
  // labels and units preserve that distinction instead of forcing one false metric.
  return {
    minimax_arr: dedupeHistory([
      {
        date: "2022-12-31",
        value: 0,
        label: "$0",
        unit: "reported annual revenue",
        source: "HKEX prospectus"
      },
      {
        date: "2023-12-31",
        value: 3_460_000,
        label: "$3.46M",
        unit: "reported annual revenue",
        source: "HKEX prospectus"
      },
      {
        date: "2024-12-31",
        value: 30_523_000,
        label: "$30.52M",
        unit: "reported annual revenue",
        source: "HKEX prospectus"
      },
      {
        date: "2025-09-30",
        value: 53_437_000,
        label: "$53.44M",
        unit: "9M reported revenue",
        source: "HKEX prospectus"
      },
      {
        date: "2025-12-31",
        value: 79_038_000,
        label: "$79.04M",
        unit: "reported annual revenue",
        source: "MiniMax FY2025 results"
      },
      {
        date: "2026-02-01",
        value: 150_000_000,
        label: "$150M",
        unit: "annualized revenue",
        source: "company / media report"
      },
      {
        date: "2026-05-01",
        value: 300_000_000,
        label: "$300M",
        unit: "annualized revenue",
        source: "Sacra estimate"
      }
    ]),
    zhipu_arr: dedupeHistory([
      {
        date: "2022-12-31",
        value: 8_100_000,
        label: "RMB57.4M",
        unit: "reported annual revenue",
        source: "HKEX prospectus coverage"
      },
      {
        date: "2023-12-31",
        value: 17_500_000,
        label: "RMB124.5M",
        unit: "reported annual revenue",
        source: "HKEX prospectus coverage"
      },
      {
        date: "2024-12-31",
        value: 44_600_000,
        label: "RMB312.4M",
        unit: "reported annual revenue",
        source: "HKEX prospectus coverage"
      },
      {
        date: "2025-06-30",
        value: 27_300_000,
        label: "RMB190.9M",
        unit: "H1 reported revenue",
        source: "HKEX prospectus / Caixin Global coverage"
      },
      {
        date: "2025-12-31",
        value: 104_800_000,
        label: "RMB724.33M",
        unit: "reported annual revenue",
        source: "annual report coverage"
      },
      {
        date: "2026-03-31",
        value: 236_000_000,
        label: "RMB1.7B",
        unit: "MaaS API ARR",
        source: "company financial report coverage"
      },
      {
        date: "2026-07-16",
        value: 1_000_000_000,
        label: "$1.0B",
        unit: "reported ARR run-rate",
        source: "media report"
      }
    ]),
    kimi_arr: dedupeHistory([
      {
        date: "2026-03-01",
        value: 100_000_000,
        label: "$100M",
        unit: "reported ARR",
        source: "media report"
      },
      {
        date: "2026-04-15",
        value: 200_000_000,
        label: "$200M",
        unit: "reported ARR",
        source: "media report"
      },
      {
        date: "2026-06-15",
        value: 300_000_000,
        label: "$300M+",
        unit: "reported ARR",
        source: "media report"
      }
    ])
  };
}

async function backfillEpochRevenueReports() {
  const csv = await getTextFetch("https://epoch.ai/data/ai_companies_revenue_reports.csv", {
    "User-Agent": "AI Monitor Mini Program"
  });
  const rows = parseCsvRows(csv);
  const ids = {
    OpenAI: "openai_arr",
    Anthropic: "anthropic_arr"
  };
  const updates = {};

  for (const row of rows) {
    const id = ids[row.Company];
    const date = row.Date;
    const value = Number(row["Annualized revenue (USD)"] || row["Revenue amount (normalize to annual)"]);
    const scope = String(row.Scope || "");
    if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(value) || value <= 0) continue;
    if (scope && scope !== "Full company") continue;
    if (!updates[id]) updates[id] = [];
    updates[id].push({
      date,
      value,
      label: formatUsdBillions(value),
      unit: row["Annualized revenue type"] || "annualized revenue",
      source: row["Source 1"] || "Epoch AI"
    });
  }

  return Object.fromEntries(Object.entries(updates).map(([id, records]) => [id, dedupeHistory(records)]));
}

async function backfillSecCapex() {
  const userAgent = process.env.SEC_USER_AGENT || "AI Monitor Mini Program contact@example.com";
  const companies = [
    { id: "msft_capex", cik: "0000789019" },
    { id: "googl_capex", cik: "0001652044" },
    { id: "amzn_capex", cik: "0001018724" },
    { id: "meta_capex", cik: "0001326801" },
    { id: "orcl_capex", cik: "0001341439" }
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

async function backfillSecBig5CashFunding() {
  const userAgent = process.env.SEC_USER_AGENT || "AI Monitor Mini Program contact@example.com";
  const companies = [
    { name: "Microsoft", cik: "0000789019" },
    { name: "Alphabet", cik: "0001652044" },
    { name: "Amazon", cik: "0001018724" },
    { name: "Meta", cik: "0001326801" },
    { name: "Oracle", cik: "0001341439" }
  ];
  const capexByCompany = new Map();
  const ocfByCompany = new Map();
  const leverageByCompany = new Map();

  for (const company of companies) {
    capexByCompany.set(company.name, await fetchQuarterlyConcept(company.cik, [
      "PaymentsToAcquirePropertyPlantAndEquipment",
      "PaymentsToAcquireProductiveAssets",
      "PropertyPlantAndEquipmentAdditions"
    ], userAgent));
    ocfByCompany.set(company.name, await fetchQuarterlyConcept(company.cik, [
      "NetCashProvidedByUsedInOperatingActivities",
      "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"
    ], userAgent));
    const liabilities = await fetchInstantConcept(company.cik, ["Liabilities"], userAgent);
    const equity = await fetchInstantConcept(company.cik, [
      "StockholdersEquity",
      "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"
    ], userAgent);
    leverageByCompany.set(company.name, { liabilities, equity });
  }

  const quarterDates = [...new Set(companies.flatMap((company) => (capexByCompany.get(company.name) || []).map((row) => calendarQuarterEnd(row.end))))]
    .filter(Boolean)
    .sort()
    .slice(-8);
  const fcfRecords = [];
  const ratioRecords = [];
  for (const date of quarterDates) {
    let totalCapex = 0;
    let totalOcf = 0;
    let companyCount = 0;
    for (const company of companies) {
      const capex = valueInCalendarQuarter(capexByCompany.get(company.name), date);
      const ocf = valueInCalendarQuarter(ocfByCompany.get(company.name), date);
      if (capex > 0 && ocf > 0) companyCount += 1;
      totalCapex += capex;
      totalOcf += ocf;
    }
    if (companyCount < 4 || totalCapex <= 0 || totalOcf <= 0) continue;
    const fcf = totalOcf - totalCapex;
    const ratio = totalCapex / totalOcf * 100;
    fcfRecords.push({
      date,
      value: fcf,
      label: formatUsdBillions(fcf),
      unit: "OCF-CapEx"
    });
    ratioRecords.push({
      date,
      value: ratio,
      label: `${round1(ratio)}%`,
      unit: "CapEx / OCF"
    });
  }

  const leverageDates = [...new Set(companies.flatMap((company) => (leverageByCompany.get(company.name).liabilities || []).map((row) => calendarQuarterEnd(row.end))))]
    .filter(Boolean)
    .sort()
    .slice(-8);
  const leverageRecords = [];
  for (const date of leverageDates) {
    let totalLiabilities = 0;
    let totalEquity = 0;
    let companyCount = 0;
    for (const company of companies) {
      const rows = leverageByCompany.get(company.name);
      const liabilities = valueInCalendarQuarter(rows.liabilities, date);
      const equity = valueInCalendarQuarter(rows.equity, date);
      if (liabilities > 0 && equity > 0) companyCount += 1;
      totalLiabilities += liabilities;
      totalEquity += equity;
    }
    if (companyCount < 3 || totalLiabilities <= 0 || totalEquity <= 0) continue;
    const value = totalLiabilities / totalEquity * 100;
    leverageRecords.push({
      date,
      value,
      label: `${round1(value)}%`,
      unit: "liabilities/equity"
    });
  }

  return {
    hyperscaler_fcf: fcfRecords,
    hyperscaler_capex_ocf_ratio: ratioRecords,
    big5_debt_equity_ratio: leverageRecords
  };
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

async function backfillFredInvestmentGradeSpread() {
  const endDate = formatDate(new Date());
  const startDate = formatDate(addDays(new Date(), -140));
  const csv = await getTextFetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=BAMLC0A0CM&cosd=${startDate}&coed=${endDate}`, {
    "User-Agent": "AI Monitor Mini Program"
  });
  const records = parseFredCsv(csv)
    .slice(-110)
    .map((row) => ({
      date: row.date,
      value: row.value,
      label: `${round1(row.value)}ppt`,
      unit: "US IG OAS"
    }));

  return records.length ? { ig_credit_spread: records } : {};
}

async function backfillDataCenterConstruction() {
  const csv = await getTextFetch("https://ourworldindata.org/grapher/monthly-spending-data-center-us.csv", {
    "User-Agent": "AI Monitor Mini Program"
  });
  const rows = parseCsvRows(csv)
    .map((row) => {
      const value = Number(row["Monthly spending on data center construction in the United States"]);
      return {
        date: row.Day,
        value: value * 12 / 1e9,
        label: `$${round1(value * 12 / 1e9)}B`,
        unit: "annualized"
      };
    })
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && Number.isFinite(row.value));

  return rows.length ? { data_center_construction: keepRecent(rows, 370) } : {};
}

async function backfillTechFinanceEmploymentProxy() {
  const endDate = formatDate(new Date());
  const startDate = formatDate(addDays(new Date(), -420));
  const series = await Promise.all([
    fetchFredSeries("USINFO", startDate, endDate),
    fetchFredSeries("USFIRE", startDate, endDate),
    fetchFredSeries("CES6054000001", startDate, endDate)
  ]);
  const byDate = new Map();
  for (const rows of series) {
    for (const row of rows) {
      if (!byDate.has(row.date)) byDate.set(row.date, []);
      byDate.get(row.date).push(row.value);
    }
  }
  const raw = [...byDate.entries()]
    .filter(([, values]) => values.length === series.length)
    .map(([date, values]) => ({
      date,
      value: values.reduce((sum, value) => sum + value, 0) / 10
    }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (!raw.length) return {};

  const ciccCurrent = 1524.8;
  const scale = ciccCurrent / raw[raw.length - 1].value;
  const records = raw.map((row) => {
    const value = row.value * scale;
    return {
      date: row.date,
      value,
      label: round1(value),
      unit: "万人"
    };
  });

  return { tech_finance_employment: keepRecent(records, 370) };
}

async function fetchFredSeries(id, startDate, endDate) {
  const csv = await getTextFetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${startDate}&coed=${endDate}`, {
    "User-Agent": "AI Monitor Mini Program"
  });
  return parseFredCsv(csv);
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

async function fetchQuarterlyConcept(cik, concepts, userAgent) {
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
      // Some companies do not report every concept.
    }
  }
  return best;
}

async function fetchInstantConcept(cik, concepts, userAgent) {
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
      const records = dedupeByEndDate(rows
        .filter((row) => ["10-Q", "10-K"].includes(row.form) && Number.isFinite(Number(row.val)))
        .filter((row) => row.end)
        .map((row) => ({ ...row, val: Number(row.val) })));
      const latest = records.length ? records[records.length - 1].end : "";
      if (latest > bestLatest || (latest === bestLatest && records.length > best.length)) {
        best = records;
        bestLatest = latest;
      }
    } catch (error) {
      // Some companies do not report every concept.
    }
  }
  return best;
}

function intersectDates(seriesList) {
  if (!seriesList.length) return [];
  let dates = new Set((seriesList[0] || []).map((row) => row.end));
  for (const series of seriesList.slice(1)) {
    const current = new Set((series || []).map((row) => row.end));
    dates = new Set([...dates].filter((date) => current.has(date)));
  }
  return [...dates].filter(Boolean).sort();
}

function valueOnDate(series, date) {
  const row = (series || []).find((item) => item.end === date);
  return row ? Math.abs(Number(row.val || 0)) : 0;
}

function valueInCalendarQuarter(series, quarterEnd) {
  const row = (series || [])
    .filter((item) => calendarQuarterEnd(item.end) === quarterEnd)
    .sort((a, b) => String(b.filed || "").localeCompare(String(a.filed || "")))[0];
  return row ? Math.abs(Number(row.val || 0)) : 0;
}

function calendarQuarterEnd(date) {
  const year = Number(String(date || "").slice(0, 4));
  const month = Number(String(date || "").slice(5, 7));
  if (!year || !month) return "";
  const quarter = Math.ceil(month / 3);
  const endMonth = quarter * 3;
  const endDay = new Date(year, endMonth, 0).getDate();
  return `${year}-${pad(endMonth)}-${pad(endDay)}`;
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

function sumCountryTokens(rows, country) {
  return rows.reduce((sum, row) => {
    const model = row.model_permaslug || row.model || "";
    const provider = model.includes("/") ? model.split("/")[0] : "";
    return getProviderCountry(provider) === country ? sum + Number(row.total_tokens || 0) : sum;
  }, 0);
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

function parseCsvRows(csv) {
  const lines = String(csv)
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.startsWith("#"));
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((item) => item.trim());
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
  });
}

function splitCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\"" && quoted && next === "\"") {
      current += "\"";
      index += 1;
    } else if (char === "\"") {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
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
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function pad(value) {
  return String(value).padStart(2, "0");
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



