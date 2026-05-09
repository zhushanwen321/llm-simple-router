import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * pi-client-id extension
 *
 * 给 pi 的所有出站请求添加 x-client-type: pi-coding-agent 自定义 header，
 * 供 llm-simple-router 代理识别请求来自 pi（而非 Claude Code）。
 *
 * 原理：
 * - pi 通过 ~/.pi/agent/models.json 中的自定义 provider 配置路由到代理
 * - pi.registerProvider() 支持 headers 选项，会附加到每个 HTTP 请求
 * - 代理端检测 x-client-type header 即可识别客户端
 *
 * 依赖：无（仅使用 Node.js 内置模块和 pi 的 ExtensionAPI）
 */
export default function (pi: ExtensionAPI): void {
  const modelsPath = join(homedir(), ".pi", "agent", "models.json");

  if (!existsSync(modelsPath)) {
    console.warn("[pi-client-id] ~/.pi/agent/models.json not found, skipping");
    return;
  }

  try {
    const raw = readFileSync(modelsPath, "utf-8");
    const config = JSON.parse(raw) as {
      providers?: Record<string, Record<string, unknown>>;
    };

    if (!config.providers || Object.keys(config.providers).length === 0) {
      return;
    }

    for (const [name, providerConfig] of Object.entries(config.providers)) {
      const existingHeaders =
        (providerConfig.headers as Record<string, string> | undefined) ?? {};

      pi.registerProvider(name, {
        ...providerConfig,
        headers: {
          ...existingHeaders,
          "x-client-type": "pi-coding-agent",
        },
      });
    }

    const count = Object.keys(config.providers).length;
    console.log(
      `[pi-client-id] Added x-client-type header to ${count} provider(s): ${Object.keys(config.providers).join(", ")}`,
    );
  } catch (err) {
    console.error("[pi-client-id] Failed to parse models.json:", err);
  }
}
