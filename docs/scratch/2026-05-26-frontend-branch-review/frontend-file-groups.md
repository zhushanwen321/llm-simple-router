# 前端文件分组对比：feat-frontend-design vs main

生成日期：2026-05-26

## 统计

| 项 | 数量 |
|---|------|
| feat 分支非 UI 组件文件 | 169 |
| main 分支非 UI 组件文件 | 154 |
| 共有文件 | 152 |
| feat 新增 (NEW) | 17 |
| feat 移除 (REMOVED) | 2 |

## 分组列表

### G1: Dashboard
| feat文件 | main对应文件 |
|---------|-------------|
| views/Dashboard.vue | views/Dashboard.vue |
| composables/useDashboard.ts | composables/useDashboard.ts |
| composables/useDashboardData.ts | **NEW** |
| composables/useDashboardFilters.ts | **NEW** |
| composables/useDashboardTimeline.ts | **NEW** |

简介：Dashboard 页面视图及数据筛选、时间线 composable。feat 新增了 3 个 composable 用于数据聚合、筛选和时间线展示。

### G2: Providers
| feat文件 | main对应文件 |
|---------|-------------|
| views/Providers.vue | views/Providers.vue |
| components/providers/ModelCapabilitiesEditor.vue | components/providers/ModelCapabilitiesEditor.vue |
| components/providers/types.ts | **NEW** |
| composables/useProviderActions.ts | composables/useProviderActions.ts |
| composables/useProviderForm.ts | composables/useProviderForm.ts |

简介：Provider 管理页面视图、Capabilities 编辑器及相关 composable。feat 新增了 types.ts 类型定义。

### G3: Provider Groups & Presets
| feat文件 | main对应文件 |
|---------|-------------|
| composables/useProviderPresets.ts | composables/useProviderPresets.ts |
| composables/useProviderGroups.ts | **NEW** |
| composables/useFetchUpstreamModels.ts | composables/useFetchUpstreamModels.ts |

简介：Provider 预设、分组管理和上游模型拉取 composable。

### G4: Shared Provider Config
| feat文件 | main对应文件 |
|---------|-------------|
| components/shared/ProxyConfigForm.vue | components/shared/ProxyConfigForm.vue |
| components/shared/ConcurrencyControl.vue | components/shared/ConcurrencyControl.vue |
| components/shared/ToggleRow.vue | **NEW** |
| components/shared/types.ts | **NEW** |

简介：共享的 Provider 配置表单组件（代理配置、并发控制开关行及相关类型）。

### G5: Concurrency Types & Utils
| feat文件 | main对应文件 |
|---------|-------------|
| types/concurrency.ts | types/concurrency.ts |
| utils/concurrency.ts | **NEW** |

简介：并发控制类型定义和工具函数。

### G6: Logs Page
| feat文件 | main对应文件 |
|---------|-------------|
| views/Logs.vue | views/Logs.vue |
| composables/useLogs.ts | composables/useLogs.ts |
| composables/useLogFilters.ts | composables/useLogFilters.ts |
| composables/useLogRetention.ts | composables/useLogRetention.ts |
| components/logs/LogTableRow.vue | components/logs/LogTableRow.vue |

简介：请求日志页面视图、日志列表 composable 和表格行组件。

### G7: Log Types & Viewer Infrastructure
| feat文件 | main对应文件 |
|---------|-------------|
| components/logs/types.ts | components/logs/types.ts |
| components/log-viewer/logColors.ts | components/log-viewer/logColors.ts |
| components/log-viewer/requestBlockParser.ts | components/log-viewer/requestBlockParser.ts |
| components/log-viewer/useSSEParsing.ts | components/log-viewer/useSSEParsing.ts |
| components/log-viewer/InfoBanner.vue | components/log-viewer/InfoBanner.vue |

简介：日志类型定义、颜色常量、请求块解析器、SSE 解析逻辑和信息横幅组件。

### G8: Log Viewer — Request/Response
| feat文件 | main对应文件 |
|---------|-------------|
| components/log-viewer/LogRequestViewer.vue | components/log-viewer/LogRequestViewer.vue |
| components/log-viewer/LogResponseViewer.vue | components/log-viewer/LogResponseViewer.vue |
| components/log-viewer/JsonCopyBlock.vue | components/log-viewer/JsonCopyBlock.vue |
| components/log-viewer/StatPill.vue | components/log-viewer/StatPill.vue |
| components/log-viewer/TagPill.vue | components/log-viewer/TagPill.vue |

简介：日志详情中的请求/响应查看器、JSON 复制块及统计标签。

### G9: Log Viewer — Events
| feat文件 | main对应文件 |
|---------|-------------|
| components/log-viewer/MessageRow.vue | components/log-viewer/MessageRow.vue |
| components/log-viewer/SseEventLine.vue | components/log-viewer/SseEventLine.vue |

简介：SSE 事件行与消息行渲染组件。

### G10: Monitor
| feat文件 | main对应文件 |
|---------|-------------|
| views/Monitor.vue | views/Monitor.vue |
| components/monitor/ConcurrencyPanel.vue | components/monitor/ConcurrencyPanel.vue |
| components/monitor/MonitorHeader.vue | components/monitor/MonitorHeader.vue |
| components/monitor/ProviderStatsTable.vue | components/monitor/ProviderStatsTable.vue |
| components/monitor/RuntimePanel.vue | components/monitor/RuntimePanel.vue |

简介：实时监控页面视图及并发面板、Provider 统计表、运行时面板。

### G11: Monitor — Status & SSE
| feat文件 | main对应文件 |
|---------|-------------|
| components/monitor/StatusCodePanel.vue | components/monitor/StatusCodePanel.vue |
| composables/useMonitorData.ts | composables/useMonitorData.ts |
| composables/useMonitorSSE.ts | composables/useMonitorSSE.ts |
| views/metrics-helpers.ts | views/metrics-helpers.ts |

简介：状态码面板、监控数据聚合、SSE 实时通信 composable 及指标辅助函数。

### G12: Model Mappings
| feat文件 | main对应文件 |
|---------|-------------|
| views/ModelMappings.vue | views/ModelMappings.vue |
| components/mappings/cascading-types.ts | **NEW** |
| components/mappings/CascadingModelSelect.vue | **NEW** |
| components/mappings/MappingEntryEditor.vue | **NEW** |
| utils/mapping-domain.ts | **NEW** |
| — | components/mappings/MappingGroupDeleteDialog.vue (**REMOVED**) |
| — | components/mappings/ModelMappingCard.vue (**REMOVED**) |

简介：模型映射页面。feat 用 CascadingModelSelect + MappingEntryEditor + mapping-domain 替代了 main 的 MappingGroupDeleteDialog + ModelMappingCard，入口文件不变。

### G13: Quick Setup
| feat文件 | main对应文件 |
|---------|-------------|
| views/QuickSetup.vue | views/QuickSetup.vue |
| composables/useQuickSetup.ts | composables/useQuickSetup.ts |
| composables/quick-setup-actions.ts | **NEW** |
| composables/quick-setup-helpers.ts | **NEW** |
| components/quick-setup/ModelCard.vue | components/quick-setup/ModelCard.vue |

简介：快速设置页面视图及 actions/helpers composable 拆分。

### G14: Quick Setup — Sub-components
| feat文件 | main对应文件 |
|---------|-------------|
| components/quick-setup/PatchChips.vue | components/quick-setup/PatchChips.vue |
| components/quick-setup/types.ts | components/quick-setup/types.ts |
| components/shared/QuickSetupMappingList.vue | components/shared/QuickSetupMappingList.vue |

简介：快速设置子组件（Patch 芯片、类型定义、映射列表）。

### G15: Request Detail — Core
| feat文件 | main对应文件 |
|---------|-------------|
| components/request-detail/UnifiedRequestDialog.vue | components/request-detail/UnifiedRequestDialog.vue |
| components/request-detail/RequestOverviewPanel.vue | components/request-detail/RequestOverviewPanel.vue |
| components/request-detail/RequestDiffViewer.vue | components/request-detail/RequestDiffViewer.vue |
| components/request-detail/types.ts | components/request-detail/types.ts |
| components/request-detail/response-parser.ts | components/request-detail/response-parser.ts |

简介：统一请求详情弹窗、概览面板、Diff 查看器、类型定义和响应解析器。

### G16: Request Detail — Advanced
| feat文件 | main对应文件 |
|---------|-------------|
| components/request-detail/AiRulePreviewDialog.vue | components/request-detail/AiRulePreviewDialog.vue |
| components/request-detail/ContentBlockRenderer.vue | components/request-detail/ContentBlockRenderer.vue |
| components/request-detail/ResponseViewer.vue | components/request-detail/ResponseViewer.vue |
| components/request-detail/upstream-merge.ts | components/request-detail/upstream-merge.ts |

简介：AI 规则预览、内容块渲染、响应查看器和上游合并逻辑。

### G17: Retry Rules
| feat文件 | main对应文件 |
|---------|-------------|
| views/RetryRules.vue | views/RetryRules.vue |
| components/retry-rules/RecommendedRules.vue | components/retry-rules/RecommendedRules.vue |
| views/__tests__/retry-rules-ac.test.ts | views/__tests__/retry-rules-ac.test.ts |
| utils/retry-domain.ts | **NEW** |

简介：重试规则页面、推荐规则组件、验收测试及领域工具函数。

### G18: Proxy Enhancement
| feat文件 | main对应文件 |
|---------|-------------|
| views/ProxyEnhancement.vue | views/ProxyEnhancement.vue |
| components/shared/TransformRulesForm.vue | components/shared/TransformRulesForm.vue |
| composables/useTransformRules.ts | composables/useTransformRules.ts |
| utils/transform-domain.ts | **NEW** |

简介：代理增强页面、转换规则表单及 domain 工具函数。

### G19: Router Keys & Schedules
| feat文件 | main对应文件 |
|---------|-------------|
| views/RouterKeys.vue | views/RouterKeys.vue |
| views/Schedules.vue | views/Schedules.vue |
| components/schedules/WeekTimeline.vue | **NEW** |
| utils/schedule-domain.ts | **NEW** |

简介：路由密钥管理和定时调度页面，feat 新增了 WeekTimeline 组件和 schedule-domain 工具。

### G20: Settings & Setup & Login
| feat文件 | main对应文件 |
|---------|-------------|
| views/Settings.vue | views/Settings.vue |
| views/Setup.vue | views/Setup.vue |
| views/Login.vue | views/Login.vue |
| api/settings-api.ts | api/settings-api.ts |

简介：系统设置、首次设置、登录页面及 settings API 客户端。

### G21: App Infrastructure
| feat文件 | main对应文件 |
|---------|-------------|
| App.vue | App.vue |
| main.ts | main.ts |
| router/index.ts | router/index.ts |
| constants.ts | constants.ts |
| env.d.ts | env.d.ts |

简介：应用入口、Vue 路由、全局常量和 TypeScript 类型声明。

### G22: API & Lib
| feat文件 | main对应文件 |
|---------|-------------|
| api/client.ts | api/client.ts |
| lib/utils.ts | lib/utils.ts |
| types/models.ts | types/models.ts |

简介：API 客户端基础封装、工具函数和模型类型定义。

### G23: Types
| feat文件 | main对应文件 |
|---------|-------------|
| types/mapping.ts | types/mapping.ts |
| types/monitor.ts | types/monitor.ts |
| types/schedule.ts | types/schedule.ts |

简介：映射、监控、调度领域类型定义。

### G24: Utils — Formatting
| feat文件 | main对应文件 |
|---------|-------------|
| utils/format.ts | utils/format.ts |
| utils/status.ts | utils/status.ts |
| utils/token-format.ts | **NEW** |

简介：通用格式化、状态标签映射和 token 格式化工具。

### G25: Styles & Design Tokens
| feat文件 | main对应文件 |
|---------|-------------|
| style.css | style.css |
| styles/components.css | styles/components.css |
| styles/design-tokens.ts | styles/design-tokens.ts |
| styles/tokens.css | styles/tokens.css |

简介：全局样式、组件样式、设计令牌 CSS 变量和 TS 定义。

### G26: Icons
| feat文件 | main对应文件 |
|---------|-------------|
| components/icons/ProviderIcon.vue | components/icons/ProviderIcon.vue |

简介：Provider 图标动态渲染组件。

### G27: Layout
| feat文件 | main对应文件 |
|---------|-------------|
| components/layout/Sidebar.vue | components/layout/Sidebar.vue |
| components/layout/AuthLayout.vue | **NEW** |

简介：侧边栏导航和认证布局组件。

### G28: i18n Infrastructure
| feat文件 | main对应文件 |
|---------|-------------|
| i18n/index.ts | i18n/index.ts |
| i18n/datetime.ts | i18n/datetime.ts |
| i18n/number.ts | i18n/number.ts |

简介：国际化基础设施（初始化、日期时间、数字格式化）。

### G29: i18n — Common & Login & Setup
| feat文件 | main对应文件 |
|---------|-------------|
| i18n/locales/en/common.json | i18n/locales/en/common.json |
| i18n/locales/zh-CN/common.json | i18n/locales/zh-CN/common.json |
| i18n/locales/en/login.json | i18n/locales/en/login.json |
| i18n/locales/zh-CN/login.json | i18n/locales/zh-CN/login.json |
| i18n/locales/en/setup.json | i18n/locales/en/setup.json |

简介：通用、登录、设置页面的中英文翻译。

### G30: i18n — Setup & Dashboard & Sidebar
| feat文件 | main对应文件 |
|---------|-------------|
| i18n/locales/zh-CN/setup.json | i18n/locales/zh-CN/setup.json |
| i18n/locales/en/dashboard.json | i18n/locales/en/dashboard.json |
| i18n/locales/zh-CN/dashboard.json | i18n/locales/zh-CN/dashboard.json |
| i18n/locales/en/sidebar.json | i18n/locales/en/sidebar.json |
| i18n/locales/zh-CN/sidebar.json | i18n/locales/zh-CN/sidebar.json |

简介：设置、仪表盘、侧边栏的中英文翻译。

### G31: i18n — Settings & Providers
| feat文件 | main对应文件 |
|---------|-------------|
| i18n/locales/en/settings.json | i18n/locales/en/settings.json |
| i18n/locales/zh-CN/settings.json | i18n/locales/zh-CN/settings.json |
| i18n/locales/en/providers.json | i18n/locales/en/providers.json |
| i18n/locales/zh-CN/providers.json | i18n/locales/zh-CN/providers.json |
| i18n/locales/en/proxyEnhancement.json | i18n/locales/en/proxyEnhancement.json |

简介：系统设置、Provider、代理增强的英文翻译。

### G32: i18n — Proxy Enhancement & Mappings
| feat文件 | main对应文件 |
|---------|-------------|
| i18n/locales/zh-CN/proxyEnhancement.json | i18n/locales/zh-CN/proxyEnhancement.json |
| i18n/locales/en/mappings.json | i18n/locales/en/mappings.json |
| i18n/locales/zh-CN/mappings.json | i18n/locales/zh-CN/mappings.json |
| i18n/locales/en/schedules.json | i18n/locales/en/schedules.json |
| i18n/locales/zh-CN/schedules.json | i18n/locales/zh-CN/schedules.json |

简介：代理增强、模型映射、定时调度的中英文翻译。

### G33: i18n — Router Keys & Retry Rules
| feat文件 | main对应文件 |
|---------|-------------|
| i18n/locales/en/routerKeys.json | i18n/locales/en/routerKeys.json |
| i18n/locales/zh-CN/routerKeys.json | i18n/locales/zh-CN/routerKeys.json |
| i18n/locales/en/retryRules.json | i18n/locales/en/retryRules.json |
| i18n/locales/zh-CN/retryRules.json | i18n/locales/zh-CN/retryRules.json |
| i18n/locales/en/quickSetup.json | i18n/locales/en/quickSetup.json |

简介：路由密钥、重试规则、快速设置的英文翻译。

### G34: i18n — Quick Setup & Logs & Monitor
| feat文件 | main对应文件 |
|---------|-------------|
| i18n/locales/zh-CN/quickSetup.json | i18n/locales/zh-CN/quickSetup.json |
| i18n/locales/en/logs.json | i18n/locales/en/logs.json |
| i18n/locales/zh-CN/logs.json | i18n/locales/zh-CN/logs.json |
| i18n/locales/en/monitor.json | i18n/locales/en/monitor.json |
| i18n/locales/zh-CN/monitor.json | i18n/locales/zh-CN/monitor.json |

简介：快速设置、请求日志、实时监控的中英文翻译。

### G35: i18n — Request Detail
| feat文件 | main对应文件 |
|---------|-------------|
| i18n/locales/en/requestDetail.json | i18n/locales/en/requestDetail.json |
| i18n/locales/zh-CN/requestDetail.json | i18n/locales/zh-CN/requestDetail.json |

简介：请求详情的中英文翻译。

### G36: Assets — Icons (batch 1)
| feat文件 | main对应文件 |
|---------|-------------|
| assets/icons/alibaba.svg | assets/icons/alibaba.svg |
| assets/icons/anthropic.svg | assets/icons/anthropic.svg |
| assets/icons/anthropic-dark.svg | assets/icons/anthropic-dark.svg |
| assets/icons/baidu.svg | assets/icons/baidu.svg |
| assets/icons/claude.svg | assets/icons/claude.svg |

简介：Provider 图标 SVG — Alibaba、Anthropic、Baidu、Claude。

### G37: Assets — Icons (batch 2)
| feat文件 | main对应文件 |
|---------|-------------|
| assets/icons/codex.svg | assets/icons/codex.svg |
| assets/icons/deepseek.svg | assets/icons/deepseek.svg |
| assets/icons/iflytek.svg | assets/icons/iflytek.svg |
| assets/icons/kimi.svg | assets/icons/kimi.svg |
| assets/icons/minimax.svg | assets/icons/minimax.svg |

简介：Provider 图标 SVG — Codex、DeepSeek、Iflytek、Kimi、MiniMax。

### G38: Assets — Icons (batch 3)
| feat文件 | main对应文件 |
|---------|-------------|
| assets/icons/moonshot.svg | assets/icons/moonshot.svg |
| assets/icons/moonshot-dark.svg | assets/icons/moonshot-dark.svg |
| assets/icons/openai.svg | assets/icons/openai.svg |
| assets/icons/openai-dark.svg | assets/icons/openai-dark.svg |
| assets/icons/opencode.svg | assets/icons/opencode.svg |

简介：Provider 图标 SVG — Moonshot、OpenAI、Opencode。

### G39: Assets — Icons (batch 4)
| feat文件 | main对应文件 |
|---------|-------------|
| assets/icons/opencode-dark.svg | assets/icons/opencode-dark.svg |
| assets/icons/pi.svg | assets/icons/pi.svg |
| assets/icons/pi-dark.svg | assets/icons/pi-dark.svg |
| assets/icons/qwen.svg | assets/icons/qwen.svg |
| assets/icons/siliconcloud.svg | assets/icons/siliconcloud.svg |

简介：Provider 图标 SVG — Opencode Dark、Pi、Qwen、SiliconCloud。

### G40: Assets — Icons (batch 5)
| feat文件 | main对应文件 |
|---------|-------------|
| assets/icons/stepfun.svg | assets/icons/stepfun.svg |
| assets/icons/tencentcloud.svg | assets/icons/tencentcloud.svg |
| assets/icons/volcengine.svg | assets/icons/volcengine.svg |
| assets/icons/zhipu.svg | assets/icons/zhipu.svg |

简介：Provider 图标 SVG — StepFun、TencentCloud、VolcEngine、Zhipu。

### G41: Assets — Other
| feat文件 | main对应文件 |
|---------|-------------|
| assets/hero.png | assets/hero.png |
| assets/vite.svg | assets/vite.svg |

简介：Hero 图片和 Vite 图标。

## 差异汇总

### feat 新增文件 (NEW) — 17 个

| 文件 | 所属分组 |
|------|---------|
| components/layout/AuthLayout.vue | G27 Layout |
| components/providers/types.ts | G2 Providers |
| components/schedules/WeekTimeline.vue | G19 Router Keys & Schedules |
| components/shared/ToggleRow.vue | G4 Shared Provider Config |
| components/shared/types.ts | G4 Shared Provider Config |
| composables/quick-setup-actions.ts | G13 Quick Setup |
| composables/quick-setup-helpers.ts | G13 Quick Setup |
| composables/useDashboardData.ts | G1 Dashboard |
| composables/useDashboardFilters.ts | G1 Dashboard |
| composables/useDashboardTimeline.ts | G1 Dashboard |
| composables/useProviderGroups.ts | G3 Provider Groups & Presets |
| utils/concurrency.ts | G5 Concurrency Types & Utils |
| utils/mapping-domain.ts | G12 Model Mappings |
| utils/retry-domain.ts | G17 Retry Rules |
| utils/schedule-domain.ts | G19 Router Keys & Schedules |
| utils/token-format.ts | G24 Utils — Formatting |
| utils/transform-domain.ts | G18 Proxy Enhancement |

### feat 移除文件 (REMOVED) — 2 个

| 文件 | 所属分组 |
|------|---------|
| components/mappings/MappingGroupDeleteDialog.vue | G12 Model Mappings |
| components/mappings/ModelMappingCard.vue | G12 Model Mappings |
