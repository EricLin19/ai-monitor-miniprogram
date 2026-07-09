const { metrics } = require("../../data/mockMetrics");
const { cacheMeta } = require("../../data/cacheMeta");
const { metricHistory } = require("../../data/metricHistory");

Page({
  data: {
    metric: null,
    points: [],
    updatedAt: cacheMeta.updatedAt,
    windowLabel: "近三个月趋势",
    historyLabel: "待累积",
    rangeStart: "--",
    rangeEnd: "--"
  },

  onLoad(options) {
    const id = decodeURIComponent(options.id || "");
    const metric = metrics.find((item) => item.id === id);
    if (!metric) {
      wx.showToast({ title: "指标不存在", icon: "none" });
      return;
    }

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
    "nvda_dc_revenue",
    "ai_capex_roi"
  ].includes(metric.id);
}

function drawDetailChart(page, points, trend) {
  const context = wx.createCanvasContext("detailChart", page);
  const width = 320;
  const height = 150;
  const padding = 18;
  const color = trend === "up" ? "#15803d" : trend === "down" ? "#b42318" : "#2563eb";

  context.clearRect(0, 0, width, height);
  context.setStrokeStyle("#edf1f4");
  context.setLineWidth(1);
  [0.25, 0.5, 0.75].forEach((ratio) => {
    const y = padding + (height - padding * 2) * ratio;
    context.beginPath();
    context.moveTo(padding, y);
    context.lineTo(width - padding, y);
    context.stroke();
  });

  if (!points || !points.length) {
    context.setFillStyle("#9aa4af");
    context.setFontSize(13);
    context.fillText("waiting for history", padding, 78);
    context.draw();
    return;
  }

  const values = points.map((item) => item.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const drawableWidth = width - padding * 2;
  const drawableHeight = height - padding * 2;
  const plotted = points.map((item, index) => {
    const ratioX = points.length === 1 ? 1 : index / (points.length - 1);
    const ratioY = (item.value - min) / span;
    return {
      x: padding + drawableWidth * ratioX,
      y: padding + drawableHeight * (1 - ratioY)
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
    context.lineTo(width - padding, plotted[0].y);
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

  context.draw();
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}
