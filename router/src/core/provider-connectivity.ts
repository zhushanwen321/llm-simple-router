/**
 * Provider 连通性检查接口。
 * admin 层通过此接口检查上游 provider 的模型列表，解耦对 proxy 层的直接依赖。
 */

import type { RawHeaders } from "./types.js";

export interface ProviderConnectivityCheckResult {
  statusCode: number;
  body: string;
}

export interface ProviderConnectivityChecker {
  /**
   * 向上游 provider 发起 GET 请求获取模型列表。
   * @param backend 包含 base_url 的后端信息
   * @param apiKey API 密钥
   * @param clientHeaders 客户端原始请求头
   * @param upstreamPath 上游路径（如 /v1/models）
   * @param apiType API 类型，决定 header 构建方式
   */
  fetchModels(
    backend: { base_url: string },
    apiKey: string,
    clientHeaders: RawHeaders,
    upstreamPath: string,
    apiType: "openai" | "openai-responses" | "anthropic",
  ): Promise<ProviderConnectivityCheckResult>;
}
