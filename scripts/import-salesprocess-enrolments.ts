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
import { parseClassSlot } from "../lib/import/class-slot.ts";
import {
  IMPORT_CLASS_NOTE,
  ONLINE_COURSES,
  PRODUCT_COURSE,
  SYNC_LOCK_KEY,
  classCodeFor,
  classIdFor,
  enrolmentIdFor,
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

try {
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${SYNC_LOCK_KEY})`;

    const [{ today }] = await tx`
      SELECT (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date::text AS today`;

    // Orders: one per order_id, from its live transactions in the window.
    const orders = new Map<
      string,
      { txns: Txn[]; product: string | null; contact: string }
    >();
    for (const r of await tx`
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

    // Bulk reads: the CRM is remote, so one query per table, not per order.
    const courseIds = new Map<string, string>(
      (
        await tx`SELECT id, code FROM course WHERE code = ANY(${[...new Set(Object.values(PRODUCT_COURSE))]})`
      ).map((r) => [r.code as string, r.id as string]),
    );
    const classesByKey = new Map<string, Cls[]>(); // course code|start
    const courseCodeById = new Map([...courseIds].map(([c, id]) => [id, c]));
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
    const enrolIds = [...orders.keys()].map(enrolmentIdFor);
    const enrolById = new Map<string, { status: string }>();
    const active = new Map<string, string>(); // person|class → enrolment id
    for (const r of await tx`
      SELECT id, person_id, class_id, status FROM enrolment
      WHERE class_id = ANY(${classIds}) OR id = ANY(${enrolIds})`) {
      enrolById.set(r.id, { status: r.status });
      if (!["cancelled", "refunded", "transferred"].includes(r.status))
        active.set(`${r.person_id}|${r.class_id}`, r.id);
    }
    const person = new Map<string, string>(
      (
        await tx`
          SELECT external_ref, person_id FROM touchpoint
          WHERE external_ref = ANY(${[...orders.values()].map((o) => `ghl:${o.contact}`)})`
      ).map((r) => [r.external_ref as string, r.person_id as string]),
    );

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
      const enrolId = enrolmentIdFor(orderId);
      const mine = enrolById.get(enrolId);
      if (state === "paid" ? mine : mine && mine.status !== "confirmed") {
        bump("skip: already settled");
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
      const item = order.items?.[0];
      const paidAt = new Date(
        Math.min(...o.txns.map((t) => t.paid_at.getTime())),
      );
      const slot = parseClassSlot(
        [item?.price?.name, item?.name, item?.product?.description],
        paidAt,
      );
      if (!slot) {
        bump("skip: no date");
        note("no date", label);
        continue;
      }
      if (slot.end < today) {
        bump("skip: class ended");
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
      // A paid order never creates a class from a refund.
      if (!classId && state === "paid") {
        classId = classIdFor(courseCode, slot.start, lang);
        classCode = classCodeFor(courseCode, slot.start, lang);
        await tx`
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
            capacity: 40,
            status: "open",
            notes: online
              ? IMPORT_CLASS_NOTE
              : `${IMPORT_CLASS_NOTE} Venue address and city still TBC.`,
          })}
          ON CONFLICT (id) DO NOTHING`;
        classesByKey.set(key, [{ id: classId, code: classCode, language: lang }]);
        bump("insert class");
        note("new class", classCode);
      }
      if (!classId) {
        bump("skip: refund, no class");
        continue;
      }

      const p = person.get(`ghl:${o.contact}`);
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
          const err = e as { code?: string; message?: string };
          if (err.code === "P0001" && err.message?.includes("no_seats")) {
            bump("skip: class full");
            note("class full", classCode);
            continue;
          }
          throw e;
        }
        active.set(`${p}|${classId}`, enrolId);
        enrolById.set(enrolId, { status: "confirmed" });
        bump(`insert enrolment: ${classCode}`);
      } else {
        const res = await tx`
          UPDATE enrolment SET status = 'refunded'
          WHERE id = ${enrolId} AND status = 'confirmed'`;
        if (res.count) {
          bump("refunded");
          active.delete(`${p}|${classId}`);
        } else if (holder && holder !== enrolId) {
          bump("refund held by another row");
          note("refund held by another row", `${label} ${classCode}`);
        } else bump("refund: nothing to change");
      }
    }

    stats["orders fetched from API"] = fetched;
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
  `orders fetched: ${fetched}, wall time: ${((Date.now() - started) / 1000).toFixed(1)}s`,
);
