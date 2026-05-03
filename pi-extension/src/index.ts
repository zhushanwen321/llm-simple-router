import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  SemaphoreManager,
  AdaptiveController,
  SessionTracker,
  StreamLoopGuard,
  ToolLoopGuard,
  NGramLoopDetector,
  DEFAULT_LOOP_PREVENTION_CONFIG,
  RequestTracker,
} from "@llm-router/core";
import { loadConfig } from "./config.js";

export default function (pi: ExtensionAPI) {
  const config = loadConfig();

  // --- Initialize core modules ---

  const semaphore = new SemaphoreManager();
  const adaptive = new AdaptiveController(semaphore);

  const loopConfig = config.loopPrevention;
  const sessionTracker = new SessionTracker(
    loopConfig.sessionTracker ?? DEFAULT_LOOP_PREVENTION_CONFIG.sessionTracker,
  );
  const toolGuard = new ToolLoopGuard(sessionTracker, loopConfig.toolCall);

  // Per-session stream guards
  const streamGuards = new Map<string, StreamLoopGuard>();

  const tracker = config.monitor.enabled
    ? new RequestTracker({ semaphoreManager: semaphore })
    : null;
  if (tracker) {
    tracker.setAdaptiveStatusProvider(adaptive);
  }

  // Inject concurrency config per provider
  for (const [provider, cfg] of Object.entries(config.concurrency)) {
    if (cfg.adaptive) {
      adaptive.init(provider, { max: cfg.maxConcurrency }, {
        queueTimeoutMs: cfg.queueTimeoutMs,
        maxQueueSize: cfg.maxQueueSize,
      });
    } else {
      semaphore.updateConfig(provider, cfg);
    }
  }

  // --- Hook into pi lifecycle ---

  pi.on("tool_call", async (event, _ctx) => {
    if (!loopConfig.enabled) return;

    const result = toolGuard.check("default", {
      toolName: event.toolName,
      inputText: JSON.stringify(event.input),
      inputHash: "",
      timestamp: Date.now(),
    });

    if (result.detected) {
      return { block: true, reason: `Tool loop detected: ${event.toolName}` };
    }
  });

  pi.on("message_update", async (event, _ctx) => {
    if (!loopConfig.enabled || !loopConfig.stream.enabled) return;

    const streamEvent = event.assistantMessageEvent;
    if (streamEvent.type !== "text_delta") return;

    let guard = streamGuards.get("default");
    if (!guard) {
      const detector = new NGramLoopDetector(loopConfig.stream.detectorConfig);
      guard = new StreamLoopGuard(loopConfig.stream, detector, (_reason: string) => {
        // Loop detected — could notify user or block via ctx.ui
      });
      streamGuards.set("default", guard);
    }

    guard.feed(streamEvent.delta);
  });

  // Use after_provider_response for adaptive feedback — it fires after
  // the HTTP response is received and provides status/headers.
  pi.on("after_provider_response", async (event, _ctx) => {
    // event.status is the HTTP status code
    const isError = event.status >= 500 || event.status === 429;
    // We don't know the provider ID from this event in pi's model,
    // so we apply feedback to all configured adaptive providers.
    for (const provider of Object.keys(config.concurrency)) {
      if (config.concurrency[provider].adaptive) {
        adaptive.onRequestComplete(provider, {
          success: !isError,
          statusCode: event.status,
        });
      }
    }
  });

  pi.on("session_shutdown", async (_event, _ctx) => {
    sessionTracker.stop();
    streamGuards.clear();
  });

  // --- Register tools ---

  pi.registerTool({
    name: "router_status",
    label: "Router Status",
    description: "查看当前并发控制、循环防护、请求监控的状态",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      const providers = Object.keys(config.concurrency);
      const concurrency = providers.map((p) => ({
        provider: p,
        ...semaphore.getStatus(p),
        adaptive: adaptive.getStatus(p),
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                concurrency,
                loopPrevention: { enabled: loopConfig.enabled },
                monitor: { enabled: config.monitor.enabled },
              },
              null,
              2,
            ),
          },
        ],
        details: {},
      };
    },
  });

  // --- Register commands ---

  pi.registerCommand("router-stats", {
    description: "显示 router 监控统计",
    handler: async (_args, ctx) => {
      if (!tracker) {
        ctx.ui.notify("Monitor is disabled", "warning");
        return;
      }
      const stats = tracker.getStats();
      ctx.ui.notify(JSON.stringify(stats, null, 2), "info");
    },
  });

  pi.registerCommand("router-reset", {
    description: "重置循环防护和监控统计",
    handler: async (_args, ctx) => {
      sessionTracker.stop();
      streamGuards.clear();
      ctx.ui.notify("Router state reset", "info");
    },
  });
}
