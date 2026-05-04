import type { SSEClient } from "llm-router-core/monitor";

/** Adapt Node.js ServerResponse to core SSEClient interface. */
export function adaptSSEClient(res: import("node:http").ServerResponse): SSEClient {
  return {
    write(data: string) { res.write(data); },
    end() { res.end(); },
    get writableEnded() { return res.writableEnded; },
    on(event: string, callback: () => void) {
      if (event === "close") {
        res.on("close", callback);
      }
    },
  };
}
