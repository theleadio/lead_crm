import { normalizePhoneE164 } from "../format/phone.ts";

// Spec §7/§9.1: q matches name, email and phone. Typing "012-345 6789",
// "+60123456789" or "123456789" must all find the same person.
export type PersonQuery = {
  text: string; // matched against name and email (case-insensitive)
  phoneE164: string | null; // a complete number → exact match
  digits: string | null; // a partial number (6+ digits) → substring match
};

export function parsePersonQuery(raw: string): PersonQuery | null {
  const text = raw.trim();
  if (!text) return null;
  const phoneE164 = normalizePhoneE164(text);
  const digits = text.replace(/\D/g, "");
  return {
    text,
    phoneE164,
    digits: !phoneE164 && digits.length >= 6 ? digits : null,
  };
}

// Escape LIKE wildcards so a user typing "%" or "_" searches for them.
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
