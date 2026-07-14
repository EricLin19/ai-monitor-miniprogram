const { metrics } = require("../../data/mockMetrics");
const { cacheMeta } = require("../../data/cacheMeta");
const { metricHistory } = require("../../data/metricHistory");

const SERIES_COLORS = ["#2563eb", "#15803d", "#b7791f", "#b42318", "#7c3aed"];

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
    metric: null,
    points: [],
    updatedAt: cacheMeta.updatedAt,
    windowLabel: "全历史趋势",
    historyLabel: "待积累",
    rangeStart: "--",
    rangeEnd: "--"
  },

  onLoad(options) {
    const id = decodeURIComponent(options.id || "");
    const metric = buildDetailMetric(id);
    if (!metric) {
      wx.showToast({ title: "指标不存在", icon: "none" });
      return;
    }

    const points = metric.series ? getLongestSeries(metric.series) : getAllHistoryPoints(metricHistory[id] || []);
    wx.setNavigationBarTitle({ title: metric.title });
    this.setData({
      metric,
      points,
      windowLabel: "全历史趋势",
      historyLabel: getHistoryLabel(points),
      rangeStart: points[0] ? points[0].date : "--",
      rangeEnd: points[points.length - 1] ? points[points.length - 1].date : "--"
    }, () => {
      drawDetailChart(this, metric);
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

function buildDetailMetric(id) {
  const synthetic = buildRampCompositeMetrics(metricHistory).find((item) => item.id === id);
  if (synthetic) return synthetic;
  const rawMetric = metrics.find((item) => item.id === id);
  if (!rawMetric) return null;
  return { ...rawMetric, ...(DISPLAY_OVERRIDES[id] || {}) };
}

function buildRampCompositeMetrics(history) {
  const total = getAllHistoryPoints(history.ramp_enterprise_paid_ratio || history.ramp_ai_adoption || []);
  const sectorSeries = buildSeries(history, "ramp_sector_", 4);
  const modelSeries = buildSeries(history, "ramp_model_", 4);
  const items = [];

  if (total.length) {
    items.push({
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
    items.push({
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
    items.push({
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

  return items;
}

function buildSeries(history, prefix, limit) {
  return Object.keys(history)
    .filter((id) => id.startsWith(prefix))
    .map((id) => ({ id, name: humanizeRampName(id.slice(prefix.length)), points: getAllHistoryPoints(history[id]) }))
    .filter((item) => item.points.length >= 10)
    .sort((a, b) => latestValue(b.points) - latestValue(a.points))
    .slice(0, limit)
    .map((item, index) => ({ ...item, color: SERIES_COLORS[index % SERIES_COLORS.length] }));
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

function drawDetailChart(page, metric) {
  const context = wx.createCanvasContext("detailChart", page);
  const series = metric.series || null;
  const points = series ? flattenSeries(series) : getAllHistoryPoints(metricHistory[metric.id] || []);
  const axisPoints = series ? getLongestSeries(series) : points;
  const width = 320;
  const height = 188;
  const leftPadding = 56;
  const rightPadding = 16;
  const topPadding = series ? 34 : 18;
  const bottomPadding = 30;

  context.clearRect(0, 0, width, height);

  if (!points.length) {
    context.setFillStyle("#9aa4af");
    context.setFontSize(13);
    context.fillText("waiting for history", leftPadding, 96);
    context.draw();
    return;
  }

  const values = points.map((item) => item.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const drawableWidth = width - leftPadding - rightPadding;
  const drawableHeight = height - topPadding - bottomPadding;

  drawAxis(context, axisPoints, min, max, leftPadding, topPadding, drawableWidth, drawableHeight, height);

  if (series) {
    drawLegend(context, series, leftPadding, 12);
    series.forEach((item) => {
      drawLine(context, item.points, min, max, leftPadding, topPadding, drawableWidth, drawableHeight, item.color, 2);
    });
  } else {
    const color = getTrendColor(metric.trend);
    drawLine(context, points, min, max, leftPadding, topPadding, drawableWidth, drawableHeight, color, 2.5);
    drawEndpointLabels(context, points, leftPadding, topPadding, drawableWidth, drawableHeight, min, max, color);
  }

  context.draw();
}

function drawAxis(context, points, min, max, leftPadding, topPadding, drawableWidth, drawableHeight, height) {
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

  getDateTicks(points).forEach((tick) => {
    const x = leftPadding + drawableWidth * tick.ratio;
    context.beginPath();
    context.moveTo(x, bottomY);
    context.lineTo(x, bottomY + 5);
    context.stroke();
    context.setFillStyle("#9aa4af");
    context.setFontSize(10);
    context.fillText(tick.label, Math.min(x, 286), height - 6);
  });
}

function drawLine(context, points, min, max, leftPadding, topPadding, drawableWidth, drawableHeight, color, lineWidth) {
  if (!points.length) return;
  const span = max - min || 1;
  const plotted = points.map((item, index) => {
    const ratioX = points.length === 1 ? 1 : index / (points.length - 1);
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
  context.arc(last.x, last.y, 4, 0, Math.PI * 2);
  context.fill();
  context.setFillStyle(color);
  context.beginPath();
  context.arc(last.x, last.y, 3, 0, Math.PI * 2);
  context.fill();
}

function drawLegend(context, series, x, y) {
  context.setFontSize(9);
  series.forEach((item, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const lx = x + col * 120;
    const ly = y + row * 12;
    context.setFillStyle(item.color);
    context.fillRect(lx, ly - 6, 8, 3);
    context.setFillStyle("#66707b");
    context.fillText(shortLabel(item.name), lx + 12, ly);
  });
}

function drawEndpointLabels(context, points, leftPadding, topPadding, drawableWidth, drawableHeight, min, max, color) {
  if (!points.length) return;
  const span = max - min || 1;
  const first = points[0];
  const last = points[points.length - 1];
  const firstY = topPadding + drawableHeight * (1 - (first.value - min) / span);
  const lastY = topPadding + drawableHeight * (1 - (last.value - min) / span);

  context.setFontSize(10);
  context.setFillStyle("#66707b");
  context.fillText(first.label || formatAxisValue(first.value), leftPadding - 28, Math.max(12, firstY - 8));
  context.setFillStyle(color);
  context.fillText(last.label || formatAxisValue(last.value), Math.min(250, leftPadding + drawableWidth - 24), Math.max(12, lastY - 8));
}

function getDateTicks(points) {
  if (!points.length) return [];
  const lastIndex = points.length - 1;
  const middleIndex = Math.floor(lastIndex / 2);
  return [0, middleIndex, lastIndex]
    .filter((index, pos, arr) => arr.indexOf(index) === pos)
    .map((index) => ({
      ratio: lastIndex === 0 ? 1 : index / lastIndex,
      label: formatDateTick(points[index].date)
    }));
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
