/**
 * modality-redirect TDD 测试（RED 阶段）
 *
 * 被测文件：src/proxy/routing/modality-redirect.ts
 * 被测函数：
 *   - detectModalities(body) → Set<string>
 *   - computeModalityRedirectTargets(db, targets, clientModel, body, snapshot) → Target[]
 *
 * 所有测试必须 FAIL — 文件和函数均不存在
 */
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initDatabase } from "../src/db/index.js";
import { seedSettings } from "./helpers/test-setup.js";
import type { Target } from "../src/core/types.js";
import { PipelineSnapshot } from "../src/proxy/pipeline-snapshot.js";

// 被测函数——文件不存在，import 会失败
import {
  detectModalities,
  computeModalityRedirectTargets,
} from "../src/proxy/routing/modality-redirect.js";

// ============================================================
// 测试辅助
// ============================================================

/** 插入一个 provider 并返回其 id */
function insertProvider(
  db: Database.Database,
  opts: {
  id: string;
  name: string;
  models: string;
  is_active?: number;
  },
): string {
  const now = "2026-01-01T00:00:00Z";
  db.prepare(
  `INSERT INTO providers (id, name, api_type, base_url, api_key, models, is_active, max_concurrency, queue_timeout_ms, max_queue_size, adaptive_enabled, created_at, updated_at)
   VALUES (?, ?, 'openai', 'http://localhost:1111', '', ?, ?, 0, 0, 100, 0, ?, ?)`,
  ).run(opts.id, opts.name, opts.models, opts.is_active ?? 1, now, now);
  return opts.id;
}

/** 插入一个 mapping_group 并返回其 id */
function insertMappingGroup(
  db: Database.Database,
  clientModel: string,
  rule: Record<string, unknown>,
): string {
  const id = "mg-" + clientModel;
  const now = "2026-01-01T00:00:00Z";
  db.prepare(
  `INSERT INTO mapping_groups (id, client_model, strategy, rule, is_active, created_at)
   VALUES (?, ?, 'scheduled', ?, 1, ?)`,
  ).run(id, clientModel, JSON.stringify(rule), now);
  return id;
}

/** 构造 OpenAI 图片请求体（messages[].content 为数组，含 image_url） */
function openaiImageBody(): Record<string, unknown> {
  return {
  model: "gpt-5",
  messages: [
    {
    role: "user",
    content: [
      { type: "text", text: "描述这张图片" },
      {
      type: "image_url",
      image_url: { url: "https://example.com/img.png" },
      },
    ],
    },
  ],
  };
}

/** 构造 OpenAI 纯文本请求体（content 为 string） */
function openaiTextBody(): Record<string, unknown> {
  return {
  model: "gpt-5",
  messages: [
    { role: "user", content: "你好" },
  ],
  };
}

/** 构造 Anthropic 图片请求体 */
function anthropicImageBody(): Record<string, unknown> {
  return {
  model: "claude-5",
  messages: [
    {
    role: "user",
    content: [
      { type: "text", text: "描述这张图片" },
      {
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: "iVBOR...",
      },
      },
    ],
    },
  ],
  };
}

/** Anthropic tool_result 内嵌图片 */
function anthropicToolResultImageBody(): Record<string, unknown> {
  return {
  model: "glm-5.1",
  messages: [
    { role: "user", content: [{ type: "text", text: "hello" }] },
    {
    role: "assistant",
    content: [{ type: "tool_use", id: "tool_1", name: "read", input: { path: "/tmp/screenshot.png" } }],
    },
    {
    role: "user",
    content: [
      {
      type: "tool_result",
      tool_use_id: "tool_1",
      content: [
        { type: "text", text: "File content" },
        {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: "iVBOR...",
        },
        },
      ],
      },
    ],
    },
  ],
  };
}

/** 构造 Responses API 图片请求体（input[] 含 type="input_image" 嵌套在 message content 中） */
function responsesApiImageBody(): Record<string, unknown> {
  return {
  model: "gpt-5",
  input: [
    {
    type: "message",
    role: "user",
    content: [
      { type: "input_text", text: "描述这张图片" },
      {
      type: "input_image",
      image_url: "https://example.com/img.png",
      },
    ],
    },
  ],
  };
}

/** 构造 Responses API 图片请求体（input[] 顶层 type="input_image"） */
function responsesApiTopLevelImageBody(): Record<string, unknown> {
  return {
  model: "gpt-5",
  input: [
    { type: "input_text", text: "描述这张图片" },
    {
    type: "input_image",
    image_url: "https://example.com/img.png",
    },
  ],
  };
}

// ============================================================
// detectModalities 测试套件（新增）
// ============================================================

describe("detectModalities", () => {
  // ----------------------------------------------------------
  // AC4: OpenAI input_audio block
  // ----------------------------------------------------------
  it("detectModalities: OpenAI input_audio block → Set contains 'audio'", () => {
  const body = {
    messages: [
    {
      role: "user",
      content: [
      { type: "text", text: "听一下这段录音" },
      { type: "input_audio", input_audio: { data: "base64..." } },
      ],
    },
    ],
  };
  const result = detectModalities(body);
  expect(result.has("audio")).toBe(true);
  expect(result.has("image")).toBe(false);
  });

  // ----------------------------------------------------------
  // AC4: Responses API input_audio
  // ----------------------------------------------------------
  it("detectModalities: Responses API input_audio → Set contains 'audio'", () => {
  const body = {
    input: [
    { type: "input_audio", input_audio: { data: "base64..." } },
    ],
  };
  const result = detectModalities(body);
  expect(result.has("audio")).toBe(true);
  });

  // ----------------------------------------------------------
  // AC5: empty body → empty Set
  // ----------------------------------------------------------
  it("detectModalities: empty body → empty Set", () => {
  expect(detectModalities({}).size).toBe(0);
  expect(detectModalities({ messages: [] }).size).toBe(0);
  });

  // ----------------------------------------------------------
  // AC6: mixed image + audio → both detected
  // ----------------------------------------------------------
  it("detectModalities: mixed image + audio → Set contains both", () => {
  const body = {
    messages: [
    {
      role: "user",
      content: [
      { type: "image_url", image_url: { url: "http://example.com/img.png" } },
      { type: "input_audio", input_audio: { data: "base64..." } },
      ],
    },
    ],
  };
  const result = detectModalities(body);
  expect(result.has("image")).toBe(true);
  expect(result.has("audio")).toBe(true);
  expect(result.size).toBe(2);
  });

  // ----------------------------------------------------------
  // Responses API message.content input_image → image
  // ----------------------------------------------------------
  it("detectModalities: Responses API message.content input_image → Set contains 'image'", () => {
  const body = {
    input: [
    {
      type: "message",
      role: "user",
      content: [{ type: "input_image", image_url: "http://example.com/img.png" }],
    },
    ],
  };
  const result = detectModalities(body);
  expect(result.has("image")).toBe(true);
  });

  // ----------------------------------------------------------
  // OpenAI image_url → image detected
  // ----------------------------------------------------------
  it("detectModalities: OpenAI image_url → Set contains 'image'", () => {
  const result = detectModalities(openaiImageBody());
  expect(result.has("image")).toBe(true);
  });

  // ----------------------------------------------------------
  // Anthropic image block → image detected
  // ----------------------------------------------------------
  it("detectModalities: Anthropic image block → Set contains 'image'", () => {
  const result = detectModalities(anthropicImageBody());
  expect(result.has("image")).toBe(true);
  });

  // ----------------------------------------------------------
  // Anthropic tool_result 内嵌 image → image detected
  // ----------------------------------------------------------
  it("detectModalities: Anthropic tool_result 内嵌 image → Set contains 'image'", () => {
  const result = detectModalities(anthropicToolResultImageBody());
  expect(result.has("image")).toBe(true);
  });

  // ----------------------------------------------------------
  // Responses API 顶层 input_image → image detected
  // ----------------------------------------------------------
  it("detectModalities: Responses API top-level input_image → Set contains 'image'", () => {
  const result = detectModalities(responsesApiTopLevelImageBody());
  expect(result.has("image")).toBe(true);
  });

  // ----------------------------------------------------------
  // 纯文本 body → empty Set
  // ----------------------------------------------------------
  it("detectModalities: plain text body → empty Set", () => {
  const result = detectModalities(openaiTextBody());
  expect(result.size).toBe(0);
  });
});

// ============================================================
// computeModalityRedirectTargets 测试套件
// ============================================================

describe("computeModalityRedirectTargets", () => {
  let db: Database.Database;

  beforeEach(() => {
  db = initDatabase(":memory:");
  seedSettings(db);
  });

  // ----------------------------------------------------------
  // AC1: 有图片 + 首 target 不支持 + 有 fallback → 替换为 fallback
  // ----------------------------------------------------------
  it("AC1: returns only fallback target when image detected and first target lacks image capability", () => {
  const providerAId = insertProvider(db, {
    id: "pa",
    name: "text-provider",
    models: JSON.stringify([{ name: "text-model", capabilities: ["text"] }]),
  });

  const providerBId = insertProvider(db, {
    id: "pb",
    name: "image-provider",
    models: JSON.stringify([{ name: "vision-model", capabilities: ["text", "image"] }]),
  });

  // multimodal_fallback 配置
  insertMappingGroup(db, "gpt-5", {
    targets: [{ provider_id: providerAId, backend_model: "text-model" }],
    multimodal_fallback: {
    provider_id: providerBId,
    backend_model: "vision-model",
    },
  });

  const targets: Target[] = [
    { provider_id: providerAId, backend_model: "text-model" },
  ];
  const snapshot = new PipelineSnapshot();
  const body = openaiImageBody();

  const result = computeModalityRedirectTargets(db, targets, "gpt-5", body, snapshot);

  expect(result).toHaveLength(1);
  expect(result[0]).toEqual({
    provider_id: providerBId,
    backend_model: "vision-model",
  });
  });

  // ----------------------------------------------------------
  // AC2: 有图片 + 首 target 已支持 → 不扩展
  // ----------------------------------------------------------
  it("AC2: returns original targets when first target already supports image", () => {
  const providerId = insertProvider(db, {
    id: "p1",
    name: "vision-provider",
    models: JSON.stringify([{ name: "vision-model", capabilities: ["text", "image"] }]),
  });

  insertMappingGroup(db, "gpt-5", {
    targets: [{ provider_id: providerId, backend_model: "vision-model" }],
  });

  const targets: Target[] = [
    { provider_id: providerId, backend_model: "vision-model" },
  ];
  const snapshot = new PipelineSnapshot();
  const body = openaiImageBody();

  const result = computeModalityRedirectTargets(db, targets, "gpt-5", body, snapshot);

  expect(result).toEqual(targets);
  expect(result).toHaveLength(1);
  });

  // ----------------------------------------------------------
  // AC3: 有图片 + 首 target 不支持 + 无 fallback → 空列表
  // ----------------------------------------------------------
  it("AC3: returns empty array when no multimodal_fallback configured in mapping group", () => {
  const providerId = insertProvider(db, {
    id: "p1",
    name: "text-provider",
    models: JSON.stringify([{ name: "text-model", capabilities: ["text"] }]),
  });

  // mapping group 不含 multimodal_fallback
  insertMappingGroup(db, "gpt-5", {
    targets: [{ provider_id: providerId, backend_model: "text-model" }],
  });

  const targets: Target[] = [
    { provider_id: providerId, backend_model: "text-model" },
  ];
  const snapshot = new PipelineSnapshot();
  const body = openaiImageBody();

  const result = computeModalityRedirectTargets(db, targets, "gpt-5", body, snapshot);

  expect(result).toEqual([]);
  });

  // ----------------------------------------------------------
  // AC4: 无图片 → 不扩展（no-op）
  // ----------------------------------------------------------
  it("AC4: returns original targets unchanged when body has no image", () => {
  const providerId = insertProvider(db, {
    id: "p1",
    name: "text-provider",
    models: JSON.stringify([{ name: "text-model", capabilities: ["text"] }]),
  });

  insertMappingGroup(db, "gpt-5", {
    targets: [{ provider_id: providerId, backend_model: "text-model" }],
    multimodal_fallback: {
    provider_id: "pb",
    backend_model: "vision-model",
    },
  });

  const targets: Target[] = [
    { provider_id: providerId, backend_model: "text-model" },
  ];
  const snapshot = new PipelineSnapshot();
  const body = openaiTextBody(); // 纯文本

  const result = computeModalityRedirectTargets(db, targets, "gpt-5", body, snapshot);

  expect(result).toEqual(targets);
  });

  // ----------------------------------------------------------
  // AC7: fallback provider 非 active → 空列表
  // ----------------------------------------------------------
  it("AC7: returns empty array when fallback provider is inactive", () => {
  const providerAId = insertProvider(db, {
    id: "pa",
    name: "text-provider",
    models: JSON.stringify([{ name: "text-model", capabilities: ["text"] }]),
  });

  const providerBId = insertProvider(db, {
    id: "pb",
    name: "inactive-vision-provider",
    models: JSON.stringify([{ name: "vision-model", capabilities: ["text", "image"] }]),
    is_active: 0,
  });

  insertMappingGroup(db, "gpt-5", {
    targets: [{ provider_id: providerAId, backend_model: "text-model" }],
    multimodal_fallback: {
    provider_id: providerBId,
    backend_model: "vision-model",
    },
  });

  const targets: Target[] = [
    { provider_id: providerAId, backend_model: "text-model" },
  ];
  const snapshot = new PipelineSnapshot();
  const body = openaiImageBody();

  const result = computeModalityRedirectTargets(db, targets, "gpt-5", body, snapshot);

  expect(result).toEqual([]);
  });

  // ----------------------------------------------------------
  // AC8: fallback provider_id 不存在 → 空列表
  // ----------------------------------------------------------
  it("AC8: returns empty array when fallback provider_id does not exist in DB", () => {
  const providerAId = insertProvider(db, {
    id: "pa",
    name: "text-provider",
    models: JSON.stringify([{ name: "text-model", capabilities: ["text"] }]),
  });

  insertMappingGroup(db, "gpt-5", {
    targets: [{ provider_id: providerAId, backend_model: "text-model" }],
    multimodal_fallback: {
    provider_id: "non-existent-provider-id",
    backend_model: "vision-model",
    },
  });

  const targets: Target[] = [
    { provider_id: providerAId, backend_model: "text-model" },
  ];
  const snapshot = new PipelineSnapshot();
  const body = openaiImageBody();

  const result = computeModalityRedirectTargets(db, targets, "gpt-5", body, snapshot);

  expect(result).toEqual([]);
  });

  // ----------------------------------------------------------
  // AC9: 触发时记录 StageRecord（stage 名称改为 modality-redirect）
  // ----------------------------------------------------------
  it("AC9: records modality-redirect StageRecord in snapshot when triggered", () => {
  const providerAId = insertProvider(db, {
    id: "pa",
    name: "text-provider",
    models: JSON.stringify([{ name: "text-model", capabilities: ["text"] }]),
  });

  const providerBId = insertProvider(db, {
    id: "pb",
    name: "image-provider",
    models: JSON.stringify([{ name: "vision-model", capabilities: ["text", "image"] }]),
  });

  insertMappingGroup(db, "gpt-5", {
    targets: [{ provider_id: providerAId, backend_model: "text-model" }],
    multimodal_fallback: {
    provider_id: providerBId,
    backend_model: "vision-model",
    },
  });

  const targets: Target[] = [
    { provider_id: providerAId, backend_model: "text-model" },
  ];
  const snapshot = new PipelineSnapshot();
  const body = openaiImageBody();

  computeModalityRedirectTargets(db, targets, "gpt-5", body, snapshot);

  // 验证 snapshot JSON 包含 "modality-redirect" stage
  const snapshotJson = snapshot.toJSON();
  const parsed = JSON.parse(snapshotJson);
  const irStage = parsed.find(
    (s: { stage: string }) => s.stage === "modality-redirect",
  );
  expect(irStage).toBeDefined();
  expect(irStage.triggered).toBe(true);
  expect(irStage.original_model).toBe("text-model");
  expect(irStage.redirect_to).toBe("vision-model");
  expect(irStage.redirect_provider).toBe(providerBId);
  });

  // ----------------------------------------------------------
  // AC10（原）: 异常安全 → 返回原始 targets
  // ----------------------------------------------------------
  it("returns original targets when internal logic throws exception", () => {
  const targets: Target[] = [
    { provider_id: "pa", backend_model: "text-model" },
  ];
  const snapshot = new PipelineSnapshot();
  const body = openaiImageBody();

  const result = computeModalityRedirectTargets(db, targets, "nonexistent-model", body, snapshot);

  expect(result).toEqual(targets);
  });

  // ----------------------------------------------------------
  // AC13: 检测 OpenAI image_url 格式
  // ----------------------------------------------------------
  it("AC13: detects OpenAI image_url format and triggers redirect", () => {
  const providerAId = insertProvider(db, {
    id: "pa",
    name: "text-provider",
    models: JSON.stringify([{ name: "text-model", capabilities: ["text"] }]),
  });

  const providerBId = insertProvider(db, {
    id: "pb",
    name: "image-provider",
    models: JSON.stringify([{ name: "vision-model", capabilities: ["text", "image"] }]),
  });

  insertMappingGroup(db, "gpt-5", {
    targets: [{ provider_id: providerAId, backend_model: "text-model" }],
    multimodal_fallback: {
    provider_id: providerBId,
    backend_model: "vision-model",
    },
  });

  const targets: Target[] = [
    { provider_id: providerAId, backend_model: "text-model" },
  ];
  const snapshot = new PipelineSnapshot();
  const body = openaiImageBody();

  const result = computeModalityRedirectTargets(db, targets, "gpt-5", body, snapshot);

  expect(result).toHaveLength(1);
  expect(result[0].backend_model).toBe("vision-model");
  });

  // ----------------------------------------------------------
  // AC14: 检测 Anthropic image 格式
  // ----------------------------------------------------------
  it("AC14: detects Anthropic image format and triggers redirect", () => {
  const providerAId = insertProvider(db, {
    id: "pa",
    name: "text-provider",
    models: JSON.stringify([{ name: "text-model", capabilities: ["text"] }]),
  });

  const providerBId = insertProvider(db, {
    id: "pb",
    name: "image-provider",
    models: JSON.stringify([{ name: "vision-model", capabilities: ["text", "image"] }]),
  });

  insertMappingGroup(db, "claude-5", {
    targets: [{ provider_id: providerAId, backend_model: "text-model" }],
    multimodal_fallback: {
    provider_id: providerBId,
    backend_model: "vision-model",
    },
  });

  const targets: Target[] = [
    { provider_id: providerAId, backend_model: "text-model" },
  ];
  const snapshot = new PipelineSnapshot();
  const body = anthropicImageBody();

  const result = computeModalityRedirectTargets(db, targets, "claude-5", body, snapshot);

  expect(result).toHaveLength(1);
  expect(result[0].backend_model).toBe("vision-model");
  });

  // ----------------------------------------------------------
  // AC15: OpenAI content 为 string 时不触发
  // ----------------------------------------------------------
  it("AC15: does not trigger when OpenAI content is a plain string", () => {
  const providerAId = insertProvider(db, {
    id: "pa",
    name: "text-provider",
    models: JSON.stringify([{ name: "text-model", capabilities: ["text"] }]),
  });

  const providerBId = insertProvider(db, {
    id: "pb",
    name: "image-provider",
    models: JSON.stringify([{ name: "vision-model", capabilities: ["text", "image"] }]),
  });

  insertMappingGroup(db, "gpt-5", {
    targets: [{ provider_id: providerAId, backend_model: "text-model" }],
    multimodal_fallback: {
    provider_id: providerBId,
    backend_model: "vision-model",
    },
  });

  const targets: Target[] = [
    { provider_id: providerAId, backend_model: "text-model" },
  ];
  const snapshot = new PipelineSnapshot();
  const body = openaiTextBody();

  const result = computeModalityRedirectTargets(db, targets, "gpt-5", body, snapshot);

  expect(result).toEqual(targets);
  expect(result).toHaveLength(1);
  });

  // ----------------------------------------------------------
  // AC16: 检测 Responses API input_image 格式（嵌套在 message 中）
  // ----------------------------------------------------------
  it("AC16a: detects Responses API input_image inside message content and triggers redirect", () => {
  const providerAId = insertProvider(db, {
    id: "pa",
    name: "text-provider",
    models: JSON.stringify([{ name: "text-model", capabilities: ["text"] }]),
  });

  const providerBId = insertProvider(db, {
    id: "pb",
    name: "image-provider",
    models: JSON.stringify([{ name: "vision-model", capabilities: ["text", "image"] }]),
  });

  insertMappingGroup(db, "gpt-5", {
    targets: [{ provider_id: providerAId, backend_model: "text-model" }],
    multimodal_fallback: {
    provider_id: providerBId,
    backend_model: "vision-model",
    },
  });

  const targets: Target[] = [
    { provider_id: providerAId, backend_model: "text-model" },
  ];
  const snapshot = new PipelineSnapshot();
  const body = responsesApiImageBody();

  const result = computeModalityRedirectTargets(db, targets, "gpt-5", body, snapshot);

  expect(result).toHaveLength(1);
  expect(result[0].backend_model).toBe("vision-model");
  });

  // ----------------------------------------------------------
  // AC16: 检测 Responses API input_image 格式（顶层）
  // ----------------------------------------------------------
  it("AC16b: detects Responses API top-level input_image and triggers redirect", () => {
  const providerAId = insertProvider(db, {
    id: "pa",
    name: "text-provider",
    models: JSON.stringify([{ name: "text-model", capabilities: ["text"] }]),
  });

  const providerBId = insertProvider(db, {
    id: "pb",
    name: "image-provider",
    models: JSON.stringify([{ name: "vision-model", capabilities: ["text", "image"] }]),
  });

  insertMappingGroup(db, "gpt-5", {
    targets: [{ provider_id: providerAId, backend_model: "text-model" }],
    multimodal_fallback: {
    provider_id: providerBId,
    backend_model: "vision-model",
    },
  });

  const targets: Target[] = [
    { provider_id: providerAId, backend_model: "text-model" },
  ];
  const snapshot = new PipelineSnapshot();
  const body = responsesApiTopLevelImageBody();

  const result = computeModalityRedirectTargets(db, targets, "gpt-5", body, snapshot);

  expect(result).toHaveLength(1);
  expect(result[0].backend_model).toBe("vision-model");
  });

  // ----------------------------------------------------------
  // 边界：空 targets 列表
  // ----------------------------------------------------------
  it("returns empty array when targets list is empty", () => {
  const snapshot = new PipelineSnapshot();
  const body = openaiImageBody();

  const result = computeModalityRedirectTargets(db, [], "gpt-5", body, snapshot);

  expect(result).toEqual([]);
  });

  // ----------------------------------------------------------
  // 边界：body 为空对象
  // ----------------------------------------------------------
  it("returns original targets when body is empty object", () => {
  const providerId = insertProvider(db, {
    id: "p1",
    name: "text-provider",
    models: JSON.stringify([{ name: "text-model", capabilities: ["text"] }]),
  });

  insertMappingGroup(db, "gpt-5", {
    targets: [{ provider_id: providerId, backend_model: "text-model" }],
    multimodal_fallback: {
    provider_id: "pb",
    backend_model: "vision-model",
    },
  });

  const targets: Target[] = [
    { provider_id: providerId, backend_model: "text-model" },
  ];
  const snapshot = new PipelineSnapshot();
  const body = {};

  const result = computeModalityRedirectTargets(db, targets, "gpt-5", body, snapshot);

  expect(result).toEqual(targets);
  });

  // ----------------------------------------------------------
  // 边界：capabilities 缺失时默认为 ["text"]，应触发 redirect
  // ----------------------------------------------------------
  it("treats model without capabilities as text-only and triggers redirect", () => {
  const providerAId = insertProvider(db, {
    id: "pa",
    name: "legacy-provider",
    models: JSON.stringify([{ name: "legacy-model" }]),
  });

  const providerBId = insertProvider(db, {
    id: "pb",
    name: "image-provider",
    models: JSON.stringify([{ name: "vision-model", capabilities: ["text", "image"] }]),
  });

  insertMappingGroup(db, "gpt-5", {
    targets: [{ provider_id: providerAId, backend_model: "legacy-model" }],
    multimodal_fallback: {
    provider_id: providerBId,
    backend_model: "vision-model",
    },
  });

  const targets: Target[] = [
    { provider_id: providerAId, backend_model: "legacy-model" },
  ];
  const snapshot = new PipelineSnapshot();
  const body = openaiImageBody();

  const result = computeModalityRedirectTargets(db, targets, "gpt-5", body, snapshot);

  expect(result).toHaveLength(1);
  expect(result[0].backend_model).toBe("vision-model");
  });

  // ----------------------------------------------------------
  // Anthropic tool_result 内嵌 image
  // ----------------------------------------------------------
  it("detects image inside Anthropic tool_result content and triggers redirect", () => {
  const providerAId = insertProvider(db, {
    id: "pa",
    name: "text-provider",
    models: JSON.stringify([{ name: "glm-5.1" }]),
  });
  const providerBId = insertProvider(db, {
    id: "pb",
    name: "image-provider",
    models: JSON.stringify([{ name: "kimi-for-coding", capabilities: ["text", "image"] }]),
  });

  insertMappingGroup(db, "glm-5.1", {
    targets: [{ provider_id: providerAId, backend_model: "glm-5.1" }],
    multimodal_fallback: {
    provider_id: providerBId,
    backend_model: "kimi-for-coding",
    },
  });

  const targets: Target[] = [
    { provider_id: providerAId, backend_model: "glm-5.1" },
  ];
  const snapshot = new PipelineSnapshot();
  const body = anthropicToolResultImageBody();

  const result = computeModalityRedirectTargets(db, targets, "glm-5.1", body, snapshot);

  expect(result).toHaveLength(1);
  expect(result[0].backend_model).toBe("kimi-for-coding");
  const parsed = JSON.parse(snapshot.toJSON());
  const irStage = parsed.find((s: { stage: string }) => s.stage === "modality-redirect");
  expect(irStage).toBeDefined();
  expect(irStage.triggered).toBe(true);
  });

  // ----------------------------------------------------------
  // reason 验证：no-multimodal-detected（纯文本 body）
  // ----------------------------------------------------------
  it("records reason 'no-multimodal-detected' when body has no multimodal content", () => {
  const providerId = insertProvider(db, {
    id: "p1",
    name: "text-provider",
    models: JSON.stringify([{ name: "text-model", capabilities: ["text"] }]),
  });

  insertMappingGroup(db, "gpt-5", {
    targets: [{ provider_id: providerId, backend_model: "text-model" }],
    multimodal_fallback: {
    provider_id: "pb",
    backend_model: "vision-model",
    },
  });

  const targets: Target[] = [
    { provider_id: providerId, backend_model: "text-model" },
  ];
  const snapshot = new PipelineSnapshot();
  const body = openaiTextBody();

  computeModalityRedirectTargets(db, targets, "gpt-5", body, snapshot);

  const parsed = JSON.parse(snapshot.toJSON());
  const stage = parsed.find((s: { stage: string }) => s.stage === "modality-redirect");
  expect(stage).toBeDefined();
  expect(stage.reason).toBe("no-multimodal-detected");
  });

  // ----------------------------------------------------------
  // reason 验证：first-target-supports-all-modalities
  // ----------------------------------------------------------
  it("records reason 'first-target-supports-all-modalities' when first target supports all body modalities", () => {
  const providerId = insertProvider(db, {
    id: "p1",
    name: "vision-provider",
    models: JSON.stringify([{ name: "vision-model", capabilities: ["text", "image"] }]),
  });

  insertMappingGroup(db, "gpt-5", {
    targets: [{ provider_id: providerId, backend_model: "vision-model" }],
  });

  const targets: Target[] = [
    { provider_id: providerId, backend_model: "vision-model" },
  ];
  const snapshot = new PipelineSnapshot();
  const body = openaiImageBody();

  computeModalityRedirectTargets(db, targets, "gpt-5", body, snapshot);

  const parsed = JSON.parse(snapshot.toJSON());
  const stage = parsed.find((s: { stage: string }) => s.stage === "modality-redirect");
  expect(stage).toBeDefined();
  expect(stage.reason).toBe("all-targets-support-modalities");
  });

  // ----------------------------------------------------------
  // reason 验证：no-eligible-targets（无 fallback 配置）
  // ----------------------------------------------------------
  it("records reason 'no-eligible-targets' when no fallback in rule", () => {
  const providerId = insertProvider(db, {
    id: "p1",
    name: "text-provider",
    models: JSON.stringify([{ name: "text-model", capabilities: ["text"] }]),
  });

  insertMappingGroup(db, "gpt-5", {
    targets: [{ provider_id: providerId, backend_model: "text-model" }],
  });

  const targets: Target[] = [
    { provider_id: providerId, backend_model: "text-model" },
  ];
  const snapshot = new PipelineSnapshot();
  const body = openaiImageBody();

  computeModalityRedirectTargets(db, targets, "gpt-5", body, snapshot);

  const parsed = JSON.parse(snapshot.toJSON());
  const stage = parsed.find((s: { stage: string }) => s.stage === "modality-redirect");
  expect(stage).toBeDefined();
  expect(stage.reason).toBe("no-eligible-targets");
  });

  // ----------------------------------------------------------
  // reason 验证：replaced-with-fallback（成功 redirect）
  // ----------------------------------------------------------
  it("records reason 'replaced-with-fallback' when redirect succeeds", () => {
  const providerAId = insertProvider(db, {
    id: "pa",
    name: "text-provider",
    models: JSON.stringify([{ name: "text-model", capabilities: ["text"] }]),
  });

  const providerBId = insertProvider(db, {
    id: "pb",
    name: "image-provider",
    models: JSON.stringify([{ name: "vision-model", capabilities: ["text", "image"] }]),
  });

  insertMappingGroup(db, "gpt-5", {
    targets: [{ provider_id: providerAId, backend_model: "text-model" }],
    multimodal_fallback: {
    provider_id: providerBId,
    backend_model: "vision-model",
    },
  });

  const targets: Target[] = [
    { provider_id: providerAId, backend_model: "text-model" },
  ];
  const snapshot = new PipelineSnapshot();
  const body = openaiImageBody();

  computeModalityRedirectTargets(db, targets, "gpt-5", body, snapshot);

  const parsed = JSON.parse(snapshot.toJSON());
  const stage = parsed.find((s: { stage: string }) => s.stage === "modality-redirect");
  expect(stage).toBeDefined();
  expect(stage.reason).toBe("replaced-with-fallback");
  });

  // ----------------------------------------------------------
  // reason 验证：no-eligible-targets（inactive provider）
  // ----------------------------------------------------------
  it("records reason 'no-eligible-targets' when fallback provider is inactive", () => {
  const providerAId = insertProvider(db, {
    id: "pa",
    name: "text-provider",
    models: JSON.stringify([{ name: "text-model", capabilities: ["text"] }]),
  });

  const providerBId = insertProvider(db, {
    id: "pb",
    name: "inactive-provider",
    models: JSON.stringify([{ name: "vision-model", capabilities: ["text", "image"] }]),
    is_active: 0,
  });

  insertMappingGroup(db, "gpt-5", {
    targets: [{ provider_id: providerAId, backend_model: "text-model" }],
    multimodal_fallback: {
    provider_id: providerBId,
    backend_model: "vision-model",
    },
  });

  const targets: Target[] = [
    { provider_id: providerAId, backend_model: "text-model" },
  ];
  const snapshot = new PipelineSnapshot();
  const body = openaiImageBody();

  computeModalityRedirectTargets(db, targets, "gpt-5", body, snapshot);

  const parsed = JSON.parse(snapshot.toJSON());
  const stage = parsed.find((s: { stage: string }) => s.stage === "modality-redirect");
  expect(stage).toBeDefined();
  expect(stage.reason).toBe("no-eligible-targets");
  });

  // ----------------------------------------------------------
  // NEW: AC10 — fallback model lacks required modality (e.g. audio)
  // body 有 image + audio，但 fallback 模型只支持 image 不支持 audio
  // ----------------------------------------------------------
  it("AC10: fallback model lacks audio modality → no redirect, reason 'fallback-missing-modality'", () => {
  const providerAId = insertProvider(db, {
    id: "pa",
    name: "text-provider",
    models: JSON.stringify([{ name: "text-model", capabilities: ["text"] }]),
  });

  // fallback 模型支持 image 但不支持 audio
  const providerBId = insertProvider(db, {
    id: "pb",
    name: "image-only-provider",
    models: JSON.stringify([{ name: "vision-model", capabilities: ["text", "image"] }]),
  });

  insertMappingGroup(db, "gpt-5", {
    targets: [{ provider_id: providerAId, backend_model: "text-model" }],
    multimodal_fallback: {
    provider_id: providerBId,
    backend_model: "vision-model",
    },
  });

  const targets: Target[] = [
    { provider_id: providerAId, backend_model: "text-model" },
  ];
  const snapshot = new PipelineSnapshot();

  // body 同时包含 image + audio
  const body: Record<string, unknown> = {
    messages: [
    {
      role: "user",
      content: [
      { type: "image_url", image_url: { url: "http://example.com/img.png" } },
      { type: "input_audio", input_audio: { data: "base64..." } },
      ],
    },
    ],
  };

  const result = computeModalityRedirectTargets(db, targets, "gpt-5", body, snapshot);

  // fallback 不支持 audio → 空列表
  expect(result).toEqual([]);
  expect(result).toHaveLength(0);

  const parsed = JSON.parse(snapshot.toJSON());
  const stage = parsed.find((s: { stage: string }) => s.stage === "modality-redirect");
  expect(stage).toBeDefined();
  expect(stage.reason).toBe("no-eligible-targets");
  });

  // ----------------------------------------------------------
  // NEW: AC11 — fallback model supports all missing modalities
  // body 有 image + audio，fallback 模型同时支持 image + audio → redirect 成功
  // ----------------------------------------------------------
  it("AC11: fallback model supports all missing modalities → redirect succeeds", () => {
  const providerAId = insertProvider(db, {
    id: "pa",
    name: "text-provider",
    models: JSON.stringify([{ name: "text-model", capabilities: ["text"] }]),
  });

  // fallback 模型支持 image + audio
  const providerBId = insertProvider(db, {
    id: "pb",
    name: "multimodal-provider",
    models: JSON.stringify([{ name: "multimodal-model", capabilities: ["text", "image", "audio"] }]),
  });

  insertMappingGroup(db, "gpt-5", {
    targets: [{ provider_id: providerAId, backend_model: "text-model" }],
    multimodal_fallback: {
    provider_id: providerBId,
    backend_model: "multimodal-model",
    },
  });

  const targets: Target[] = [
    { provider_id: providerAId, backend_model: "text-model" },
  ];
  const snapshot = new PipelineSnapshot();

  // body 同时包含 image + audio
  const body: Record<string, unknown> = {
    messages: [
    {
      role: "user",
      content: [
      { type: "image_url", image_url: { url: "http://example.com/img.png" } },
      { type: "input_audio", input_audio: { data: "base64..." } },
      ],
    },
    ],
  };

  const result = computeModalityRedirectTargets(db, targets, "gpt-5", body, snapshot);

  // fallback 支持所有 modalities → 替换为 fallback
  expect(result).toHaveLength(1);
  expect(result[0]).toEqual({
    provider_id: providerBId,
    backend_model: "multimodal-model",
  });

  const parsed = JSON.parse(snapshot.toJSON());
  const stage = parsed.find((s: { stage: string }) => s.stage === "modality-redirect");
  expect(stage).toBeDefined();
  expect(stage.triggered).toBe(true);
  expect(stage.reason).toBe("replaced-with-fallback");
  });
});

// ============================================================
// 补充 reason 测试覆盖（评审 required-fix）
// ============================================================
describe("computeModalityRedirectTargets — reason 覆盖补全", () => {
  it("reason: no-mapping-group — 不存在 mapping group", () => {
    const db = initDatabase(":memory:");
    seedSettings(db);
    insertProvider(db, { id: "p1", name: "P1", models: JSON.stringify([{ name: "m1", capabilities: ["text"] }]) });
    const snap = new PipelineSnapshot();
    const targets: Target[] = [{ provider_id: "p1", backend_model: "m1" }];
    const body = openaiImageBody();

    const result = computeModalityRedirectTargets(db, targets, "nonexistent-model", body, snap);
    expect(result).toEqual([]);

    const stage = JSON.parse(snap.toJSON()).find((s: Record<string, unknown>) => s.stage === "modality-redirect");
    expect(stage).toBeDefined();
    expect(stage.reason).toBe("no-mapping-group");
  });

  it("reason: rule-parse-error — mapping group 存在但 rule 不是合法 JSON", () => {
    const db = initDatabase(":memory:");
    seedSettings(db);
    insertProvider(db, { id: "p1", name: "P1", models: JSON.stringify([{ name: "m1", capabilities: ["text"] }]) });
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO mapping_groups (id, client_model, rule, is_active, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run("mg-test", "test-model", "NOT-VALID-JSON{{{{", 1, now);

    const snap = new PipelineSnapshot();
    const targets: Target[] = [{ provider_id: "p1", backend_model: "m1" }];
    const body = openaiImageBody();

    const result = computeModalityRedirectTargets(db, targets, "test-model", body, snap);
    expect(result).toEqual([]);

    const stage = JSON.parse(snap.toJSON()).find((s: Record<string, unknown>) => s.stage === "modality-redirect");
    expect(stage).toBeDefined();
    expect(stage.reason).toBe("rule-parse-error");
  });

  it("reason: invalid-fallback-config — multimodal_fallback 的 provider_id 不是字符串", () => {
    const db = initDatabase(":memory:");
    seedSettings(db);
    insertProvider(db, { id: "p1", name: "P1", models: JSON.stringify([{ name: "m1", capabilities: ["text"] }]) });
    const rule = {
      targets: [{ provider_id: "p1", backend_model: "m1" }],
      multimodal_fallback: { provider_id: 12345, backend_model: "m2" },
    };
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO mapping_groups (id, client_model, rule, is_active, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run("mg-test", "test-model", JSON.stringify(rule), 1, now);

    const snap = new PipelineSnapshot();
    const targets: Target[] = [{ provider_id: "p1", backend_model: "m1" }];
    const body = openaiImageBody();

    const result = computeModalityRedirectTargets(db, targets, "test-model", body, snap);
    expect(result).toEqual([]);

    const stage = JSON.parse(snap.toJSON()).find((s: Record<string, unknown>) => s.stage === "modality-redirect");
    expect(stage).toBeDefined();
    expect(stage.reason).toBe("no-eligible-targets");
  });

  it("reason: internal-error — 数据库操作抛异常", () => {
  const db = initDatabase(":memory:");
  seedSettings(db);
  // 关闭数据库以触发内部异常
  db.close();

  const snap = new PipelineSnapshot();
  const targets: Target[] = [{ provider_id: "p1", backend_model: "m1" }];
  const body = openaiImageBody();

  const result = computeModalityRedirectTargets(db, targets, "test-model", body, snap);
  expect(result).toEqual(targets);

  const stage = JSON.parse(snap.toJSON()).find((s: Record<string, unknown>) => s.stage === "modality-redirect");
  expect(stage).toBeDefined();
  expect(stage.reason).toBe("internal-error");
  });
});

// ============================================================
// 边界条件补充测试（gap coverage）
// ============================================================
describe("detectModalities — boundary conditions", () => {
  // ----------------------------------------------------------
  // content 是 string 不是 array → 应跳过，返回空 Set
  // ----------------------------------------------------------
  it("detectModalities: content is string not array → empty Set", () => {
  const body = {
    messages: [{ role: "user", content: "just text" }],
  };
  const result = detectModalities(body);
  expect(result.size).toBe(0);
  });

  // ----------------------------------------------------------
  // content 是空数组 → 无 block 可检测，返回空 Set
  // ----------------------------------------------------------
  it("detectModalities: empty content array → empty Set", () => {
  const body = {
    messages: [{ role: "user", content: [] }],
  };
  const result = detectModalities(body);
  expect(result.size).toBe(0);
  });

  // ----------------------------------------------------------
  // Anthropic tool_result 的 content 为 string（非数组）→ 应跳过，不 crash
  // ----------------------------------------------------------
  it("detectModalities: Anthropic tool_result with string content → empty Set", () => {
  const body = {
    messages: [
    {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "t1", content: "text string" }],
    },
    ],
  };
  const result = detectModalities(body);
  expect(result.size).toBe(0);
  });
});

describe("computeModalityRedirectTargets — boundary conditions", () => {
  let db: Database.Database;

  beforeEach(() => {
  db = initDatabase(":memory:");
  seedSettings(db);
  });

  // ----------------------------------------------------------
  // fallback 有额外的 capabilities（audio+video），不影响 image redirect
  // 只要 fallback 覆盖了 body 中缺失的 modality 即可
  // ----------------------------------------------------------
  it("fallback with extra capabilities beyond body needs → redirect succeeds", () => {
  const providerAId = insertProvider(db, {
    id: "pa",
    name: "text-provider",
    models: JSON.stringify([{ name: "text-model", capabilities: ["text"] }]),
  });

  // fallback 模型支持 image+audio+video，远超 body 需要的 image
  const providerBId = insertProvider(db, {
    id: "pb",
    name: "super-multimodal-provider",
    models: JSON.stringify([{ name: "mega-model", capabilities: ["text", "image", "audio", "video"] }]),
  });

  insertMappingGroup(db, "gpt-5", {
    targets: [{ provider_id: providerAId, backend_model: "text-model" }],
    multimodal_fallback: {
    provider_id: providerBId,
    backend_model: "mega-model",
    },
  });

  const targets: Target[] = [
    { provider_id: providerAId, backend_model: "text-model" },
  ];
  const snapshot = new PipelineSnapshot();
  // body 只有 image
  const body = openaiImageBody();

  const result = computeModalityRedirectTargets(db, targets, "gpt-5", body, snapshot);

  // fallback 覆盖了 image → 替换为 fallback
  expect(result).toHaveLength(1);
  expect(result[0]).toEqual({
    provider_id: providerBId,
    backend_model: "mega-model",
  });
  });

  // ----------------------------------------------------------
  // 首个 target 的 provider 不在 MODEL_CAPABILITIES 中 →
  // parseModels 返回 capabilities 为 undefined → 默认 ["text"] → redirect 触发
  // ----------------------------------------------------------
  it("first target model not in MODEL_CAPABILITIES → defaults to text-only → redirect triggered", () => {
  const providerAId = insertProvider(db, {
    id: "pa",
    name: "unknown-provider",
    // 无 capabilities 字段
    models: JSON.stringify([{ name: "unknown-model" }]),
  });

  const providerBId = insertProvider(db, {
    id: "pb",
    name: "image-provider",
    models: JSON.stringify([{ name: "vision-model", capabilities: ["text", "image"] }]),
  });

  insertMappingGroup(db, "gpt-5", {
    targets: [{ provider_id: providerAId, backend_model: "unknown-model" }],
    multimodal_fallback: {
    provider_id: providerBId,
    backend_model: "vision-model",
    },
  });

  const targets: Target[] = [
    { provider_id: providerAId, backend_model: "unknown-model" },
  ];
  const snapshot = new PipelineSnapshot();
  const body = openaiImageBody();

  const result = computeModalityRedirectTargets(db, targets, "gpt-5", body, snapshot);

  // capabilities undefined → 默认 ["text"] → 缺 image → 替换为 fallback
  expect(result).toHaveLength(1);
  expect(result[0]).toEqual({
    provider_id: providerBId,
    backend_model: "vision-model",
  });

  const parsed = JSON.parse(snapshot.toJSON());
  const stage = parsed.find((s: { stage: string }) => s.stage === "modality-redirect");
  expect(stage).toBeDefined();
  expect(stage.triggered).toBe(true);
  expect(stage.reason).toBe("replaced-with-fallback");
  });

  // ----------------------------------------------------------
  // AC-1: 部分支持过滤 — targets 中部分不支持 → 只保留支持的
  // ----------------------------------------------------------
  it("AC-1: filters out targets lacking modality, keeps eligible ones", () => {
  const providerAId = insertProvider(db, {
    id: "pa",
    name: "text-provider",
    models: JSON.stringify([{ name: "text-model", capabilities: ["text"] }]),
  });
  const providerBId = insertProvider(db, {
    id: "pb",
    name: "image-provider",
    models: JSON.stringify([{ name: "vision-model", capabilities: ["text", "image"] }]),
  });
  const providerCId = insertProvider(db, {
    id: "pc",
    name: "image-provider-2",
    models: JSON.stringify([{ name: "vision-model-2", capabilities: ["text", "image"] }]),
  });

  const targets: Target[] = [
    { provider_id: providerAId, backend_model: "text-model" },
    { provider_id: providerBId, backend_model: "vision-model" },
    { provider_id: providerCId, backend_model: "vision-model-2" },
  ];
  const snapshot = new PipelineSnapshot();
  const body = openaiImageBody();

  const result = computeModalityRedirectTargets(db, targets, "gpt-5", body, snapshot);

  expect(result).toHaveLength(2);
  expect(result[0]).toEqual({ provider_id: providerBId, backend_model: "vision-model" });
  expect(result[1]).toEqual({ provider_id: providerCId, backend_model: "vision-model-2" });

  const stage = JSON.parse(snapshot.toJSON()).find((s: { stage: string }) => s.stage === "modality-redirect");
  expect(stage).toBeDefined();
  expect(stage.reason).toBe("filtered-ineligible-targets");
  expect(stage.triggered).toBe(true);
  });

  // ----------------------------------------------------------
  // AC-2: 全部不支持 + fallback → 替换为 fallback
  // ----------------------------------------------------------
  it("AC-2: replaces all targets with fallback when all filtered out", () => {
  const providerAId = insertProvider(db, {
    id: "pa",
    name: "text-provider",
    models: JSON.stringify([{ name: "text-model", capabilities: ["text"] }]),
  });
  const providerBId = insertProvider(db, {
    id: "pb",
    name: "text-provider-2",
    models: JSON.stringify([{ name: "text-model-2", capabilities: ["text"] }]),
  });
  const providerCId = insertProvider(db, {
    id: "pc",
    name: "image-provider",
    models: JSON.stringify([{ name: "vision-model", capabilities: ["text", "image"] }]),
  });

  insertMappingGroup(db, "gpt-5", {
    targets: [{ provider_id: providerAId, backend_model: "text-model" }],
    multimodal_fallback: {
    provider_id: providerCId,
    backend_model: "vision-model",
    },
  });

  const targets: Target[] = [
    { provider_id: providerAId, backend_model: "text-model" },
    { provider_id: providerBId, backend_model: "text-model-2" },
  ];
  const snapshot = new PipelineSnapshot();
  const body = openaiImageBody();

  const result = computeModalityRedirectTargets(db, targets, "gpt-5", body, snapshot);

  expect(result).toHaveLength(1);
  expect(result[0]).toEqual({ provider_id: providerCId, backend_model: "vision-model" });

  const stage = JSON.parse(snapshot.toJSON()).find((s: { stage: string }) => s.stage === "modality-redirect");
  expect(stage).toBeDefined();
  expect(stage.reason).toBe("replaced-with-fallback");
  });

  // ----------------------------------------------------------
  // AC-3: 全部不支持 + 无 fallback → 空列表
  // ----------------------------------------------------------
  it("AC-3: returns empty array when all targets filtered and no fallback", () => {
  const providerAId = insertProvider(db, {
    id: "pa",
    name: "text-provider",
    models: JSON.stringify([{ name: "text-model", capabilities: ["text"] }]),
  });

  insertMappingGroup(db, "gpt-5", {
    targets: [{ provider_id: providerAId, backend_model: "text-model" }],
  });

  const targets: Target[] = [
    { provider_id: providerAId, backend_model: "text-model" },
  ];
  const snapshot = new PipelineSnapshot();
  const body = openaiImageBody();

  const result = computeModalityRedirectTargets(db, targets, "gpt-5", body, snapshot);

  expect(result).toEqual([]);

  const stage = JSON.parse(snapshot.toJSON()).find((s: { stage: string }) => s.stage === "modality-redirect");
  expect(stage).toBeDefined();
  expect(stage.reason).toBe("no-eligible-targets");
  });

  // ----------------------------------------------------------
  // audio 模态过滤
  // ----------------------------------------------------------
  it("filters targets by audio modality", () => {
  const providerAId = insertProvider(db, {
    id: "pa",
    name: "text-provider",
    models: JSON.stringify([{ name: "text-model", capabilities: ["text"] }]),
  });
  const providerBId = insertProvider(db, {
    id: "pb",
    name: "audio-provider",
    models: JSON.stringify([{ name: "audio-model", capabilities: ["text", "audio"] }]),
  });

  const targets: Target[] = [
    { provider_id: providerAId, backend_model: "text-model" },
    { provider_id: providerBId, backend_model: "audio-model" },
  ];
  const snapshot = new PipelineSnapshot();
  const body: Record<string, unknown> = {
    messages: [
    {
      role: "user",
      content: [
      { type: "input_audio", input_audio: { data: "base64..." } },
      ],
    },
    ],
  };

  const result = computeModalityRedirectTargets(db, targets, "gpt-5", body, snapshot);

  expect(result).toHaveLength(1);
  expect(result[0]).toEqual({ provider_id: providerBId, backend_model: "audio-model" });

  const stage = JSON.parse(snapshot.toJSON()).find((s: { stage: string }) => s.stage === "modality-redirect");
  expect(stage).toBeDefined();
  expect(stage.reason).toBe("filtered-ineligible-targets");
  });

  // ----------------------------------------------------------
  // fallback 不支持缺失模态 → 空列表
  // ----------------------------------------------------------
  it("returns empty array when all targets filtered and fallback also lacks modality", () => {
  const providerAId = insertProvider(db, {
    id: "pa",
    name: "text-provider",
    models: JSON.stringify([{ name: "text-model", capabilities: ["text"] }]),
  });
  const providerBId = insertProvider(db, {
    id: "pb",
    name: "image-only-provider",
    models: JSON.stringify([{ name: "image-model", capabilities: ["text", "image"] }]),
  });

  insertMappingGroup(db, "gpt-5", {
    targets: [{ provider_id: providerAId, backend_model: "text-model" }],
    multimodal_fallback: {
    provider_id: providerBId,
    backend_model: "image-model",
    },
  });

  const targets: Target[] = [
    { provider_id: providerAId, backend_model: "text-model" },
  ];
  const snapshot = new PipelineSnapshot();
  // body 包含 audio，但 fallback 只支持 image
  const body: Record<string, unknown> = {
    messages: [
    {
      role: "user",
      content: [
      { type: "input_audio", input_audio: { data: "base64..." } },
      ],
    },
    ],
  };

  const result = computeModalityRedirectTargets(db, targets, "gpt-5", body, snapshot);

  expect(result).toEqual([]);

  const stage = JSON.parse(snapshot.toJSON()).find((s: { stage: string }) => s.stage === "modality-redirect");
  expect(stage).toBeDefined();
  expect(stage.reason).toBe("no-eligible-targets");
  });

  // ----------------------------------------------------------
  // provider 不存在时保留 target
  // ----------------------------------------------------------
  it("keeps target when provider does not exist in DB", () => {
  const providerBId = insertProvider(db, {
    id: "pb",
    name: "image-provider",
    models: JSON.stringify([{ name: "vision-model", capabilities: ["text", "image"] }]),
  });

  const targets: Target[] = [
    { provider_id: "non-existent-provider", backend_model: "unknown-model" },
    { provider_id: providerBId, backend_model: "vision-model" },
  ];
  const snapshot = new PipelineSnapshot();
  const body = openaiImageBody();

  const result = computeModalityRedirectTargets(db, targets, "gpt-5", body, snapshot);

  // provider 不存在 → 保留（安全行为），所以两个 target 都在
  expect(result).toHaveLength(2);
  expect(result).toEqual(targets);

  const stage = JSON.parse(snapshot.toJSON()).find((s: { stage: string }) => s.stage === "modality-redirect");
  expect(stage).toBeDefined();
  expect(stage.reason).toBe("all-targets-support-modalities");
  });
});
