import { normalizePhoneE164 } from "../format/phone.ts";

// Spec §7/§9.1: q matches name, email and phone. Typing "012-345 6789",
// "+60123456789" or "123456789" must all find the same person.
export type PersonQuery = {
  text: string; // matched against name and email (case-insensitive)
  phoneE164: string | null; // a complete number → exact match
  digits: string | null; // a partial number (3+ digits) → substring match
};

export function parsePersonQuery(raw: string): PersonQuery | null {
  const text = raw.trim();
  if (!text) return null;
  const phoneE164 = normalizePhoneE164(text);
  const digits = text.replace(/\D/g, "");
  // Keep digits even when the whole thing normalised: "0123456789" becomes
  // +60123456789, so the typed digits are not a substring of the stored ones.
  return { text, phoneE164, digits: digits.length >= 3 ? digits : null };
}

// Escape LIKE wildcards so a user typing "%" or "_" searches for them.
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
