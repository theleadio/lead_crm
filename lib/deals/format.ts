import type { Stage } from "./types.ts";

// Board card helpers (spec §9.5). Pure, so the board and tests share them.

const DAY = 24 * 60 * 60 * 1000;
const localMidnight = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

// Whole days since stage_changed_at, counted on the viewer's local day
// boundary so a card doesn't change color at odd hours (design decision 7).
export function daysInStage(stageChangedAt: string, now = new Date()): number {
  const days = Math.round(
    (localMidnight(now) - localMidnight(new Date(stageChangedAt))) / DAY,
  );
  return Math.max(0, days);
}

// Amber above 7 days, red above 14. Won and lost are never aged.
export function agingTone(
  stage: Stage,
  days: number,
): "none" | "amber" | "red" {
  if (stage === "won" || stage === "lost") return "none";
  if (days > 14) return "red";
  if (days > 7) return "amber";
  return "none";
}

// Optimistic header totals while a move is in flight; the server's
// stageTotals replace them right after. Whole sen, so no float drift.
export function addMyr(total: string, amount: string | null, sign: 1 | -1) {
  const sen = (s: string) => Math.round(Number(s) * 100);
  return ((sen(total) + sign * sen(amount ?? "0")) / 100).toFixed(2);
}

export function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return (
    parts[0][0] + (parts.length > 1 ? parts.at(-1)![0] : "")
  ).toUpperCase();
}

// A number to start the §9.6 Value field from: the course list price, times
// the headcount on a corporate deal. The value is sales' own forecast and
// revenue never reads it (§12.7), so this is a suggestion and nothing else —
// null whenever there is nothing honest to suggest. Whole sen, like addMyr.
export function suggestDealValue(
  listPriceMyr: string | null | undefined,
  headcount: string,
): { amount: string; seats: number } | null {
  const price = Number(listPriceMyr);
  if (!listPriceMyr || !Number.isFinite(price) || price <= 0) return null;
  const asked = Math.trunc(Number(headcount));
  const seats = Number.isFinite(asked) && asked > 1 ? asked : 1;
  return {
    amount: ((Math.round(price * 100) * seats) / 100).toFixed(2),
    seats,
  };
}
