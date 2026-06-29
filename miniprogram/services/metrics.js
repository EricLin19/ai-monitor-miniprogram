const { metrics: mockMetrics } = require("../data/mockMetrics");

async function fetchMetrics() {
  if (!wx.cloud) {
    return { metrics: mockMetrics, updatedAt: formatTime(new Date()), source: "mock" };
  }

  try {
    const result = await wx.cloud.callFunction({
      name: "fetchMetrics",
      data: {}
    });

    if (result && result.result && Array.isArray(result.result.metrics)) {
      return result.result;
    }
  } catch (error) {
    console.warn("fetchMetrics fallback to mock:", error);
  }

  return { metrics: mockMetrics, updatedAt: formatTime(new Date()), source: "mock" };
}

function formatTime(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

module.exports = { fetchMetrics };

