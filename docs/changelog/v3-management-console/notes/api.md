# LLM API 端点调研

## 项目当前已支持的端点

| API 类型 | 端点 | 方法 | 说明 |
|----------|------|------|------|
| **OpenAI 兼容** | `/v1/chat/completions` | POST | Chat Completions（核心） |
| **OpenAI 兼容** | `/v1/models` | GET | 模型列表 |
| **Anthropic 兼容** | `/v1/messages` | POST | Messages API（Claude Code 主用） |

## 各主流平台端点全景

### 1. OpenAI（SDK v2.24.0）

| 端点 | 路径 | 优先级 | 说明 |
|------|------|--------|------|
| Chat Completions | `POST /v1/chat/completions` | ✅ 已支持 | 经典对话补全 |
| **Responses** | `POST /v1/responses` | **P0 高优** | 2025年新API，替代 Chat Completions 的新范式 |
| Models | `GET /v1/models` | ✅ 已支持 | 模型列表 |
| Embeddings | `POST /v1/embeddings` | P1 | 向量嵌入，RAG/检索场景 |
| Images | `POST /v1/images/generations` | P2 | DALL·E 图像生成 |
| Audio | `POST /v1/audio/*` | P3 | TTS/STT/语音翻译 |
| Moderations | `POST /v1/moderations` | P3 | 内容审核 |
| Fine-tuning | `POST /v1/fine_tuning/jobs` | P3 | 微调 |
| Batches | `POST /v1/batches` | P3 | 批量请求 |
| Vector Stores | `/v1/vector_stores` | P3 | 向量存储 |
| Realtime | WebSocket | P3 | 实时语音/视频 |
| Conversations | `/v1/conversations` | P3 | 对话管理 |
| Evals | `/v1/evals` | P3 | 评估 |
| Containers | `/v1/containers` | P3 | 沙箱执行环境 |
| Skills | `/v1/skills` | P3 | 技能管理 |
| Videos | `/v1/videos` | P3 | 视频生成 |

### 2. Anthropic（SDK v0.86.0）

| 端点 | 路径 | 优先级 | 说明 |
|------|------|--------|------|
| Messages | `POST /v1/messages` | ✅ 已支持 | 核心消息 API |
| Token Count | `POST /v1/messages/count_tokens` | P2 | Token 计数 |
| Models | `GET /v1/models` | P3 | 模型列表 |
| Beta: Files | `/v1/files` | P3 | 文件管理 |
| Beta: Skills | `/v1/skills` | P3 | 技能 |

### 3. Google Gemini

| 端点 | 路径 | 说明 |
|------|------|------|
| 原生 API | `POST /v1beta/models/{model}:generateContent` | Gemini 原生 |
| OpenAI 兼容 | `POST /v1beta/openai/chat/completions` | Google 提供的 OpenAI 兼容层 |

### 4. 国产模型（智谱/Moonshot/Minimax/火山/阿里/腾讯）

几乎所有厂商都提供 **OpenAI 兼容 API**（`/v1/chat/completions`），部分开始支持 `/v1/responses`。

## Responses API 关键差异（vs Chat Completions）

| 维度 | Chat Completions | Responses |
|------|-----------------|-----------|
| 输入字段 | `messages` 数组 | `input`（兼容 messages 格式） |
| 多轮对话 | 传递完整 messages 历史 | `previous_response_id` |
| 输出格式 | `choices` 数组 | `output` 数组，含多种 `type` |
| 内置工具 | 无（需自行实现） | `web_search_preview`、`file_search`、`code_interpreter`、`computer_use_preview` |
| 流式事件 | `data: {"choices": [...]}` | 多种事件类型（`response.output_item.added` 等） |
| 后台模式 | 不支持 | `background: true` 异步执行 |
| 工具调用 | `tool_calls` 在 choice 中 | `output` 中包含 `function_call`、`web_search_call` 等多种类型 |
| 模型参数 | `model` | `model`（相同） |
| Token 统计 | `usage` | `usage`（结构略有不同） |

## 优先级建议

| 优先级 | 端点 | 原因 |
|--------|------|------|
| **P0** | `POST /v1/responses` | OpenAI 新一代核心 API，SDK 已默认使用 |
| **P1** | `POST /v1/embeddings` | RAG 场景刚需，实现简单 |
| **P2** | `POST /v1/images/generations` | 图像生成需求增长 |
| **P3** | Audio（TTS/STT） | 语音场景需求较小 |
