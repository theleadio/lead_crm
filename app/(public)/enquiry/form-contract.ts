// What the form and the action agree on. Deliberately free of server imports:
// the client component imports this, and anything reaching lib/public/ would
// drag the database into the browser bundle (tests/client-boundary.test.ts).

// Named like a field a careless bot will fill, kept off-screen and out of the
// accessibility tree. One `if` in the action and the cheapest bots are gone.
export const HONEYPOT_FIELD = "company_website";

export type EnquiryState = {
  status: "idle" | "error" | "success";
  // §13 wording for the whole form. Never a message from the §8.2 route:
  // those are written for an API caller.
  message: string | null;
  // Keyed by form field name, as §8.2's validation_failed returns them.
  fields: Record<string, string>;
};

export const EMPTY_STATE: EnquiryState = {
  status: "idle",
  message: null,
  fields: {},
};

export function isHoneypotFilled(form: FormData): boolean {
  const v = form.get(HONEYPOT_FIELD);
  return typeof v === "string" && v.trim() !== "";
}

// §8.2 step 8: one key per form instance, so a retry after a timeout returns
// the first result instead of creating a second lead. A UUID is letters,
// digits and hyphens, which is what leadSchema's key pattern allows.
export function newIdempotencyKey(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  // randomUUID exists only in a secure context, so over plain http — a phone
  // on the LAN checking the form — it is undefined and this initialiser would
  // throw during hydration and take the page with it. getRandomValues has no
  // such restriction. Laid out as a v4 UUID because O46 calls the key a UUID,
  // and §8.2 stores it in touchpoint.external_ref beside real ones.
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((n) => n.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}
