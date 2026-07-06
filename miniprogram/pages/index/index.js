const { fetchMetrics } = require("../../services/metrics");

Page({
  data: {
    metrics: [],
    visibleMetrics: [],
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
    const metrics = decorateMetrics(data.metrics || []);
    this.setData({
      metrics,
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
    this.setData({ visibleMetrics });
  },

  openDetail(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({
      url: `/pages/detail/detail?id=${encodeURIComponent(id)}`
    });
  }
});

function decorateMetrics(metrics) {
  return metrics.map((item) => ({
    ...item,
    accessClass: item.access === "自动" ? "auto" : item.access === "手动" ? "manual" : "semi"
  }));
}

function calcHealth(metrics) {
  const liveCount = metrics.filter((item) => item.value && !["待接入", "手动", "报告", "季报"].includes(item.value)).length;
  if (liveCount >= 8) return "偏强";
  if (liveCount >= 4) return "观察";
  return "待接入";
}

function calcHealthClass(metrics) {
  const label = calcHealth(metrics);
  if (label === "偏强") return "strong";
  if (label === "观察") return "watch";
  return "neutral";
}

function buildErrorMessage(data) {
  if (data.errorMessage) return data.errorMessage;
  if (Array.isArray(data.errors) && data.errors.length) return data.errors.join("；");
  if (data.source === "mock") return "当前显示 mock 数据，说明云函数未返回实时指标。";
  return "";
}
