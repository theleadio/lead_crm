// Why a signup has no source on the Weekly tab, from facts about the person's
// touchpoints. Pure, so the rules are tested without a database; the query
// that gathers the facts is in scripts/backfill-signup-source.ts.

export type SignupFacts = {
  // Touchpoints of any kind, and of those, how many say where the person came
  // from (a channel other than import / payment_link, or a UTM or click id).
  touches: number;
  informativeBefore: number;
  informativeAfter: number;
  // A participant-sheet "self:..." touch dated after the signup.
  sheetSourceAfter: boolean;
};

export type NoSourceReason =
  | "has_source"
  | "sheet_source_dated_late"
  | "source_after_signup"
  | "bare_import_only"
  | "no_touchpoints";

export function noSourceReason(f: SignupFacts): NoSourceReason {
  if (f.informativeBefore > 0) return "has_source";
  if (f.sheetSourceAfter) return "sheet_source_dated_late";
  if (f.informativeAfter > 0) return "source_after_signup";
  return f.touches > 0 ? "bare_import_only" : "no_touchpoints";
}

// What Ops can do about each reason; printed by the backfill's dry run.
export const REASON_TEXT: Record<NoSourceReason, string> = {
  has_source: "has a source",
  sheet_source_dated_late:
    "sheet Source filled in after the signup was dated (backfill fixes this)",
  source_after_signup:
    "a source exists but is dated after the signup: check by hand",
  bare_import_only:
    "only an import / payment-link row with no tags: ask Ops how they came",
  no_touchpoints:
    "no touchpoint at all (staff-made or walk-in): ask Ops how they came",
};
