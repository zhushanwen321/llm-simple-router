// Example transform plugin — injects a custom header marker
module.exports = {
  name: "example",
  match: { providerNamePattern: ".*" },
  afterRequestTransform(ctx) {
    // 仅做演示：在请求体中添加标记字段
    ctx.body._plugin_injected = "example";
  },
};
