# 终态设计：Plugin 与 Enhancement 的关系

## 核心判断

**Plugin 是管理单位，Enhancement 是能力单位。两者是分层关系，不是并列关系。**

```
用户视角       Admin UI → 安装/启用/禁用 Plugin
                │
开发者视角     EnhancementDescriptor（指令 + 状态 + 变换）
                │
内部实现       Plugin System → beforeProxy / intercept / afterResponse
```

开发者不需要感知 proxy-core 的内部流程（failover 循环、流式/非流式差异、拦截日志记录），只需要声明"我要识别什么指令、维护什么状态、怎么变换消息"。框架负责翻译成 beforeProxy/intercept/afterResponse 调用。

## Plugin API 是机制，Enhancement API 是领域语言

用 Plugin API 写一个新增强，开发者需要理解：
- 请求在 proxy-core 中的处理阶段
- `ProxyBeforeResult` 和 intercept 的配合方式
- 非流式和流式下 afterResponse 的语义差异
- 拦截时需要自己构造 request_log

用 Enhancement API，开发者只需要关注业务逻辑。框架处理所有 plumbing。

## Enhancement Framework 的角色

Enhancement Framework 不是独立插件，而是**核心基础设施的一部分**。原因：

1. 它定义了所有后端代理插件的工作方式——不是可选项
2. 如果它本身是插件，其他插件对它产生依赖，引入插件间依赖管理的复杂度
3. 它是 Plugin System 的上层封装，类似于"插件加载器不应该本身是插件"

## Escape Hatch（逃生舱）

框架不可能覆盖所有场景。保留底层 Plugin API 作为直接实现 `ServerPluginModule` 的通道。Manifest 通过字段区分两种模式：

```
# 推荐方式：声明式增强
manifest.extensions."proxy:enhancements" = [{ ...descriptors }]

# 逃生舱：命令式插件
manifest.serverEntry = "index.js"  // 直接导出 ServerPluginModule
```

## 与前端插件的关系

前端插件（log 解析、Vue 组件渲染）的关注点完全不同，不需要 directive/state/transform。Plugin System 保持通用，Enhancement Framework 只是后端代理插件的上层封装。两层抽象服务不同的使用场景。
