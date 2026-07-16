const { fetchMetrics } = require("../../services/metrics");

const MIN_HISTORY_POINTS = 10;
const SERIES_COLORS = ["#2563eb", "#15803d", "#b7791f", "#b42318", "#7c3aed"];

const HIDDEN_METRIC_IDS = new Set([
  "aa_value",
  "cloudflare_ai_bots",
  "nvda_dc_revenue",
  "ai_crowding_unwind",
  "hbm_dram_pressure",
  "ai_hardware_heat",
  "ai_downstream_odds",
  "agent_token_share",
  "ramp_enterprise_paid_ratio",
  "ramp_ai_adoption"
]);

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
  "orcl_capex",
  "ramp_total",
  "ramp_by_sector",
  "ramp_by_model"
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
  "ramp_total",
  "ramp_by_sector",
  "ramp_by_model",
  "llm_token_spend_index",
  "frontier_premium",
  "free_token_share",
  "token_arr_conversion",
  "ai_wage_pool_coverage",
  "ig_credit_spread",
  "tech_finance_employment",
  "data_center_construction",
  "tech_job_postings"
];

const METRIC_GROUP_KEYS = {
  demand: new Set([
    "openrouter_tokens",
    "openrouter_us_tokens",
    "openrouter_cn_tokens",
    "openrouter_share",
    "ramp_total",
    "ramp_by_sector",
    "ramp_by_model",
    "llm_token_spend_index",
    "frontier_premium",
    "free_token_share"
  ]),
  cash: new Set([
    "openai_arr",
    "anthropic_arr",
    "token_arr_conversion",
    "ai_wage_pool_coverage"
  ]),
  capex: new Set([
    "msft_capex",
    "googl_capex",
    "amzn_capex",
    "meta_capex",
    "orcl_capex",
    "data_center_construction"
  ]),
  funding: new Set(["ig_credit_spread"]),
  constraints: new Set(["tech_finance_employment", "tech_job_postings"])
};

const DISPLAY_OVERRIDES = {
  openrouter_tokens: { group: "① 需求", title: "OpenRouter 全平台 Token 使用量", cadence: "日/周", access: "自动" },
  openrouter_us_tokens: { group: "① 需求", title: "OpenRouter 美国模型 Token 使用量", cadence: "日/周", access: "自动" },
  openrouter_cn_tokens: { group: "① 需求", title: "OpenRouter 中国模型 Token 使用量", cadence: "日/周", access: "自动" },
  openrouter_share: { group: "① 需求", title: "OpenRouter 模型份额集中度", cadence: "日/周", access: "自动" },
  llm_token_spend_index: { group: "① 需求", title: "使用量加权 LLM Token 支出指数", cadence: "日", access: "自动" },
  frontier_premium: { group: "① 需求", title: "前沿闭源模型价格溢价", cadence: "日", access: "自动" },
  free_token_share: { group: "① 需求", title: "免费 Token 占比", cadence: "日", access: "自动" },
  openai_arr: { group: "② 现金流", title: "OpenAI ARR", cadence: "事件/月", access: "自动" },
  anthropic_arr: { group: "② 现金流", title: "Anthropic ARR", cadence: "事件/月", access: "自动" },
  token_arr_conversion: { group: "② 现金流", title: "Token 用量转 ARR 效率", cadence: "日/周", access: "自动" },
  ai_wage_pool_coverage: { group: "② 现金流", title: "AI 收入覆盖潜在工资池比例", cadence: "月", access: "自动" },
  msft_capex: { group: "③ CapEx", title: "Microsoft CapEx", cadence: "季", access: "自动" },
  googl_capex: { group: "③ CapEx", title: "Alphabet CapEx", cadence: "季", access: "自动" },
  amzn_capex: { group: "③ CapEx", title: "Amazon CapEx", cadence: "季", access: "自动" },
  meta_capex: { group: "③ CapEx", title: "Meta CapEx", cadence: "季", access: "自动" },
  orcl_capex: { group: "③ CapEx", title: "Oracle CapEx", cadence: "季", access: "自动" },
  data_center_construction: { group: "③ CapEx", title: "美国数据中心年化建筑额", cadence: "月", access: "半自动" },
  ig_credit_spread: { group: "④ 资金来源", title: "美国投资级信用债利差", cadence: "日", access: "自动" },
  tech_finance_employment: { group: "⑤ 外部约束", title: "美国科技和金融就业人数", cadence: "月", access: "半自动" },
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
    const rawMetrics = [...(data.metrics || []), ...buildRampCompositeMetrics(history)];
    const metrics = decorateMetrics(rawMetrics, history)
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

  openGuide() {
    wx.navigateTo({
      url: "/pages/guide/guide"
    });
  },

  openDetail(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({
      url: `/pages/detail/detail?id=${encodeURIComponent(id)}`
    });
  },

  drawVisibleCharts() {
    (this.data.visibleMetrics || []).forEach((metric) => {
      drawSparkline(this, metric);
    });
  }
});

function decorateMetrics(metrics, history) {
  return metrics
    .map((item) => {
      const displayItem = { ...item, ...(DISPLAY_OVERRIDES[item.id] || {}) };
      const chartPoints = displayItem.series ? [] : getAllHistoryPoints(history[item.id] || []);
      return {
        ...displayItem,
        groupKey: getMetricGroupKey(item.id),
        accessClass: getAccessClass(displayItem.access),
        canvasId: `chart_${item.id}`,
        chartPoints,
        windowLabel: "全历史趋势",
        historyLabel: getHistoryLabel(displayItem.series ? getLongestSeries(displayItem.series) : history[item.id] || [])
      };
    })
    .sort((a, b) => getMetricOrder(a.id) - getMetricOrder(b.id));
}

function buildRampCompositeMetrics(history) {
  const total = getAllHistoryPoints(history.ramp_enterprise_paid_ratio || history.ramp_ai_adoption || []);
  const sectorSeries = buildSeries(history, "ramp_sector_", 4);
  const modelSeries = buildSeries(history, "ramp_model_", 4);
  const metrics = [];

  if (total.length) {
    metrics.push({
      id: "ramp_total",
      group: "① 需求",
      title: "Ramp AI Index：企业 AI 采用率",
      value: total[total.length - 1].label || `${roundAxis(total[total.length - 1].value)}%`,
      unit: "企业采用率",
      change: `${total[0].date} → ${total[total.length - 1].date}`,
      trend: getTrend(total),
      cadence: "月",
      access: "本地CSV",
      source: "Ramp AI Index CSV",
      sourceUrl: "https://ramp.com/data/ai-index",
      note: "总指数：美国企业 AI 工具采用率，反映 AI 从试用走向预算化采购的速度。"
    });
  }

  if (sectorSeries.length) {
    metrics.push({
      id: "ramp_by_sector",
      group: "① 需求",
      title: "Ramp AI Index：Top4 行业采用率",
      value: latestSeriesSummary(sectorSeries),
      unit: "行业 Top4",
      change: seriesDateRange(sectorSeries),
      trend: getTrend(sectorSeries[0].points),
      cadence: "月",
      access: "本地CSV",
      source: "Ramp AI Index sector CSV",
      sourceUrl: "https://ramp.com/data/ai-index",
      note: `多线图：${sectorSeries.map((item) => item.name).join("、")}。看 AI 采用率是否从科技行业扩散到更多传统行业。`,
      series: sectorSeries
    });
  }

  if (modelSeries.length) {
    metrics.push({
      id: "ramp_by_model",
      group: "① 需求",
      title: "Ramp AI Index：Top4 模型公司份额",
      value: latestSeriesSummary(modelSeries),
      unit: "模型 Top4",
      change: seriesDateRange(modelSeries),
      trend: getTrend(modelSeries[0].points),
      cadence: "月",
      access: "本地CSV",
      source: "Ramp AI Index model CSV",
      sourceUrl: "https://ramp.com/data/ai-index",
      note: `多线图：${modelSeries.map((item) => item.name).join("、")}。看企业 AI 预算在 OpenAI、Anthropic、Google 等模型公司之间如何迁移。`,
      series: modelSeries
    });
  }

  return metrics;
}

function buildSeries(history, prefix, limit) {
  const byName = new Map();
  Object.keys(history)
    .filter((id) => id.startsWith(prefix))
    .forEach((id) => {
      const name = humanizeRampName(id.slice(prefix.length));
      const points = getAllHistoryPoints(history[id]);
      if (points.length < MIN_HISTORY_POINTS) return;
      const existing = byName.get(name);
      if (!existing || points.length > existing.points.length) {
        byName.set(name, { id, name, points });
      }
    });

  return [...byName.values()]
    .sort((a, b) => latestValue(b.points) - latestValue(a.points))
    .slice(0, limit)
    .map((item, index) => ({ ...item, color: SERIES_COLORS[index % SERIES_COLORS.length] }));
}

function shouldDisplayMetric(item, history) {
  if (!item || HIDDEN_METRIC_IDS.has(item.id)) return false;
  if (item.id.startsWith("ramp_sector_") || item.id.startsWith("ramp_model_")) return false;
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

function getAllHistoryPoints(records) {
  return (Array.isArray(records) ? records : [])
    .filter((item) => Number.isFinite(Number(item.value)) && item.date)
    .map((item) => ({
      date: item.date,
      value: Number(item.value),
      label: item.label || String(item.value)
    }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function getHistoryLabel(records) {
  const count = Array.isArray(records) ? records.length : 0;
  if (count <= 0) return "待积累";
  if (count === 1) return "1 个点";
  return `${count} 个点`;
}

function drawSparkline(page, metric) {
  const context = wx.createCanvasContext(metric.canvasId, page);
  const points = metric.series ? flattenSeries(metric.series) : metric.chartPoints;
  const width = 300;
  const height = 118;
  const leftPadding = 44;
  const rightPadding = 10;
  const topPadding = metric.series ? 28 : 12;
  const bottomPadding = 28;

  context.clearRect(0, 0, width, height);

  if (!points || !points.length) {
    context.setFillStyle("#9aa4af");
    context.setFontSize(11);
    context.fillText("waiting for history", leftPadding, 58);
    context.draw();
    return;
  }

  const values = points.map((item) => item.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const drawableWidth = width - leftPadding - rightPadding;
  const drawableHeight = height - topPadding - bottomPadding;
  const axisPoints = metric.series ? getLongestSeries(metric.series) : metric.chartPoints;
  const timeBounds = getTimeBounds(points);

  drawAxis(context, axisPoints, min, max, leftPadding, topPadding, drawableWidth, drawableHeight, height, timeBounds);

  if (metric.series) {
    drawLegend(context, metric.series, leftPadding, 8);
    metric.series.forEach((series) => {
      drawLine(context, series.points, min, max, leftPadding, topPadding, drawableWidth, drawableHeight, series.color, 1.6, timeBounds);
    });
  } else {
    drawLine(context, metric.chartPoints, min, max, leftPadding, topPadding, drawableWidth, drawableHeight, getTrendColor(metric.trend), 2, timeBounds);
  }

  context.draw();
}

function drawAxis(context, points, min, max, leftPadding, topPadding, drawableWidth, drawableHeight, height, timeBounds) {
  const bottomY = topPadding + drawableHeight;
  context.setStrokeStyle("#edf1f4");
  context.setLineWidth(1);
  [0, 0.5, 1].forEach((ratio) => {
    const y = topPadding + drawableHeight * ratio;
    context.beginPath();
    context.moveTo(leftPadding, y);
    context.lineTo(leftPadding + drawableWidth, y);
    context.stroke();
  });

  context.setFillStyle("#9aa4af");
  context.setFontSize(9);
  context.fillText(formatAxisValue(max), 2, topPadding + 4);
  context.fillText(formatAxisValue(min), 2, bottomY + 3);

  getDateTicks(timeBounds).forEach((tick) => {
    const x = leftPadding + drawableWidth * tick.ratio;
    context.beginPath();
    context.moveTo(x, bottomY);
    context.lineTo(x, bottomY + 4);
    context.stroke();
    context.setTextAlign(tick.align);
    context.fillText(tick.label, x, height - 12);
    context.setTextAlign("left");
  });
}

function drawLine(context, points, min, max, leftPadding, topPadding, drawableWidth, drawableHeight, color, lineWidth, timeBounds) {
  if (!points.length) return;
  const span = max - min || 1;
  const plotted = points.map((item) => {
    const ratioX = pointTimeRatio(item, timeBounds);
    const ratioY = (item.value - min) / span;
    return {
      x: leftPadding + drawableWidth * ratioX,
      y: topPadding + drawableHeight * (1 - ratioY)
    };
  });

  context.setStrokeStyle(color);
  context.setLineWidth(lineWidth);
  context.beginPath();
  plotted.forEach((point, index) => {
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
  if (plotted.length === 1) context.lineTo(leftPadding + drawableWidth, plotted[0].y);
  context.stroke();

  const last = plotted[plotted.length - 1];
  context.setFillStyle("#ffffff");
  context.beginPath();
  context.arc(last.x, last.y, 3, 0, Math.PI * 2);
  context.fill();
  context.setFillStyle(color);
  context.beginPath();
  context.arc(last.x, last.y, 2.5, 0, Math.PI * 2);
  context.fill();
}

function drawLegend(context, series, x, y) {
  context.setFontSize(8);
  series.forEach((item, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const lx = x + col * 118;
    const ly = y + row * 10;
    context.setFillStyle(item.color);
    context.fillRect(lx, ly - 5, 7, 2);
    context.setFillStyle("#66707b");
    context.fillText(shortLabel(item.name), lx + 10, ly);
  });
}

function getDateTicks(timeBounds) {
  if (!timeBounds || !Number.isFinite(timeBounds.start) || !Number.isFinite(timeBounds.end)) return [];
  if (timeBounds.start === timeBounds.end) {
    return [{ ratio: 1, label: formatDateTickFromTime(timeBounds.end), align: "right" }];
  }
  const mid = timeBounds.start + (timeBounds.end - timeBounds.start) / 2;
  return [
    { ratio: 0, label: formatDateTickFromTime(timeBounds.start), align: "left" },
    { ratio: 0.5, label: formatDateTickFromTime(mid), align: "center" },
    { ratio: 1, label: formatDateTickFromTime(timeBounds.end), align: "right" }
  ];
}

function flattenSeries(series) {
  return series.flatMap((item) => item.points || []);
}

function getLongestSeries(series) {
  return [...(series || [])].sort((a, b) => (b.points || []).length - (a.points || []).length)[0]?.points || [];
}

function latestValue(points) {
  return points.length ? Number(points[points.length - 1].value) : -Infinity;
}

function latestSeriesSummary(series) {
  if (!series.length) return "--";
  const first = series[0];
  const latest = first.points[first.points.length - 1];
  return `${first.name} ${latest ? latest.label : "--"}`;
}

function seriesDateRange(series) {
  const points = getLongestSeries(series);
  if (!points.length) return "--";
  return `${points[0].date} → ${points[points.length - 1].date}`;
}

function getTrend(points) {
  if (!points || points.length < 2) return "flat";
  const first = points[0].value;
  const last = points[points.length - 1].value;
  if (last > first) return "up";
  if (last < first) return "down";
  return "flat";
}

function getTrendColor(trend) {
  if (trend === "up") return "#15803d";
  if (trend === "down") return "#b42318";
  return "#2563eb";
}

function humanizeRampName(slug) {
  const names = {
    technology_media: "科技媒体",
    technology_and_media: "科技媒体",
    finance_insurance: "金融保险",
    finance_and_insurance: "金融保险",
    manufacturing: "制造业",
    retail: "零售",
    health_care: "医疗健康",
    construction: "建筑",
    accommodation_and_food_services: "住宿餐饮",
    openai: "OpenAI",
    anthropic: "Anthropic",
    google: "Google",
    deepseek: "DeepSeek",
    xai: "xAI"
  };
  return names[slug] || slug.replace(/_/g, " ");
}

function shortLabel(label) {
  return String(label || "").length > 8 ? `${String(label).slice(0, 8)}…` : String(label || "");
}

function formatDateTick(date) {
  const raw = String(date || "");
  if (raw.length >= 7) return raw.slice(2, 7);
  return raw;
}

function getTimeBounds(points) {
  const times = (points || [])
    .map((point) => Date.parse(`${point.date}T00:00:00`))
    .filter((time) => Number.isFinite(time));
  if (!times.length) return { start: NaN, end: NaN };
  return { start: Math.min(...times), end: Math.max(...times) };
}

function pointTimeRatio(point, timeBounds) {
  const time = Date.parse(`${point.date}T00:00:00`);
  if (!Number.isFinite(time) || !timeBounds || timeBounds.start === timeBounds.end) return 1;
  return (time - timeBounds.start) / (timeBounds.end - timeBounds.start);
}

function formatDateTickFromTime(time) {
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return "--";
  const year = String(date.getFullYear()).slice(2);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function formatAxisValue(value) {
  const abs = Math.abs(Number(value));
  if (!Number.isFinite(abs)) return "--";
  if (abs >= 1e12) return `${roundAxis(value / 1e12)}T`;
  if (abs >= 1e9) return `${roundAxis(value / 1e9)}B`;
  if (abs >= 1e6) return `${roundAxis(value / 1e6)}M`;
  if (abs >= 1e3) return `${roundAxis(value / 1e3)}K`;
  return roundAxis(value);
}

function roundAxis(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  if (Math.abs(number) >= 100) return String(Math.round(number));
  if (Math.abs(number) >= 10) return number.toFixed(1).replace(/\.0$/, "");
  return number.toFixed(2).replace(/\.?0+$/, "");
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
