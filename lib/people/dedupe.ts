// Spec §12.2 duplicate prevention, run on every person create from any route.

export type DedupeCandidate = {
  fullName: string;
  emailNorm: string | null;
  phoneE164: string | null;
  companyName: string | null;
};

export type DedupeRecord = DedupeCandidate & { id: string };

export type DedupeResult<T extends DedupeRecord> =
  | { kind: "hard"; match: T; on: "email" | "phone" }
  | { kind: "soft"; match: T }
  | { kind: "none" };

const normName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export function findDuplicate<T extends DedupeRecord>(
  candidate: DedupeCandidate,
  existing: T[],
): DedupeResult<T> {
  // Hard match: same email_norm or same phone_e164 → use the existing person.
  for (const p of existing) {
    if (candidate.emailNorm && p.emailNorm === candidate.emailNorm)
      return { kind: "hard", match: p, on: "email" };
    if (candidate.phoneE164 && p.phoneE164 === candidate.phoneE164)
      return { kind: "hard", match: p, on: "phone" };
  }

  // Soft match: same full name + same company → create, but flag for review.
  // Never merge on name alone — "Tan Wei Ming" collides constantly.
  // ponytail: the spec's second soft rule ("near-identical name with one
  // matching identifier") is ambiguous — raised in §15.3, not guessed here.
  if (candidate.companyName) {
    const name = normName(candidate.fullName);
    const company = normName(candidate.companyName);
    const soft = existing.find(
      (p) =>
        p.companyName !== null &&
        normName(p.fullName) === name &&
        normName(p.companyName) === company,
    );
    if (soft) return { kind: "soft", match: soft };
  }

  return { kind: "none" };
}
