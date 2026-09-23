import { normalizePhoneE164 } from "../format/phone.ts";

type Searchable = {
  fullName: string;
  email: string | null;
  phoneE164: string | null;
};

// Spec §7/§9.1: q matches name, email and phone. Typing "012-345 6789",
// "+60123456789" or "123456789" must all find the same person.
export function matchesPersonQuery(
  person: Searchable,
  rawQuery: string,
): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;

  if (person.fullName.toLowerCase().includes(q)) return true;
  if (person.email?.toLowerCase().includes(q)) return true;

  if (!person.phoneE164) return false;
  const e164 = normalizePhoneE164(rawQuery);
  if (e164) return person.phoneE164 === e164;

  // Partial number: match digits anywhere in the stored number.
  const digits = rawQuery.replace(/\D/g, "");
  return (
    digits.length >= 6 && person.phoneE164.replace(/\D/g, "").includes(digits)
  );
}
