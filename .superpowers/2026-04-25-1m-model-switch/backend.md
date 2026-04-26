# 后端改造

## 溢出重定向

替代原 `applyCompactRedirect()`，新函数 `applyOverflowRedirect()`：

1. 从 target 读取 `overflow_provider_id` + `overflow_model`
2. 估算请求 tokens（`JSON.stringify(messages).length / 3`）
3. 获取默认模型 context_window（`provider_model_info` 表 → 代码默认值 fallback）
4. 若 `tokens > context_window` 且配置了溢出模型 → 替换 target 为溢出模型
5. 否则保持原 target

**关键区别：** 不返回错误，不触发 compact，直接切换 target 后正常走 orchestrator → transport 链路。

## 调用位置

在 `proxy-handler.ts` 的 `handleProxyRequest()` 中，mapping 解析之后、orchestrator 调用之前执行。与原 compact 逻辑位置相同。

## API 变化

`/admin/api/proxy-enhancement` 端点移除 compact 相关字段。mapping-groups API 无变化（overflow 字段随 rule JSON 透明传递）。
