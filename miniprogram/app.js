App({
  onLaunch() {
    if (wx.cloud) {
      wx.cloud.init({
        env: "cloud1-d2g60y3nr77c11257",
        traceUser: true
      });
    }
  }
});
