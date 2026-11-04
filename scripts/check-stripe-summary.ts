// Read-only summary of the Stripe account, so JM can decide whether old
// Stripe payments are worth importing. Writes nothing, to Stripe or the CRM.
//
//   node --env-file=.env.local scripts/check-stripe-summary.ts
//   (CI: .github/workflows/data-check.yml, started by hand)
//
// Needs STRIPE_SECRET_KEY. Actions logs are public (see daily-sync.yml), so
// this prints counts and totals only: no names, emails, ids or descriptions.
const key = (process.env.STRIPE_SECRET_KEY ?? "").trim();
if (!key) {
  console.error("STRIPE_SECRET_KEY is not set");
  process.exit(1);
}

type Charge = {
  amount: number; // smallest currency unit
  amount_refunded: number;
  currency: string;
  created: number; // unix seconds
  status: string; // succeeded | pending | failed
  livemode: boolean;
  customer: string | null;
};

type Page<T> = { data: T[]; has_more: boolean };

async function list<T extends { id?: string }>(path: string): Promise<T[]> {
  const all: T[] = [];
  let after: string | undefined;
  for (;;) {
    const url = new URL(`https://api.stripe.com/v1/${path}`);
    url.searchParams.set("limit", "100");
    if (after) url.searchParams.set("starting_after", after);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const body = (await res.json()) as Page<T> & {
      error?: { message?: string };
    };
    if (!res.ok)
      throw new Error(
        `Stripe ${path} ${res.status}: ${body.error?.message ?? "no body"}`,
      );
    all.push(...body.data);
    if (!body.has_more || body.data.length === 0) return all;
    after = body.data[body.data.length - 1].id;
  }
}

const mode =
  key.startsWith("sk_live_") || key.startsWith("rk_live_") ? "live" : "test";
console.log(`Key mode: ${mode}`);

const charges = await list<Charge & { id: string }>("charges");
const customers = await list<{ id: string }>("customers");

type Row = {
  count: number;
  succeeded: number;
  failed: number;
  refunds: number;
  gross: Map<string, number>;
  refunded: Map<string, number>;
  payers: Set<string>;
};
const byYear = new Map<number, Row>();
let first = Infinity;
let last = -Infinity;
for (const c of charges) {
  const year = new Date(c.created * 1000).getUTCFullYear();
  const row = byYear.get(year) ?? {
    count: 0,
    succeeded: 0,
    failed: 0,
    refunds: 0,
    gross: new Map(),
    refunded: new Map(),
    payers: new Set<string>(),
  };
  byYear.set(year, row);
  row.count++;
  if (c.status === "succeeded") {
    row.succeeded++;
    row.gross.set(c.currency, (row.gross.get(c.currency) ?? 0) + c.amount);
  }
  if (c.status === "failed") row.failed++;
  if (c.amount_refunded > 0) {
    row.refunds++;
    row.refunded.set(
      c.currency,
      (row.refunded.get(c.currency) ?? 0) + c.amount_refunded,
    );
  }
  if (c.customer) row.payers.add(c.customer);
  first = Math.min(first, c.created);
  last = Math.max(last, c.created);
}

// Zero-decimal currencies are not divided by 100; LEAD is expected to be MYR,
// which has two decimals.
const ZERO_DECIMAL = new Set(["jpy", "krw", "vnd", "idr"]);
const money = (m: Map<string, number>) =>
  [...m]
    .map(
      ([cur, n]) =>
        `${cur.toUpperCase()} ${(ZERO_DECIMAL.has(cur) ? n : n / 100).toFixed(2)}`,
    )
    .join(", ") || "-";
const day = (s: number) => new Date(s * 1000).toISOString().slice(0, 10);

console.log(`Charges: ${charges.length}`);
console.log(`Customers: ${customers.length}`);
if (charges.length) console.log(`Date range: ${day(first)} to ${day(last)}`);
console.table(
  [...byYear]
    .sort(([a], [b]) => a - b)
    .map(([year, r]) => ({
      year,
      charges: r.count,
      succeeded: r.succeeded,
      failed: r.failed,
      "with refund": r.refunds,
      "paying customers": r.payers.size,
      "gross (succeeded)": money(r.gross),
      refunded: money(r.refunded),
    })),
);

export {};
