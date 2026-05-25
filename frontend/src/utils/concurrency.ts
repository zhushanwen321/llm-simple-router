import type { ProviderConcurrencySnapshot } from "@/types/monitor";

export const CONCURRENCY_WARNING_THRESHOLD = 0.5;
export const CONCURRENCY_DANGER_THRESHOLD = 0.8;

export function effectiveLimit(provider: ProviderConcurrencySnapshot): number {
  return provider.adaptiveLimit ?? provider.maxConcurrency;
}

export function concurrencyBarClass(active: number, max: number): string {
  const ratio = max > 0 ? active / max : 0;
  if (ratio >= CONCURRENCY_DANGER_THRESHOLD) return "bg-danger";
  if (ratio >= CONCURRENCY_WARNING_THRESHOLD) return "bg-warning";
  return "bg-primary";
}

export function concurrencyRatioClass(active: number, max: number): string {
  const ratio = max > 0 ? active / max : 0;
  if (ratio >= CONCURRENCY_DANGER_THRESHOLD) return "text-danger";
  return "";
}
