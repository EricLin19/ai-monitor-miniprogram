const { fetchMetrics } = require("../../services/metrics");

const HIDDEN_METRIC_IDS = new Set([
  "aa_value",
  "cloudflare_ai_bots",
  "ramp_ai_adoption",
  "nvda_dc_revenue",
  "ai_crowding_unwind",
  "hbm_dram_pressure",
  "ai_hardware_heat",
  "ai_downstream_odds",
  "agent_token_share"
]);

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
      .filter((item) => !HIDDEN_METRIC_IDS.has(item.id));

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
      const groupMatched = group === "all" || item.group === group;
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
  return metrics.map((item) => ({
    ...item,
    accessClass: getAccessClass(item.access),
    canvasId: `chart_${item.id}`,
    chartPoints: getWindowedHistory(item, history[item.id] || []),
    windowLabel: getWindowLabel(item),
    historyLabel: getHistoryLabel(history[item.id] || [])
  }));
}

function getAccessClass(access) {
  const value = String(access || "");
  if (value.includes("自动") || value.includes("鑷")) return "auto";
  if (value.includes("手动") || value.includes("鎵")) return "manual";
  return "semi";
}

function getWindowedHistory(metric, records) {
  const days = isQuarterlyMetric(metric) ? 370 : 92;
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
  return isQuarterlyMetric(metric) ? "近一年趋势" : "近三个月趋势";
}

function getHistoryLabel(records) {
  const count = Array.isArray(records) ? records.length : 0;
  if (count <= 0) return "待累积";
  if (count === 1) return "1 个点";
  return `${count} 个点`;
}

function isQuarterlyMetric(metric) {
  return [
    "msft_capex",
    "googl_capex",
    "amzn_capex",
    "meta_capex",
    "ai_capex_roi"
  ].includes(metric.id);
}

function drawSparkline(page, canvasId, points, trend) {
  const context = wx.createCanvasContext(canvasId, page);
  const width = 300;
  const height = 76;
  const padding = 10;
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
  const drawableHeight = height - padding * 2 - 8;
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
  context.draw();
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
