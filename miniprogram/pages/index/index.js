const { fetchMetrics } = require("../../services/metrics");

const HIDDEN_METRIC_IDS = new Set([
  "aa_value",
  "cloudflare_ai_bots",
  "nvda_dc_revenue",
  "ai_crowding_unwind",
  "hbm_dram_pressure",
  "ai_hardware_heat",
  "ai_downstream_odds",
  "agent_token_share"
]);

const MIN_HISTORY_POINTS = 10;

const PRIORITY_METRIC_IDS = new Set([
  "openrouter_tokens",
  "openrouter_us_tokens",
  "openrouter_cn_tokens",
  "openrouter_share",
  "openai_arr",
  "anthropic_arr",
  "msft_capex",
  "googl_capex",
  "amzn_capex",
  "meta_capex",
  "orcl_capex"
]);

const METRIC_ORDER = [
  "openrouter_tokens",
  "openrouter_us_tokens",
  "openrouter_cn_tokens",
  "openrouter_share",
  "openai_arr",
  "anthropic_arr",
  "msft_capex",
  "googl_capex",
  "amzn_capex",
  "meta_capex",
  "orcl_capex",
  "llm_token_spend_index",
  "frontier_premium",
  "free_token_share",
  "ramp_enterprise_paid_ratio",
  "ramp_ai_adoption",
  "ramp_sector_technology_media",
  "ramp_sector_finance_insurance",
  "ramp_model_openai",
  "ramp_model_anthropic",
  "ramp_model_google",
  "ramp_model_deepseek",
  "ramp_model_xai",
  "token_arr_conversion",
  "ai_wage_pool_coverage",
  "ig_credit_spread",
  "tech_finance_employment",
  "data_center_construction",
  "tech_job_postings",
  "aa_us_score",
  "aa_cn_score",
  "silicon_token_expenditure",
  "openai_app_revenue",
  "anthropic_app_revenue",
  "hyperscaler_cloud_revenue",
  "hyperscaler_fcf",
  "hyperscaler_capex_ocf_ratio",
  "big5_debt_equity_ratio",
  "big5_bond_issuance",
  "big5_cds",
  "silicon_vc_confidence",
  "ai_risk_investment",
  "tech_finance_layoff_share",
  "api_price_index",
  "gpu_rental_price",
  "revenue_per_gpu",
  "ai_capex_roi"
];

const METRIC_GROUP_KEYS = {
  demand: new Set([
    "openrouter_tokens",
    "openrouter_us_tokens",
    "openrouter_cn_tokens",
    "openrouter_share",
    "llm_token_spend_index",
    "frontier_premium",
    "free_token_share",
    "ramp_enterprise_paid_ratio",
    "ramp_ai_adoption",
    "ramp_sector_technology_media",
    "ramp_sector_finance_insurance",
    "ramp_model_openai",
    "ramp_model_anthropic",
    "ramp_model_google",
    "ramp_model_deepseek",
    "ramp_model_xai",
    "aa_us_score",
    "aa_cn_score",
    "silicon_token_expenditure"
  ]),
  cash: new Set([
    "openai_arr",
    "anthropic_arr",
    "token_arr_conversion",
    "ai_wage_pool_coverage",
    "openai_app_revenue",
    "anthropic_app_revenue",
    "hyperscaler_cloud_revenue",
    "hyperscaler_fcf",
    "hyperscaler_capex_ocf_ratio"
  ]),
  capex: new Set([
    "msft_capex",
    "googl_capex",
    "amzn_capex",
    "meta_capex",
    "orcl_capex",
    "data_center_construction"
  ]),
  funding: new Set([
    "big5_debt_equity_ratio",
    "big5_bond_issuance",
    "big5_cds",
    "ig_credit_spread",
    "silicon_vc_confidence",
    "ai_risk_investment"
  ]),
  constraints: new Set([
    "tech_finance_employment",
    "tech_finance_layoff_share",
    "tech_job_postings"
  ])
};

const DISPLAY_OVERRIDES = {
  openrouter_tokens: { group: "① 需求", title: "OpenRouter 全平台 Token 使用量", cadence: "日/周", access: "自动" },
  openrouter_us_tokens: { group: "① 需求", title: "OpenRouter 美国模型 Token 使用量", cadence: "日/周", access: "自动" },
  openrouter_cn_tokens: { group: "① 需求", title: "OpenRouter 中国模型 Token 使用量", cadence: "日/周", access: "自动" },
  openrouter_share: { group: "① 需求", title: "OpenRouter 模型份额集中度", cadence: "日/周", access: "自动" },
  llm_token_spend_index: { group: "① 需求", title: "使用量加权 LLM Token 支出指数", cadence: "日", access: "自动" },
  frontier_premium: { group: "① 需求", title: "前沿闭源模型价格溢价", cadence: "日", access: "自动" },
  free_token_share: { group: "① 需求", title: "免费 Token 占比", cadence: "日", access: "自动" },
  ramp_enterprise_paid_ratio: { group: "① 需求", title: "Ramp：美国企业 AI 付费/采用率", cadence: "月", access: "本地CSV" },
  ramp_ai_adoption: { group: "① 需求", title: "Ramp AI Index：企业 AI 采用率", cadence: "月", access: "本地CSV" },
  ramp_sector_technology_media: { group: "① 需求", title: "Ramp：科技与媒体行业 AI 采用率", cadence: "月", access: "本地CSV" },
  ramp_sector_finance_insurance: { group: "① 需求", title: "Ramp：金融保险行业 AI 采用率", cadence: "月", access: "本地CSV" },
  ramp_model_openai: { group: "① 需求", title: "Ramp：OpenAI 企业支出份额", cadence: "月", access: "本地CSV" },
  ramp_model_anthropic: { group: "① 需求", title: "Ramp：Anthropic 企业支出份额", cadence: "月", access: "本地CSV" },
  ramp_model_google: { group: "① 需求", title: "Ramp：Google 企业支出份额", cadence: "月", access: "本地CSV" },
  ramp_model_deepseek: { group: "① 需求", title: "Ramp：DeepSeek 企业支出份额", cadence: "月", access: "本地CSV" },
  ramp_model_xai: { group: "① 需求", title: "Ramp：xAI 企业支出份额", cadence: "月", access: "本地CSV" },
  openai_arr: { group: "② 现金流", title: "OpenAI ARR", cadence: "事件/月", access: "自动" },
  anthropic_arr: { group: "② 现金流", title: "Anthropic ARR", cadence: "事件/月", access: "自动" },
  token_arr_conversion: { group: "② 现金流", title: "Token 用量转 ARR 效率", cadence: "日/周", access: "自动" },
  ai_wage_pool_coverage: { group: "② 现金流", title: "AI 收入覆盖潜在工资池比例", cadence: "月", access: "自动" },
  msft_capex: { group: "③ CapEx", title: "Microsoft CapEx", cadence: "季", access: "自动" },
  googl_capex: { group: "③ CapEx", title: "Alphabet CapEx", cadence: "季", access: "自动" },
  amzn_capex: { group: "③ CapEx", title: "Amazon CapEx", cadence: "季", access: "自动" },
  meta_capex: { group: "③ CapEx", title: "Meta CapEx", cadence: "季", access: "自动" },
  orcl_capex: { group: "③ CapEx", title: "Oracle CapEx", cadence: "季", access: "自动" },
  ig_credit_spread: { group: "④ 资金来源", title: "美国投资级信用债利差", cadence: "日", access: "自动" },
  tech_finance_employment: { group: "⑤ 外部约束", title: "美国科技和金融就业人数", cadence: "月", access: "半自动" },
  data_center_construction: { group: "③ CapEx", title: "美国数据中心年化建筑额", cadence: "月", access: "半自动" },
  tech_job_postings: { group: "⑤ 外部约束", title: "美国软件开发招聘指数", cadence: "周", access: "自动" }
};

Page({
  data: {
    metrics: [],
    history: {},
    visibleMetrics: [],
    displayMetricCount: 0,
    activeGroup: "all",
    keyword: "",
    updatedAt: "--",
    source: "mock",
    errorMessage: "",
    loading: false,
    healthLabel: "待接入",
    healthClass: "neutral"
  },

  onLoad() {
    this.loadMetrics();
  },

  async loadMetrics() {
    this.setData({ loading: true });
    const data = await fetchMetrics();
    const history = data.history || {};
    const metrics = decorateMetrics(data.metrics || [], history)
      .filter((item) => shouldDisplayMetric(item, history));

    this.setData({
      metrics,
      history,
      displayMetricCount: metrics.length,
      updatedAt: data.updatedAt || "--",
      source: data.source || "mock",
      errorMessage: buildErrorMessage(data),
      loading: false,
      healthLabel: calcHealth(metrics),
      healthClass: calcHealthClass(metrics)
    });
    this.applyFilters();
  },

  onSearch(event) {
    this.setData({ keyword: event.detail.value || "" });
    this.applyFilters();
  },

  changeGroup(event) {
    this.setData({ activeGroup: event.currentTarget.dataset.group });
    this.applyFilters();
  },

  applyFilters() {
    const keyword = this.data.keyword.trim().toLowerCase();
    const group = this.data.activeGroup;
    const visibleMetrics = this.data.metrics.filter((item) => {
      const groupMatched = group === "all" || item.groupKey === group;
      const haystack = `${item.title} ${item.group} ${item.source} ${item.note}`.toLowerCase();
      const keywordMatched = !keyword || haystack.includes(keyword);
      return groupMatched && keywordMatched;
    });
    this.setData({ visibleMetrics }, () => {
      this.drawVisibleCharts();
    });
  },

  noop() {},

  openDetail(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({
      url: `/pages/detail/detail?id=${encodeURIComponent(id)}`
    });
  },

  drawVisibleCharts() {
    (this.data.visibleMetrics || []).forEach((metric) => {
      drawSparkline(this, metric.canvasId, metric.chartPoints, metric.trend);
    });
  }
});

function decorateMetrics(metrics, history) {
  return metrics
    .map((item) => {
      const displayItem = { ...item, ...(DISPLAY_OVERRIDES[item.id] || {}) };
      return {
        ...displayItem,
        groupKey: getMetricGroupKey(item.id),
        accessClass: getAccessClass(displayItem.access),
        canvasId: `chart_${item.id}`,
        chartPoints: getWindowedHistory(displayItem, history[item.id] || []),
        windowLabel: getWindowLabel(displayItem),
        historyLabel: getHistoryLabel(history[item.id] || [])
      };
    })
    .sort((a, b) => getMetricOrder(a.id) - getMetricOrder(b.id));
}

function shouldDisplayMetric(item, history) {
  if (!item || HIDDEN_METRIC_IDS.has(item.id)) return false;
  if (PRIORITY_METRIC_IDS.has(item.id)) return true;
  const records = history[item.id] || [];
  return Array.isArray(records) && records.length >= MIN_HISTORY_POINTS;
}

function getMetricGroupKey(id) {
  for (const [key, ids] of Object.entries(METRIC_GROUP_KEYS)) {
    if (ids.has(id)) return key;
  }
  return "other";
}

function getMetricOrder(id) {
  const index = METRIC_ORDER.indexOf(id);
  return index >= 0 ? index : 999;
}

function getAccessClass(access) {
  const value = String(access || "").toLowerCase();
  if (value.includes("自动") || value.includes("csv")) return "auto";
  if (value.includes("手动")) return "manual";
  return "semi";
}

function getWindowedHistory(metric, records) {
  const days = isLongWindowMetric(metric) ? 1100 : isQuarterlyMetric(metric) ? 370 : 92;
  const cutoff = addDays(new Date(), -days);
  return records
    .filter((item) => {
      const date = new Date(`${item.date}T00:00:00`);
      return !Number.isNaN(date.getTime()) && date >= cutoff && Number.isFinite(Number(item.value));
    })
    .map((item) => ({
      date: item.date,
      value: Number(item.value),
      label: item.label || String(item.value)
    }));
}

function getWindowLabel(metric) {
  if (isLongWindowMetric(metric)) return "近三年趋势";
  return isQuarterlyMetric(metric) ? "近一年趋势" : "近三个月趋势";
}

function getHistoryLabel(records) {
  const count = Array.isArray(records) ? records.length : 0;
  if (count <= 0) return "待积累";
  if (count === 1) return "1 个点";
  return `${count} 个点`;
}

function isQuarterlyMetric(metric) {
  return [
    "msft_capex",
    "googl_capex",
    "amzn_capex",
    "meta_capex",
    "orcl_capex",
    "openai_arr",
    "anthropic_arr",
    "hyperscaler_capex_ocf_ratio",
    "ai_capex_roi"
  ].includes(metric.id);
}

function isLongWindowMetric(metric) {
  return ["openai_arr", "anthropic_arr"].includes(metric.id);
}

function drawSparkline(page, canvasId, points, trend) {
  const context = wx.createCanvasContext(canvasId, page);
  const width = 300;
  const height = 76;
  const padding = 10;
  const labelHeight = 14;
  const color = trend === "up" ? "#15803d" : trend === "down" ? "#b42318" : "#2563eb";

  context.clearRect(0, 0, width, height);
  context.setStrokeStyle("#edf1f4");
  context.setLineWidth(1);
  context.beginPath();
  context.moveTo(0, height - 14);
  context.lineTo(width, height - 14);
  context.stroke();

  if (!points || !points.length) {
    context.setFillStyle("#9aa4af");
    context.setFontSize(11);
    context.fillText("waiting for history", padding, 42);
    context.draw();
    return;
  }

  const values = points.map((item) => item.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const drawableWidth = width - padding * 2;
  const drawableHeight = height - padding * 2 - labelHeight;
  const plotted = points.map((item, index) => {
    const ratioX = points.length === 1 ? 1 : index / (points.length - 1);
    const ratioY = (item.value - min) / span;
    return {
      x: padding + drawableWidth * ratioX,
      y: padding + drawableHeight * (1 - ratioY)
    };
  });

  context.setStrokeStyle(color);
  context.setLineWidth(2);
  context.beginPath();
  plotted.forEach((point, index) => {
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
  if (plotted.length === 1) {
    context.lineTo(width - padding, plotted[0].y);
  }
  context.stroke();

  const last = plotted[plotted.length - 1];
  context.setFillStyle(color);
  context.beginPath();
  context.arc(last.x, last.y, 3, 0, Math.PI * 2);
  context.fill();

  drawMonthTicks(context, points, padding, drawableWidth, height);
  context.draw();
}

function drawMonthTicks(context, points, padding, drawableWidth, height) {
  const ticks = getMonthTicks(points);
  if (!ticks.length) return;
  context.setFillStyle("#9aa4af");
  context.setFontSize(9);
  ticks.forEach((tick) => {
    const ratio = points.length === 1 ? 1 : tick.index / (points.length - 1);
    const x = padding + drawableWidth * ratio;
    context.fillText(tick.label, Math.min(x, 278), height - 2);
  });
}

function getMonthTicks(points) {
  const ticks = [];
  let lastMonth = "";
  points.forEach((point, index) => {
    const date = String(point.date || "");
    const month = date.slice(5, 7);
    if (!month || month === lastMonth) return;
    lastMonth = month;
    ticks.push({ index, label: date.slice(5, 10) || month });
  });
  return ticks.slice(-4);
}

function calcHealth(metrics) {
  const emptyValues = new Set(["待接入", "手动", "报告", "季报", "待填", "待建模"]);
  const liveCount = metrics.filter((item) => item.value && !emptyValues.has(item.value)).length;
  if (liveCount >= 10) return "核心在线";
  if (liveCount >= 6) return "观察";
  return "待接入";
}

function calcHealthClass(metrics) {
  const label = calcHealth(metrics);
  if (label === "核心在线") return "strong";
  if (label === "观察") return "watch";
  return "neutral";
}

function buildErrorMessage(data) {
  if (data.errorMessage) return data.errorMessage;
  if (Array.isArray(data.errors) && data.errors.length) return data.errors.join("；");
  if (data.source === "mock") return "当前显示 mock 数据，说明云函数未返回实时指标。";
  return "";
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}
