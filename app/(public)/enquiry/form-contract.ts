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
  return crypto.randomUUID();
}
