/**
 * Thrown when a provider's concurrency queue is full.
 */
export class SemaphoreQueueFullError extends Error {
  constructor(public readonly providerId: string) {
    super(`Provider '${providerId}' concurrency queue is full`);
    this.name = "SemaphoreQueueFullError";
  }
}

/**
 * Thrown when a provider's concurrency wait times out.
 */
export class SemaphoreTimeoutError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly timeoutMs: number,
  ) {
    super(
      `Provider '${providerId}' concurrency wait timeout (${timeoutMs}ms)`,
    );
    this.name = "SemaphoreTimeoutError";
  }
}
