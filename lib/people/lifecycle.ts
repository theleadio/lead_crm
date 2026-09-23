import type { LifecycleStage } from "./types.ts";

// Spec §12.3 — computed, never stored as truth.
export function computeLifecycleStage(facts: {
  hasSucceededPayment: boolean;
  hasEnrolmentConfirmedOrLater: boolean;
}): LifecycleStage {
  if (facts.hasSucceededPayment) return "customer";
  if (facts.hasEnrolmentConfirmedOrLater) return "student";
  return "lead";
}
