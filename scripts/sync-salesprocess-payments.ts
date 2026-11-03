// SalesProcess (GoHighLevel) payment transactions → salesprocess_payment
// (migration 016), so the ads report has revenue.
//
//   npm run ghl:payments                 dry run: counts, rolled back
//   npm run ghl:payments -- --apply      write
//
// Reads every transaction and upserts by its id: status and refunds change
// after the sale, so each run brings them up to date. Nothing is deleted, and
// nothing is written to `payment` (see the migration for why). Values are kept
// as SalesProcess sent them; test charges are stored with live_mode false.
import postgres from "postgres";
import { fetchTransactions } from "../lib/import/salesprocess-api.ts";

type Transaction = {
  _id: string;
  contactId?: string | null;
  entityType?: string;
  entityId?: string | null;
  entitySourceName?: string | null;
  status: string;
  amount: number;
  amountRefunded?: number | null;
  currency: string;
  liveMode: boolean;
  createdAt: string;
};

const apply = process.argv.includes("--apply");
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set (run with --env-file=.env.local).");
  process.exit(1);
}

const stats: Record<string, number | string> = {};
const bump = (k: string, n = 1) => (stats[k] = ((stats[k] as number) ?? 0) + n);

const sql = postgres(process.env.DATABASE_URL, {
  ssl: process.env.DATABASE_URL.includes("sslmode=disable") ? false : "require",
  max: 1,
  onnotice: () => {},
});

try {
  const txns = await fetchTransactions<Transaction>();
  const rows = [];
  for (const t of txns) {
    // A transaction with no contact can't be tied to a buyer or a campaign.
    if (!t.contactId) {
      bump("skip: no contact");
      continue;
    }
    const amount = Math.round(Number(t.amount) * 100) / 100;
    const refunded = Math.min(
      Math.round(Number(t.amountRefunded ?? 0) * 100) / 100,
      amount,
    );
    rows.push({
      id: t._id,
      order_id: t.entityType === "order" ? (t.entityId ?? null) : null,
      ghl_contact_id: t.contactId,
      status: t.status,
      amount_myr: amount,
      refunded_myr: refunded,
      currency: t.currency.toUpperCase(),
      product: t.entitySourceName ?? null,
      live_mode: t.liveMode,
      paid_at: new Date(t.createdAt),
    });
    bump(`status: ${t.status}${t.liveMode ? "" : " (test)"}`);
  }

  await sql.begin(async (tx) => {
    const before = new Map(
      (await tx`SELECT id, status, refunded_myr FROM salesprocess_payment`).map(
        (r) => [r.id as string, `${r.status}|${Number(r.refunded_myr)}`],
      ),
    );
    const changed = rows.filter(
      (r) => before.get(r.id) !== `${r.status}|${r.refunded_myr}`,
    );
    for (const r of changed) bump(before.has(r.id) ? "update" : "insert");
    bump("same", rows.length - changed.length);
    for (let i = 0; i < changed.length; i += 500)
      await tx`
        INSERT INTO salesprocess_payment ${tx(changed.slice(i, i + 500))}
        ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status, refunded_myr = EXCLUDED.refunded_myr,
          amount_myr = EXCLUDED.amount_myr, product = EXCLUDED.product,
          synced_at = now()`;

    // How much of it reaches a CRM person (ghl:import's touchpoint).
    const [m] = await tx`
      SELECT count(DISTINCT p.ghl_contact_id)::int AS buyers,
             count(DISTINCT p.ghl_contact_id) FILTER (WHERE t.person_id IS NOT NULL)::int AS in_crm,
             coalesce(sum(p.amount_myr - p.refunded_myr) FILTER (
               WHERE p.live_mode AND p.status IN ('succeeded', 'partially_refunded')), 0)::text AS net_myr
      FROM salesprocess_payment p
      LEFT JOIN touchpoint t ON t.external_ref = 'ghl:' || p.ghl_contact_id`;
    stats["buyers (live + test)"] = m.buyers;
    stats["buyers found in CRM"] = m.in_crm;
    stats["net revenue MYR (live)"] = m.net_myr;
    if (!apply) throw new Error("dry-run");
  });
} catch (e) {
  if (!(e instanceof Error && e.message === "dry-run")) {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  }
} finally {
  await sql.end();
}
console.log(apply ? "APPLIED" : "DRY RUN (rolled back)");
console.table(stats);
