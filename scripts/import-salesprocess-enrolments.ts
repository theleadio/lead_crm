// Paid SalesProcess orders → confirmed CRM enrolments, creating the class when
// none matches. See docs/superpowers/specs/2026-11-03-salesprocess-enrolment-import-design.md.
//
//   npm run ghl:enrolments                 dry run: counts, rolled back
//   npm run ghl:enrolments -- --apply      write
//
// Only touches rows it made: enrolment id = enrolmentIdFor(order), class
// notes start "Imported from SalesProcess.". The log is public: counts,
// product names and class codes only, never a buyer or an order id.
import postgres from "postgres";
import { fetchOrder } from "../lib/import/salesprocess-api.ts";
import { parseClassSlot, type ClassSlot } from "../lib/import/class-slot.ts";
import {
  IMPORT_CLASS_NOTE,
  ONLINE_COURSES,
  PRODUCT_COURSE,
  SYNC_LOCK_KEY,
  classCodeFor,
  classIdFor,
  enrolmentIdFor,
  isNoSeats,
  orderState,
  pickClass,
  type ClassCandidate,
  type Txn,
} from "../lib/import/salesprocess-enrolments.ts";

type Order = {
  items?: {
    name?: string;
    price?: { name?: string };
    product?: { name?: string; description?: string };
  }[];
};

const apply = process.argv.includes("--apply");
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set (run with --env-file=.env.local).");
  process.exit(1);
}

const started = Date.now();
let fetched = 0;
const stats: Record<string, number | string> = {};
const bump = (k: string, n = 1) => (stats[k] = ((stats[k] as number) ?? 0) + n);
// List name → label → count. Labels are product names or class codes only.
const lists: Record<string, Map<string, number>> = {};
const note = (list: string, label: string) => {
  const m = (lists[list] ??= new Map());
  m.set(label, (m.get(label) ?? 0) + 1);
};

const sql = postgres(process.env.DATABASE_URL, {
  ssl: process.env.DATABASE_URL.includes("sslmode=disable") ? false : "require",
  max: 1,
  onnotice: () => {},
});

type Cls = { id: string; code: string; language: "en" | "zh" };

type Plan = {
  orderId: string;
  state: "paid" | "refunded";
  priceMyr: number;
  courseCode: string;
  label: string;
  contact: string;
  paidAt: Date;
  slot: ClassSlot;
};
let writeMs = 0;

try {
  // Pass 1: reads and API fetches only, no transaction. The seat trigger locks
  // the class row until commit, so nothing may be written while we wait on HTTP.
  const [{ today }] = await sql`
    SELECT (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date::text AS today`;
  const orders = new Map<
    string,
    { txns: Txn[]; product: string | null; contact: string }
  >();
  for (const r of await sql`
    SELECT order_id, ghl_contact_id, status, amount_myr, refunded_myr, product, paid_at
    FROM salesprocess_payment
    WHERE live_mode AND order_id IS NOT NULL
      AND paid_at > now() - interval '120 days'`) {
    const o = orders.get(r.order_id) ?? {
      txns: [] as Txn[],
      product: null as string | null,
      contact: r.ghl_contact_id as string,
    };
    o.product ??= r.product;
    o.txns.push({
      status: r.status,
      paid_at: r.paid_at,
      amount_myr: Number(r.amount_myr),
      refunded_myr: Number(r.refunded_myr),
    });
    orders.set(r.order_id, o);
  }
  bump("orders (live, 120 days)", orders.size);

  const seen = new Map<string, string>(
    (
      await sql`SELECT id, status FROM enrolment WHERE id = ANY(${[...orders.keys()].map(enrolmentIdFor)})`
    ).map((r) => [r.id as string, r.status as string]),
  );
  const refunds: string[] = []; // enrolment ids to refund, no fetch needed
  const plans: Plan[] = [];

  for (const [orderId, o] of orders) {
    const { state, priceMyr } = orderState(o.txns);
    if (state === "ignore") {
      bump("skip: not paid or refunded");
      continue;
    }
    const courseCode = o.product ? PRODUCT_COURSE[o.product] : undefined;
    if (!courseCode) {
      bump("skip: unknown product");
      note("unknown product", o.product ?? "(none)");
      continue;
    }
    const label = o.product!;
    const mine = seen.get(enrolmentIdFor(orderId));
    if (state === "paid" ? mine : mine && mine !== "confirmed") {
      bump("skip: already settled");
      continue;
    }
    if (state === "refunded" && mine === "confirmed") {
      refunds.push(enrolmentIdFor(orderId));
      continue;
    }

    let order: Order;
    try {
      order = await fetchOrder<Order>(orderId);
      fetched++;
    } catch {
      bump("skip: order fetch failed"); // message may carry order data
      note("order fetch failed", label);
      continue;
    }
    const paidAt = new Date(
      Math.min(...o.txns.map((t) => t.paid_at.getTime())),
    );
    // The first item that names a date.
    const slot =
      (order.items ?? [])
        .map((item) =>
          parseClassSlot(
            [item.price?.name, item.name, item.product?.description],
            paidAt,
          ),
        )
        .find(Boolean) ?? null;
    if (!slot) {
      bump("skip: no date");
      note("no date", label);
      continue;
    }
    // shortcut: orders for ended classes are re-fetched every run (~300 calls, ~140s/day); cache settled order ids if the window or volume grows.
    if (slot.end < today) {
      bump("skip: class ended");
      continue;
    }
    plans.push({ orderId, state, priceMyr, courseCode, label, contact: o.contact, paidAt, slot });
  }
  stats["orders fetched from API"] = fetched;

  // Pass 2: one short transaction. Re-reads classes and enrolments, so a class
  // or seat made since pass 1 (LMS sync, checkout) is seen.
  const wStart = Date.now();
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${SYNC_LOCK_KEY})`;

    const courseIds = new Map<string, string>(
      (
        await tx`SELECT id, code FROM course WHERE code = ANY(${[...new Set(Object.values(PRODUCT_COURSE))]})`
      ).map((r) => [r.code as string, r.id as string]),
    );
    const courseCodeById = new Map([...courseIds].map(([c, id]) => [id, c]));
    const classesByKey = new Map<string, Cls[]>(); // course code|start
    const classIds: string[] = [];
    for (const r of await tx`
      SELECT id, code, course_id, start_date::text AS start, language FROM class
      WHERE course_id = ANY(${[...courseIds.values()]}) AND status <> 'cancelled'`) {
      const k = `${courseCodeById.get(r.course_id)}|${r.start}`;
      classesByKey.set(k, [
        ...(classesByKey.get(k) ?? []),
        { id: r.id, code: r.code, language: r.language },
      ]);
      classIds.push(r.id);
    }
    const enrolById = new Set<string>();
    const active = new Map<string, string>(); // person|class → enrolment id
    // person|class with a row the import did not make, in any status: staff
    // cancelled, transferred or refunded that buyer, so the import stays out.
    const handled = new Set<string>();
    const importIds = new Set(
      (
        await tx`SELECT DISTINCT order_id FROM salesprocess_payment WHERE order_id IS NOT NULL`
      ).map((r) => enrolmentIdFor(r.order_id)),
    );
    for (const r of await tx`
      SELECT id, person_id, class_id, status FROM enrolment
      WHERE class_id = ANY(${classIds})
         OR id = ANY(${plans.map((p) => enrolmentIdFor(p.orderId))})`) {
      enrolById.add(r.id);
      if (!["cancelled", "refunded", "transferred"].includes(r.status))
        active.set(`${r.person_id}|${r.class_id}`, r.id);
      if (!importIds.has(r.id)) handled.add(`${r.person_id}|${r.class_id}`);
    }
    const person = new Map<string, string>(
      (
        await tx`
          SELECT external_ref, person_id FROM touchpoint
          WHERE external_ref = ANY(${plans.map((p) => `ghl:${p.contact}`)})`
      ).map((r) => [r.external_ref as string, r.person_id as string]),
    );

    for (const id of refunds) {
      const res = await tx`
        UPDATE enrolment SET status = 'refunded' WHERE id = ${id} AND status = 'confirmed'`;
      bump(res.count ? "refunded" : "refund: nothing to change");
    }

    for (const { orderId, state, priceMyr, courseCode, label, contact, paidAt, slot } of plans) {
      const enrolId = enrolmentIdFor(orderId);
      if (enrolById.has(enrolId)) {
        bump("skip: already settled");
        continue;
      }
      const key = `${courseCode}|${slot.start}`;
      const found = pickClass(classesByKey.get(key) ?? [], slot.language);
      if (found === "ambiguous") {
        bump("skip: ambiguous class");
        note("ambiguous class", `${label} ${slot.start}`);
        continue;
      }
      const online = ONLINE_COURSES.has(courseCode);
      const lang = slot.language ?? "en";
      let classId = found;
      let classCode =
        classesByKey.get(key)?.find((c) => c.id === found)?.code ?? "";
      // A refund never creates a class.
      if (!classId && state === "paid") {
        classId = classIdFor(courseCode, slot.start, lang);
        classCode = classCodeFor(courseCode, slot.start, lang);
        const made = await tx`
          INSERT INTO class ${tx({
            id: classId,
            course_id: courseIds.get(courseCode)!,
            code: classCode,
            start_date: slot.start,
            end_date: slot.end,
            language: lang,
            mode: online ? "online" : "in_person",
            venue_name: online ? null : "AI365 Hub",
            venue_address: online ? null : "TBC",
            city: online ? null : (slot.city ?? "TBC"),
            online_url: online ? "https://thelead.io" : null,
            capacity: 30, // max 30 seats per class, decided 4 Nov
            status: "open",
            notes: online
              ? IMPORT_CLASS_NOTE
              : `${IMPORT_CLASS_NOTE} Venue address and city still TBC.`,
          })}
          ON CONFLICT (id) DO NOTHING RETURNING id`;
        // The id exists but not under this key: the LMS adopted and moved it, or staff cancelled it.
        if (!made.length) {
          bump("skip: class unavailable");
          continue;
        }
        classesByKey.set(key, [{ id: classId, code: classCode, language: lang }]);
        bump("insert class");
        note("new class", classCode);
      }
      if (!classId) {
        bump("skip: refund, no class");
        continue;
      }

      const p = person.get(`ghl:${contact}`);
      if (!p) {
        bump("skip: buyer not in CRM");
        continue;
      }
      const holder = active.get(`${p}|${classId}`);

      if (state === "paid") {
        if (holder) {
          bump("already enrolled");
          continue;
        }
        if (handled.has(`${p}|${classId}`)) {
          bump("skip: handled in CRM");
          note("handled in CRM", classCode);
          continue;
        }
        try {
          await tx.savepoint(
            (s) => s`
              INSERT INTO enrolment ${s({
                id: enrolId,
                person_id: p,
                class_id: classId,
                status: "confirmed",
                payer_type: "self",
                price_paid_myr: priceMyr,
                created_at: paidAt,
              })}`,
          );
        } catch (e) {
          if (isNoSeats(e)) {
            bump("skip: class full");
            note("class full", classCode);
            continue;
          }
          throw e;
        }
        active.set(`${p}|${classId}`, enrolId);
        bump(`insert enrolment: ${classCode}`);
      } else if (holder) {
        // No import enrolment exists (else it was refunded above): another row holds the seat.
        bump("refund held by another row");
        note("refund held by another row", `${label} ${classCode}`);
      } else bump("refund: nothing to change");
    }

    writeMs = Date.now() - wStart;
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
for (const [name, m] of Object.entries(lists)) {
  console.log(name);
  console.table(Object.fromEntries(m));
}
console.log(
  `orders fetched: ${fetched}, wall time: ${((Date.now() - started) / 1000).toFixed(1)}s, write phase: ${(writeMs / 1000).toFixed(2)}s`,
);
