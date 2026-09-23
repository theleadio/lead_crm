// Spec §4: reject anything without a single @ and a dot in the domain;
// no cleverer validation than that.
export function isValidEmail(raw: string): boolean {
  const parts = raw.split("@");
  if (parts.length !== 2) return false;
  const [, domain] = parts;
  return domain.includes(".");
}

// Store both: email as typed, email_norm lowercased and trimmed.
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}
