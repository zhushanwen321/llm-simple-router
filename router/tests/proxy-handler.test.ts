// handleProxyRequest has been deleted and replaced by create-proxy-handler.ts + failover-loop.ts.
// The original tests directly called the deleted function, making them inapplicable.
// Integration tests for the new architecture are covered by:
// - tests/openai-proxy.test.ts
// - tests/anthropic-proxy.test.ts
// - tests/failover-log-grouping.test.ts
import { describe, it, expect } from "vitest";

describe.skip("handleProxyRequest (deleted — replaced by create-proxy-handler + failover-loop)", () => {
  it("placeholder", () => {
    expect(true).toBe(true);
  });
});
