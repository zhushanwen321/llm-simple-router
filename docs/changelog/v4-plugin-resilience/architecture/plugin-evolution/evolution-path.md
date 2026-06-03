# 演进路径与设计取舍

## 设计取舍

### 取舍 1：框架抽象 vs 灵活性

**选择**：先不做框架，直接用 Plugin API；积累 2-3 个增强后再提炼。

**原因**：当前只有一个增强（model-switching），从一个用例提炼框架容易过度泛化。第二个增强实现时才知道哪些抽象是稳定的——哪些能力是所有增强都需要的，哪些是特定增强特有的。

**代价**：前 1-2 个新增强可能有较多重复代码（指令解析、状态管理）。但重复代码比错误抽象容易修复。

### 取舍 2：声明式 vs 命令式

**选择**：终态以声明式为主（EnhancementDescriptor），保留命令式逃生舱。

**原因**：声明式降低开发者心智负担，命令式兜底处理不规整的场景。两者不是互斥的——声明式可以编译成命令式调用。

**代价**：两套 API 需要维护和测试。逃生舱的存在也意味着框架不能假设所有插件都走声明式路径。

### 取舍 3：内置 vs 可插拔

**选择**：model-switching 作为内置增强（随系统安装）， Enhancement Framework 作为核心基础设施。

**原因**：model-switching 是系统核心功能，不应该可卸载。但 Enhancement Framework 不应该被内置增强独占——第三方插件也用同一套框架。

**代价**：内置增强和第三方增强的代码路径可能有微妙差异（比如内置增强不需要 git clone），需要测试确保一致。

## 三阶段演进路径

### Phase 1 — 当前实施计划

按现有 spec/plan 执行。将 `enhancement-handler` 提取为 `@internal/claude-code-enhancer` 内置插件，直接使用 Plugin API（beforeProxy/intercept/afterResponse）。

**代码结构预留**：
```
src/plugins/internal/claude-code-enhancer/
  index.ts              # 入口，实现 ServerPluginModule
  directive-parser.ts   # 从 src/proxy/ 迁入
  model-state.ts        # 从 src/proxy/ 迁入
  response-cleaner.ts   # 从 src/proxy/ 迁入
  enhancements/
    model-switching.ts   # model-switching 增强逻辑
```

做成目录而非单文件，为 Phase 2 添加新增强和提炼框架留空间。

### Phase 2 — 提炼 Enhancement Framework

实现第二个增强（如 budget-monitor）时，观察与 model-switching 的重复代码。提炼 `EnhancementDescriptor` 接口和公共框架。

此时 `ServerPluginModule` 降级为内部接口。开发者通过 `EnhancementDescriptor` 声明能力，框架翻译为 hook 调用。

### Phase 3 — 框架稳定

Enhancement Framework 成为后端插件的推荐开发方式。Plugin API 是内部实现细节 + 逃生舱。Admin UI 可能增加增强级别的管理（在插件内启用/禁用单个增强）。

## 未决策项

以下问题留给未来实现时再决定：

- **状态作用域**：session / api-key / global / time-window 的具体 API 设计
- **插件冲突检测**：同指令多注册时的优先级规则和冲突提示
- **能力发现**：如何向最终用户暴露可用指令列表
- **流式处理能力**：chunk-level hook 的接口设计
- **多步编排**：是否支持以及如何表达"一次请求触发多次上游调用"
