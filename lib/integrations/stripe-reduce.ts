// What we keep of a Stripe event (spec §3, O35). Stripe keeps the original
// for as long as it likes, so our staging row holds only an allow-list: the
// fields the handlers read plus the customer's email and name, which Ops need
// to match an unmatched payment by hand. Nothing else is copied: no billing
// address, phone, card details, shipping or line items.

export type ReducedSession = {
  id: string;
  payment_intent: string | null;
  payment_status: string | null;
  amount_total: number | null;
  currency: string | null;
  client_reference_id: string | null;
  expires_at: number | null;
  payment_method_types: string[];
  metadata: Record<string, string>;
  customer_details: { email: string | null; name: string | null };
};

export type ReducedEvent = {
  id: string;
  type: string;
  created: number;
  session?: ReducedSession;
};

const str = (v: unknown, max = 500): string | null =>
  typeof v === "string" ? v.slice(0, max) : null;
const int = (v: unknown): number | null =>
  typeof v === "number" && Number.isSafeInteger(v) ? v : null;

function reduceMetadata(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!v || typeof v !== "object") return out;
  for (const [k, val] of Object.entries(v).slice(0, 20)) {
    if (typeof val === "string") out[k.slice(0, 40)] = val.slice(0, 500);
  }
  return out;
}

// Returns null when the body is not an event we can store (no id or type).
export function reduceEvent(event: unknown): ReducedEvent | null {
  if (!event || typeof event !== "object") return null;
  const e = event as Record<string, unknown>;
  const id = str(e.id, 255);
  const type = str(e.type, 255);
  if (!id || !type) return null;
  const reduced: ReducedEvent = { id, type, created: int(e.created) ?? 0 };
  if (type.startsWith("checkout.session.")) {
    const o = (e.data as { object?: Record<string, unknown> } | undefined)
      ?.object;
    const sid = str(o?.id, 255);
    if (o && sid) {
      const cd = (o.customer_details ?? {}) as Record<string, unknown>;
      reduced.session = {
        id: sid,
        payment_intent: str(o.payment_intent, 255),
        payment_status: str(o.payment_status, 40),
        amount_total: int(o.amount_total),
        currency: str(o.currency, 10),
        client_reference_id: str(o.client_reference_id, 255),
        expires_at: int(o.expires_at),
        payment_method_types: Array.isArray(o.payment_method_types)
          ? o.payment_method_types
              .filter((x): x is string => typeof x === "string")
              .slice(0, 10)
          : [],
        metadata: reduceMetadata(o.metadata),
        customer_details: { email: str(cd.email), name: str(cd.name) },
      };
    }
  }
  return reduced;
}
