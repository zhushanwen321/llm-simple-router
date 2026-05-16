/**
 * T2: computeImageRedirectTargets() TDD 测试
 *
 * 被测文件：src/proxy/routing/image-redirect.ts（尚未实现）
 * 所有测试必须 FAIL — 函数和文件均不存在
 */
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initDatabase } from "../src/db/index.js";
import { seedSettings } from "./helpers/test-setup.js";
import type { Target } from "../src/core/types.js";
import { PipelineSnapshot } from "../src/proxy/pipeline-snapshot.js";

// 被测函数——文件不存在，import 会失败
import {
  computeImageRedirectTargets,
} from "../src/proxy/routing/image-redirect.js";

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

/** Anthropic tool_result 内嵌图片（regression: IR 层漏检 tool_result.content[] 中的 image block） */
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

/** 构造 Responses API 图片请求体（input[] 含 type="input_image"） */
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
// 测试套件
// ============================================================

describe("computeImageRedirectTargets", () => {
  let db: Database.Database;

  beforeEach(() => {
  db = initDatabase(":memory:");
  seedSettings(db);
  });

  // ----------------------------------------------------------
  // AC1: 有图片 + 首 target 不支持 + 有 fallback → prepend fallback
  // ----------------------------------------------------------
  it("AC1: prepends fallback target when image detected and first target lacks image capability", () => {
  // Provider A: text-only 模型
  const providerAId = insertProvider(db, {
    id: "pa",
    name: "text-provider",
    models: JSON.stringify([{ name: "text-model", capabilities: ["text"] }]),
  });

  // Provider B: image-capable 模型（fallback provider）
  const providerBId = insertProvider(db, {
    id: "pb",
    name: "image-provider",
    models: JSON.stringify([{ name: "vision-model", capabilities: ["text", "image"] }]),
  });

  // mapping group 带 image_fallback
  insertMappingGroup(db, "gpt-5", {
    targets: [{ provider_id: providerAId, backend_model: "text-model" }],
    image_fallback: {
    provider_id: providerBId,
    backend_model: "vision-model",
    },
  });

  const targets: Target[] = [
    { provider_id: providerAId, backend_model: "text-model" },
  ];
  const snapshot = new PipelineSnapshot();
  const body = openaiImageBody();

  const result = computeImageRedirectTargets(db, targets, "gpt-5", body, snapshot);

  // 应 prepend fallback target
  expect(result).toHaveLength(2);
  expect(result[0]).toEqual({
    provider_id: providerBId,
    backend_model: "vision-model",
  });
  expect(result[1]).toEqual({
    provider_id: providerAId,
    backend_model: "text-model",
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

  const result = computeImageRedirectTargets(db, targets, "gpt-5", body, snapshot);

  expect(result).toEqual(targets);
  expect(result).toHaveLength(1);
  });

  // ----------------------------------------------------------
  // AC3: 有图片 + 首 target 不支持 + 无 fallback → 不扩展
  // ----------------------------------------------------------
  it("AC3: returns original targets when no image_fallback configured in mapping group", () => {
  const providerId = insertProvider(db, {
    id: "p1",
    name: "text-provider",
    models: JSON.stringify([{ name: "text-model", capabilities: ["text"] }]),
  });

  // mapping group 不含 image_fallback
  insertMappingGroup(db, "gpt-5", {
    targets: [{ provider_id: providerId, backend_model: "text-model" }],
  });

  const targets: Target[] = [
    { provider_id: providerId, backend_model: "text-model" },
  ];
  const snapshot = new PipelineSnapshot();
  const body = openaiImageBody();

  const result = computeImageRedirectTargets(db, targets, "gpt-5", body, snapshot);

  expect(result).toEqual(targets);
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
    image_fallback: {
    provider_id: "pb",
    backend_model: "vision-model",
    },
  });

  const targets: Target[] = [
    { provider_id: providerId, backend_model: "text-model" },
  ];
  const snapshot = new PipelineSnapshot();
  const body = openaiTextBody(); // 纯文本

  const result = computeImageRedirectTargets(db, targets, "gpt-5", body, snapshot);

  expect(result).toEqual(targets);
  });

  // ----------------------------------------------------------
  // AC7: fallback provider 非 active → 不扩展
  // ----------------------------------------------------------
  it("AC7: returns original targets when fallback provider is inactive", () => {
  const providerAId = insertProvider(db, {
    id: "pa",
    name: "text-provider",
    models: JSON.stringify([{ name: "text-model", capabilities: ["text"] }]),
  });

  // fallback provider 设为 inactive
  const providerBId = insertProvider(db, {
    id: "pb",
    name: "inactive-vision-provider",
    models: JSON.stringify([{ name: "vision-model", capabilities: ["text", "image"] }]),
    is_active: 0,
  });

  insertMappingGroup(db, "gpt-5", {
    targets: [{ provider_id: providerAId, backend_model: "text-model" }],
    image_fallback: {
    provider_id: providerBId,
    backend_model: "vision-model",
    },
  });

  const targets: Target[] = [
    { provider_id: providerAId, backend_model: "text-model" },
  ];
  const snapshot = new PipelineSnapshot();
  const body = openaiImageBody();

  const result = computeImageRedirectTargets(db, targets, "gpt-5", body, snapshot);

  expect(result).toEqual(targets);
  });

  // ----------------------------------------------------------
  // AC8: fallback provider_id 不存在 → 不扩展
  // ----------------------------------------------------------
  it("AC8: returns original targets when fallback provider_id does not exist in DB", () => {
  const providerAId = insertProvider(db, {
    id: "pa",
    name: "text-provider",
    models: JSON.stringify([{ name: "text-model", capabilities: ["text"] }]),
  });

  insertMappingGroup(db, "gpt-5", {
    targets: [{ provider_id: providerAId, backend_model: "text-model" }],
    image_fallback: {
    provider_id: "non-existent-provider-id",
    backend_model: "vision-model",
    },
  });

  const targets: Target[] = [
    { provider_id: providerAId, backend_model: "text-model" },
  ];
  const snapshot = new PipelineSnapshot();
  const body = openaiImageBody();

  const result = computeImageRedirectTargets(db, targets, "gpt-5", body, snapshot);

  expect(result).toEqual(targets);
  });

  // ----------------------------------------------------------
  // AC9: 触发时记录 StageRecord
  // ----------------------------------------------------------
  it("AC9: records image-redirect StageRecord in snapshot when triggered", () => {
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
    image_fallback: {
    provider_id: providerBId,
    backend_model: "vision-model",
    },
  });

  const targets: Target[] = [
    { provider_id: providerAId, backend_model: "text-model" },
  ];
  const snapshot = new PipelineSnapshot();
  const body = openaiImageBody();

  computeImageRedirectTargets(db, targets, "gpt-5", body, snapshot);

  // 验证 snapshot JSON 包含 "image-redirect" stage
  const snapshotJson = snapshot.toJSON();
  const parsed = JSON.parse(snapshotJson);
  const irStage = parsed.find(
    (s: { stage: string }) => s.stage === "image-redirect",
  );
  expect(irStage).toBeDefined();
  expect(irStage.triggered).toBe(true);
  expect(irStage.original_model).toBe("text-model");
  expect(irStage.redirect_to).toBe("vision-model");
  expect(irStage.redirect_provider).toBe(providerBId);
  });

  // ----------------------------------------------------------
  // AC10: 异常安全 → 返回原始 targets
  // ----------------------------------------------------------
  it("AC10: returns original targets when internal logic throws exception", () => {
  // 不插入任何 provider 或 mapping group，
  // 函数内部查询会返回 undefined，任何未防御的访问都会抛异常。
  // 但函数应该 catch 所有异常并返回原始 targets。
  const targets: Target[] = [
    { provider_id: "pa", backend_model: "text-model" },
  ];
  const snapshot = new PipelineSnapshot();
  const body = openaiImageBody();

  const result = computeImageRedirectTargets(db, targets, "nonexistent-model", body, snapshot);

  // 异常降级：返回原始 targets
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
    image_fallback: {
    provider_id: providerBId,
    backend_model: "vision-model",
    },
  });

  const targets: Target[] = [
    { provider_id: providerAId, backend_model: "text-model" },
  ];
  const snapshot = new PipelineSnapshot();
  const body = openaiImageBody(); // OpenAI image_url 格式

  const result = computeImageRedirectTargets(db, targets, "gpt-5", body, snapshot);

  // 应检测到图片并 prepend fallback
  expect(result).toHaveLength(2);
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
    image_fallback: {
    provider_id: providerBId,
    backend_model: "vision-model",
    },
  });

  const targets: Target[] = [
    { provider_id: providerAId, backend_model: "text-model" },
  ];
  const snapshot = new PipelineSnapshot();
  const body = anthropicImageBody(); // Anthropic image 格式

  const result = computeImageRedirectTargets(db, targets, "claude-5", body, snapshot);

  expect(result).toHaveLength(2);
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
    image_fallback: {
    provider_id: providerBId,
    backend_model: "vision-model",
    },
  });

  const targets: Target[] = [
    { provider_id: providerAId, backend_model: "text-model" },
  ];
  const snapshot = new PipelineSnapshot();
  const body = openaiTextBody(); // content 为 string

  const result = computeImageRedirectTargets(db, targets, "gpt-5", body, snapshot);

  // 纯文本，不触发
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
    image_fallback: {
    provider_id: providerBId,
    backend_model: "vision-model",
    },
  });

  const targets: Target[] = [
    { provider_id: providerAId, backend_model: "text-model" },
  ];
  const snapshot = new PipelineSnapshot();
  const body = responsesApiImageBody(); // Responses API 嵌套 input_image

  const result = computeImageRedirectTargets(db, targets, "gpt-5", body, snapshot);

  expect(result).toHaveLength(2);
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
    image_fallback: {
    provider_id: providerBId,
    backend_model: "vision-model",
    },
  });

  const targets: Target[] = [
    { provider_id: providerAId, backend_model: "text-model" },
  ];
  const snapshot = new PipelineSnapshot();
  const body = responsesApiTopLevelImageBody(); // 顶层 input_image

  const result = computeImageRedirectTargets(db, targets, "gpt-5", body, snapshot);

  expect(result).toHaveLength(2);
  expect(result[0].backend_model).toBe("vision-model");
  });

  // ----------------------------------------------------------
  // 边界：空 targets 列表
  // ----------------------------------------------------------
  it("returns empty array when targets list is empty", () => {
  const snapshot = new PipelineSnapshot();
  const body = openaiImageBody();

  const result = computeImageRedirectTargets(db, [], "gpt-5", body, snapshot);

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
    image_fallback: {
    provider_id: "pb",
    backend_model: "vision-model",
    },
  });

  const targets: Target[] = [
    { provider_id: providerId, backend_model: "text-model" },
  ];
  const snapshot = new PipelineSnapshot();
  const body = {}; // 空 body

  const result = computeImageRedirectTargets(db, targets, "gpt-5", body, snapshot);

  expect(result).toEqual(targets);
  });

  // ----------------------------------------------------------
  // 边界：capabilities 缺失时默认为 ["text"]，应触发 redirect
  // （T1 的 MODEL_CAPABILITIES 白名单补充尚未实现时，缺失
  //   capabilities 的模型应被视为 text-only）
  // ----------------------------------------------------------
  it("treats model without capabilities as text-only and triggers redirect", () => {
  const providerAId = insertProvider(db, {
    id: "pa",
    name: "legacy-provider",
    models: JSON.stringify([{ name: "legacy-model" }]), // 无 capabilities
  });

  const providerBId = insertProvider(db, {
    id: "pb",
    name: "image-provider",
    models: JSON.stringify([{ name: "vision-model", capabilities: ["text", "image"] }]),
  });

  insertMappingGroup(db, "gpt-5", {
    targets: [{ provider_id: providerAId, backend_model: "legacy-model" }],
    image_fallback: {
    provider_id: providerBId,
    backend_model: "vision-model",
    },
  });

  const targets: Target[] = [
    { provider_id: providerAId, backend_model: "legacy-model" },
  ];
  const snapshot = new PipelineSnapshot();
  const body = openaiImageBody();

  const result = computeImageRedirectTargets(db, targets, "gpt-5", body, snapshot);

  // legacy-model 无 capabilities → 视为 text-only → 应 prepend fallback
  expect(result).toHaveLength(2);
  expect(result[0].backend_model).toBe("vision-model");
  });

  it('detects image inside Anthropic tool_result content', () => {
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
    image_fallback: {
    provider_id: providerBId,
    backend_model: "kimi-for-coding",
    },
  });

  const targets: Target[] = [
    { provider_id: providerAId, backend_model: "glm-5.1" },
  ];
  const snapshot = new PipelineSnapshot();
  // tool_result 内嵌图片 — 这是真实 bug case
  const body = anthropicToolResultImageBody();

  const result = computeImageRedirectTargets(db, targets, "glm-5.1", body, snapshot);

  expect(result).toHaveLength(2);
  expect(result[0].backend_model).toBe("kimi-for-coding");
  const parsed = JSON.parse(snapshot.toJSON());
  const irStage = parsed.find((s: { stage: string }) => s.stage === "image-redirect");
  expect(irStage).toBeDefined();
  expect(irStage.triggered).toBe(true);
  });
});