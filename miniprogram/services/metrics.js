const { metrics: mockMetrics } = require("../data/mockMetrics");
const { cacheMeta } = require("../data/cacheMeta");
const { metricHistory } = require("../data/metricHistory");

const REMOTE_CACHE_URL = "https://raw.githubusercontent.com/EricLin19/ai-monitor-miniprogram/master/public/ai-monitor-cache.json";
const USE_REMOTE_CACHE = true;
const USE_CLOUD_FUNCTION = false;

async function fetchMetrics() {
  if (USE_REMOTE_CACHE) {
    try {
      const remote = await fetchRemoteCache();
      if (remote && Array.isArray(remote.metrics)) {
        return {
          metrics: remote.metrics,
          history: remote.history || {},
          updatedAt: remote.updatedAt || "--",
          source: "remote-cache"
        };
      }
    } catch (error) {
      console.warn("fetch remote cache fallback to local:", error);
    }
  }

  if (!USE_CLOUD_FUNCTION) {
    return localCache();
  }

  if (!wx.cloud) {
    return {
      ...localCache(),
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
      ...localCache(),
      source: "mock",
      errorMessage: "云函数返回格式不符合预期，请检查 fetchMetrics 云函数日志。"
    };
  } catch (error) {
    console.warn("fetchMetrics fallback to mock:", error);
    return {
      ...localCache(),
      source: "mock",
      errorMessage: error && error.errMsg ? error.errMsg : String(error)
    };
  }
}

function fetchRemoteCache() {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${REMOTE_CACHE_URL}?t=${Date.now()}`,
      method: "GET",
      timeout: 10000,
      success(response) {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`remote cache HTTP ${response.statusCode}`));
          return;
        }
        resolve(typeof response.data === "string" ? JSON.parse(response.data) : response.data);
      },
      fail: reject
    });
  });
}

function localCache() {
  return {
    metrics: mockMetrics,
    history: metricHistory,
    updatedAt: cacheMeta.updatedAt,
    source: "local-cache"
  };
}

module.exports = { fetchMetrics };
