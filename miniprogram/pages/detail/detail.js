const { metrics } = require("../../data/mockMetrics");
const { cacheMeta } = require("../../data/cacheMeta");

Page({
  data: {
    metric: null,
    updatedAt: cacheMeta.updatedAt
  },

  onLoad(options) {
    const id = decodeURIComponent(options.id || "");
    const metric = metrics.find((item) => item.id === id);
    if (!metric) {
      wx.showToast({ title: "指标不存在", icon: "none" });
      return;
    }

    wx.setNavigationBarTitle({ title: metric.title });
    this.setData({ metric });
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
