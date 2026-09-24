// Spec §12.2 (v1.2) duplicate prevention, run on every person create.

export type DedupeCandidate = {
  fullName: string;
  emailNorm: string | null;
  phoneE164: string | null;
  companyName: string | null;
};

export type DedupeRecord = DedupeCandidate & { id: string };

export type SoftReason = "company" | "email" | "phone";

export type DedupeResult<T extends DedupeRecord> =
  | { kind: "hard"; match: T; on: "email" | "phone" }
  | { kind: "soft"; match: T; on: SoftReason }
  | { kind: "none" };

// §12.2 rule 4: lowercase, spaces/hyphens/dots/apostrophes removed —
// "Tan Mei Ling", "Tan Meiling" and "TAN MEI-LING" compare equal.
export const normaliseName = (s: string) =>
  s.toLowerCase().replace(/[\s\-.'’]/g, "");

const normCompany = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const emailLocal = (e: string) => e.slice(0, e.indexOf("@"));
const emailDomain = (e: string) => e.slice(e.indexOf("@") + 1);
const last7 = (e164: string) => e164.replace(/\D/g, "").slice(-7);

export const SOFT_REASON_TEXT: Record<SoftReason, string> = {
  company: "Possible duplicate: same name and company as another person",
  email: "Possible duplicate: same name and email username as another person",
  phone:
    "Possible duplicate: same name and last 7 phone digits as another person",
};

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

  // Soft match needs the normalised name to match AND one more signal.
  // Never flag on name alone (rule 5) — "Tan Wei Ming" collides constantly.
  const name = normaliseName(candidate.fullName);
  if (!name) return { kind: "none" };

  for (const p of existing) {
    if (normaliseName(p.fullName) !== name) continue;

    if (
      candidate.companyName &&
      p.companyName &&
      normCompany(candidate.companyName) === normCompany(p.companyName)
    )
      return { kind: "soft", match: p, on: "company" };

    if (
      candidate.emailNorm &&
      p.emailNorm &&
      emailLocal(candidate.emailNorm) === emailLocal(p.emailNorm) &&
      emailDomain(candidate.emailNorm) !== emailDomain(p.emailNorm)
    )
      return { kind: "soft", match: p, on: "email" };

    if (
      candidate.phoneE164 &&
      p.phoneE164 &&
      last7(candidate.phoneE164) === last7(p.phoneE164)
    )
      return { kind: "soft", match: p, on: "phone" };
  }

  return { kind: "none" };
}
