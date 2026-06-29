const { metrics: mockMetrics } = require("../data/mockMetrics");

async function fetchMetrics() {
  if (!wx.cloud) {
    return {
      metrics: mockMetrics,
      updatedAt: formatTime(new Date()),
      source: "mock",
      errorMessage: "wx.cloud 不可用，请确认 app.json 已开启 cloud 且 app.js 已配置云环境 ID。"
    };
  }

  try {
    const result = await wx.cloud.callFunction({
      name: "fetchMetrics",
      data: {}
    });

    if (result && result.result && Array.isArray(result.result.metrics)) {
      return result.result;
    }
    return {
      metrics: mockMetrics,
      updatedAt: formatTime(new Date()),
      source: "mock",
      errorMessage: "云函数返回格式不符合预期，请检查 fetchMetrics 云函数日志。"
    };
  } catch (error) {
    console.warn("fetchMetrics fallback to mock:", error);
    return {
      metrics: mockMetrics,
      updatedAt: formatTime(new Date()),
      source: "mock",
      errorMessage: error && error.errMsg ? error.errMsg : String(error)
    };
  }
}

function formatTime(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

module.exports = { fetchMetrics };
