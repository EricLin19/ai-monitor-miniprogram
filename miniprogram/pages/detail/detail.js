const { metrics } = require("../../data/mockMetrics");
const { cacheMeta } = require("../../data/cacheMeta");
const { metricHistory } = require("../../data/metricHistory");

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
    metric: null,
    points: [],
    updatedAt: cacheMeta.updatedAt,
    windowLabel: "近三个月趋势",
    historyLabel: "待积累",
    rangeStart: "--",
    rangeEnd: "--"
  },

  onLoad(options) {
    const id = decodeURIComponent(options.id || "");
    const rawMetric = metrics.find((item) => item.id === id);
    if (!rawMetric) {
      wx.showToast({ title: "指标不存在", icon: "none" });
      return;
    }

    const metric = { ...rawMetric, ...(DISPLAY_OVERRIDES[id] || {}) };
    const points = getWindowedHistory(metric, metricHistory[id] || []);
    wx.setNavigationBarTitle({ title: metric.title });
    this.setData({
      metric,
      points,
      windowLabel: getWindowLabel(metric),
      historyLabel: getHistoryLabel(metricHistory[id] || []),
      rangeStart: points[0] ? points[0].date : "--",
      rangeEnd: points[points.length - 1] ? points[points.length - 1].date : "--"
    }, () => {
      drawDetailChart(this, points, metric.trend);
    });
  },

  copySource() {
    const metric = this.data.metric;
    if (!metric || !metric.sourceUrl) return;

    wx.setClipboardData({
      data: metric.sourceUrl,
      success() {
        wx.showToast({ title: "来源链接已复制", icon: "none" });
      }
    });
  }
});

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
    "nvda_dc_revenue",
    "openai_arr",
    "anthropic_arr",
    "hyperscaler_capex_ocf_ratio",
    "ai_capex_roi"
  ].includes(metric.id);
}

function isLongWindowMetric(metric) {
  return ["openai_arr", "anthropic_arr"].includes(metric.id);
}

function drawDetailChart(page, points, trend) {
  const context = wx.createCanvasContext("detailChart", page);
  const width = 320;
  const height = 176;
  const leftPadding = 54;
  const rightPadding = 16;
  const topPadding = 18;
  const bottomPadding = 28;
  const color = trend === "up" ? "#15803d" : trend === "down" ? "#b42318" : "#2563eb";

  context.clearRect(0, 0, width, height);

  if (!points || !points.length) {
    context.setFillStyle("#9aa4af");
    context.setFontSize(13);
    context.fillText("waiting for history", leftPadding, 88);
    context.draw();
    return;
  }

  const values = points.map((item) => item.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const drawableWidth = width - leftPadding - rightPadding;
  const drawableHeight = height - topPadding - bottomPadding;

  drawDetailAxis(context, points, min, max, leftPadding, topPadding, drawableWidth, drawableHeight, height);

  const plotted = points.map((item, index) => {
    const ratioX = points.length === 1 ? 1 : index / (points.length - 1);
    const ratioY = (item.value - min) / span;
    return {
      x: leftPadding + drawableWidth * ratioX,
      y: topPadding + drawableHeight * (1 - ratioY)
    };
  });

  context.setStrokeStyle(color);
  context.setLineWidth(2.5);
  context.beginPath();
  plotted.forEach((point, index) => {
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
  if (plotted.length === 1) {
    context.lineTo(width - rightPadding, plotted[0].y);
  }
  context.stroke();

  plotted.forEach((point, index) => {
    if (index !== plotted.length - 1 && index !== 0) return;
    context.setFillStyle("#ffffff");
    context.beginPath();
    context.arc(point.x, point.y, 4, 0, Math.PI * 2);
    context.fill();
    context.setFillStyle(color);
    context.beginPath();
    context.arc(point.x, point.y, 3, 0, Math.PI * 2);
    context.fill();
  });

  drawEndpointLabels(context, points, plotted, color);
  context.draw();
}

function drawDetailAxis(context, points, min, max, leftPadding, topPadding, drawableWidth, drawableHeight, height) {
  const bottomY = topPadding + drawableHeight;
  const mid = min + (max - min) / 2;

  context.setStrokeStyle("#edf1f4");
  context.setLineWidth(1);
  [
    { ratio: 0, value: max },
    { ratio: 0.5, value: mid },
    { ratio: 1, value: min }
  ].forEach((tick) => {
    const y = topPadding + drawableHeight * tick.ratio;
    context.beginPath();
    context.moveTo(leftPadding, y);
    context.lineTo(leftPadding + drawableWidth, y);
    context.stroke();
    context.setFillStyle("#66707b");
    context.setFontSize(10);
    context.fillText(formatAxisValue(tick.value), 2, y + 3);
  });

  const ticks = getMonthTicks(points);
  context.setFillStyle("#9aa4af");
  context.setFontSize(10);
  ticks.forEach((tick) => {
    const ratio = points.length === 1 ? 1 : tick.index / (points.length - 1);
    const x = leftPadding + drawableWidth * ratio;
    context.beginPath();
    context.moveTo(x, bottomY);
    context.lineTo(x, bottomY + 4);
    context.stroke();
    context.fillText(tick.label, Math.min(x, 288), height - 5);
  });
}

function drawEndpointLabels(context, points, plotted, color) {
  if (!points.length || !plotted.length) return;
  const first = plotted[0];
  const last = plotted[plotted.length - 1];
  context.setFillStyle("#66707b");
  context.setFontSize(10);
  context.fillText(points[0].label || formatAxisValue(points[0].value), Math.max(2, first.x - 28), Math.max(12, first.y - 8));
  context.setFillStyle(color);
  context.fillText(points[points.length - 1].label || formatAxisValue(points[points.length - 1].value), Math.min(250, last.x - 20), Math.max(12, last.y - 8));
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
  return ticks.slice(-6);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
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
