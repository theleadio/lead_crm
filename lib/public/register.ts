import { writeAudit } from "../audit.ts";
import {
  appBase,
  checkoutConfigured,
  type CheckoutPort,
} from "../payments/checkout.ts";
import { db, withTransaction } from "../sql.ts";
import type { RegisterInput } from "../validation/public.ts";
import { captureLead, type LeadContext } from "./leads.ts";

// Spec §8.3 steps 2-4 (step 1 is §8.2's, run by the shared intake flow).
//
// What this file does and does not do: it reserves the seat and asks for the
// payment page. Nothing here confirms a payment, writes a `payment` row or
// touches the deal's stage — the Stripe webhook owns the first two (§11.2),
// and whether a sent link moves the deal to `checkout_sent` is O44, still
// unanswered, so the stage is left alone.

export type RegisterResult =
  | { kind: "checkout"; personId: string; dealId: string; checkoutUrl: string }
  | { kind: "hrdc"; personId: string; dealId: string }
  | { kind: "class_unavailable" }
  | { kind: "no_seats" }
  | { kind: "already_enrolled" }
  | { kind: "not_configured" }
  | { kind: "provider_failed" };

// Seat statuses that mean this person is already in this class. `reserved` is
// absent on purpose: an unpaid reservation of theirs is reused below.
const PAST_RESERVED = [
  "payment_pending",
  "confirmed",
  "onboarded",
  "attended",
  "completed",
  "no_show",
  "waitlisted",
];

const SEAT_GUARD_EXEMPT = ["cancelled", "completed"];

export type RegisterDeps = {
  env: Record<string, string | undefined>;
  checkout: CheckoutPort;
};

// Where Stripe sends the visitor back. Server configuration only: a Host,
// Origin or forwarded header could be spoofed, and a payer would land on
// someone else's site. The locale picks the path, which is the only thing the
// body's `locale` is for.
export function returnUrls(
  env: RegisterDeps["env"],
  locale: "en" | "zh",
  classCode: string,
): { successUrl: string; cancelUrl: string } | null {
  const base = appBase(env);
  if (!base) return null;
  const prefix = locale === "zh" ? "/zh" : "";
  return {
    // Stripe fills {CHECKOUT_SESSION_ID} itself; the thank-you page only
    // reads it to tell a visitor who arrived without one that nothing is
    // confirmed yet (§10.4).
    successUrl: `${base}${prefix}/register/thank-you?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${base}${prefix}/register/${encodeURIComponent(classCode)}`,
  };
}

export async function register(
  input: RegisterInput,
  ctx: LeadContext,
  deps: RegisterDeps,
): Promise<RegisterResult> {
  // Step 1: §8.2, whole. A refused class below still leaves the lead, its
  // attribution, its consent and its deal behind — a visitor who clicked a
  // stale link is still worth having.
  const lead = await captureLead(input, ctx);

  const sql = db();
  // Step 2: the class. Seats are not judged here (§8.3): a stored `full` can
  // lag an expired reservation by up to 15 minutes, so step 4 decides.
  // "Today" is the Malaysian date, as the §8.1 feed's cut-off is.
  const [cls] = await sql`
    SELECT c.id, c.code, c.status, c.capacity, c.start_date,
           coalesce(c.price_myr, co.list_price_myr) AS price_myr,
           co.name_en, co.name_zh, c.language
    FROM class c JOIN course co ON co.id = c.course_id
    WHERE lower(c.code) = lower(${input.classCode})
      AND c.is_public
      AND c.status IN ('open', 'few_seats', 'full')
      AND c.start_date > (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date`;
  if (!cls) return { kind: "class_unavailable" };

  // Step 3: HRDC is invoiced, not card-paid (§10.4, §12.6). No reservation,
  // no payment page, and the provider is never called — so this path works
  // even with no Stripe key configured.
  if (input.hrdcIntended)
    return { kind: "hrdc", personId: lead.personId, dealId: lead.dealId };

  if (!checkoutConfigured(deps.env)) return { kind: "not_configured" };
  const urls = returnUrls(deps.env, input.locale, cls.code as string);
  if (!urls) return { kind: "not_configured" };

  // Step 4: the seat. One transaction under the class row lock, as every
  // other seat claim is (§7 Transactions); the database's trigger is the
  // authority and raises `no_seats` on an oversell (§12.1).
  const held = await holdSeat(lead, cls);
  if (held.kind !== "ok") return held;

  const session = await deps.checkout({
    dealId: lead.dealId,
    enrolmentId: held.enrolmentId,
    classId: cls.id as string,
    amountMyr: String(cls.price_myr),
    productName: `${courseName(cls)} (${cls.code})`,
    expiresAt: held.expiresAt,
    ...urls,
  });
  if (session.kind === "not_configured") return { kind: "not_configured" };
  if (session.kind === "failed") {
    // The reservation stands and expires on its own (§12.1); a retry reuses
    // the same per-enrolment idempotency key and gets the same session.
    console.error("checkout session failed", session.detail);
    return { kind: "provider_failed" };
  }

  // Outside the seat transaction on purpose: an external call inside it would
  // hold the class row's lock for as long as Stripe takes. If this write
  // fails the session is orphaned, and both it and the hold expire together.
  await sql`
    UPDATE deal
    SET checkout_url = ${session.url}, checkout_session_id = ${session.id},
        checkout_sent_at = now()
    WHERE id = ${lead.dealId}`;

  return {
    kind: "checkout",
    personId: lead.personId,
    dealId: lead.dealId,
    checkoutUrl: session.url,
  };
}

type ClassRow = Record<string, unknown>;

// §8.1's rule, reused: a Chinese class carries its Chinese name when the
// course has one. The product name is what a payer sees on Stripe's page.
function courseName(cls: ClassRow): string {
  const zh = cls.name_zh as string | null;
  return cls.language === "zh" && zh ? zh : (cls.name_en as string);
}

type HeldSeat =
  | { kind: "ok"; enrolmentId: string; expiresAt: Date }
  | { kind: "no_seats" }
  | { kind: "already_enrolled" };

async function holdSeat(
  lead: { personId: string; dealId: string },
  cls: ClassRow,
): Promise<HeldSeat> {
  const classId = cls.id as string;
  const price = cls.price_myr as string;
  try {
    return await withTransaction(async (): Promise<HeldSeat> => {
      const sql = db();
      await sql`SELECT id FROM class WHERE id = ${classId} FOR UPDATE`;

      // A reservation of their own is reused rather than doubled: §5 refuses
      // a second live row anyway, and a visitor who came back to pay should
      // get their seat, not a constraint name. Anything further along means
      // they are already registered.
      const [mine] = await sql`
        SELECT id, status, seat_reserved_until FROM enrolment
        WHERE person_id = ${lead.personId} AND class_id = ${classId}
          AND status NOT IN ('cancelled', 'refunded', 'transferred')`;
      if (mine && PAST_RESERVED.includes(mine.status as string))
        return { kind: "already_enrolled" };
      if (mine) {
        const hold = new Date(mine.seat_reserved_until as string);
        if (hold > new Date())
          return {
            kind: "ok",
            enrolmentId: mine.id as string,
            expiresAt: hold,
          };
        // The hold has run out but `expire_reservations()` has not swept yet
        // (up to 15 minutes, §12.1). The row holds no seat while it waits, so
        // the seat guard still applies to this update and an oversell is
        // still refused.
        //
        // shortcut: the per-enrolment idempotency key is unchanged, so Stripe
        // may refuse the new session as a key replayed with different
        // parameters; the visitor's retry after the sweep then books cleanly.
        // Upgrade when a reservation is allowed to outlive its payment page.
        const [refreshed] = await sql`
          UPDATE enrolment
          SET seat_reserved_until = now() + make_interval(hours => coalesce((
                SELECT (value #>> '{}')::int FROM app_setting
                WHERE key = 'stripe_reservation_hours'), 24))
          WHERE id = ${mine.id}
          RETURNING id, seat_reserved_until`;
        return {
          kind: "ok",
          enrolmentId: refreshed.id as string,
          expiresAt: new Date(refreshed.seat_reserved_until as string),
        };
      }

      // The service's own check, for the friendly answer; the trigger is the
      // authority and would refuse an oversell anyway (§12.1).
      if (
        !SEAT_GUARD_EXEMPT.includes(cls.status as string) &&
        (await seatsTaken(classId)) >= (cls.capacity as number)
      )
        return { kind: "no_seats" };

      // The hold is the setting's, read on the server: 24 hours
      // (`stripe_reservation_hours`, migration 006). Stripe is given the same
      // moment, so the seat and the payment page die together.
      const [created] = await sql`
        INSERT INTO enrolment (person_id, class_id, deal_id, status,
                               payer_type, price_paid_myr, seat_reserved_until)
        VALUES (${lead.personId}, ${classId}, ${lead.dealId}, 'reserved',
                'self', ${price},
                now() + make_interval(hours => coalesce((
                  SELECT (value #>> '{}')::int FROM app_setting
                  WHERE key = 'stripe_reservation_hours'), 24)))
        RETURNING id, seat_reserved_until`;

      await sql`
        INSERT INTO event_outbox (type, aggregate_type, aggregate_id, payload)
        VALUES ('EnrolmentCreated', 'enrolment', ${created.id},
                ${sql.json({
                  enrolmentId: created.id as string,
                  personId: lead.personId,
                  classId,
                  status: "reserved",
                })})`;

      // No IP and no personal data, as every public write (§8.2, PDPA).
      await writeAudit({
        userId: null,
        action: "create",
        entity: "enrolment",
        entityId: created.id as string,
        before: null,
        after: { source: "public_register", status: "reserved" },
      });

      return {
        kind: "ok",
        enrolmentId: created.id as string,
        expiresAt: new Date(created.seat_reserved_until as string),
      };
    });
  } catch (err) {
    if (isNoSeats(err)) return { kind: "no_seats" };
    throw err;
  }
}

// Migration 006 raises `no_seats` (SQLSTATE P0001) on any write that oversells.
const isNoSeats = (e: unknown) =>
  Boolean((e as { message?: string }).message?.includes("no_seats"));

// The database's own count (migration 006), read under the class row lock, as
// the three services do it — the friendly message is judged by the number
// that refuses an oversell.
async function seatsTaken(classId: string): Promise<number> {
  const [row] = await db()`SELECT class_seats_taken(${classId}) AS taken`;
  return row.taken as number;
}

// A repeat `idempotencyKey` (§8.2 step 8) answers with the first call's
// outcome. Nothing new is stored for this: the touchpoint finds the person and
// the deal, the person's `reserved` row for the class is the reservation, and
// the deal holds the payment page. A link whose hold has passed is treated as
// gone, so the caller issues a new session for the same reservation.
export async function findRegisterReplay(
  key: string,
  classCode: string,
): Promise<
  | { kind: "checkout"; personId: string; dealId: string; checkoutUrl: string }
  | { kind: "hrdc"; personId: string; dealId: string }
  | null
> {
  const sql = db();
  const [row] = await sql`
    SELECT t.person_id, d.id AS deal_id, d.checkout_url, d.funding_type,
           e.id AS enrolment_id, e.seat_reserved_until
    FROM touchpoint t
    JOIN deal d ON d.source_touchpoint_id = t.id
    LEFT JOIN class c ON lower(c.code) = lower(${classCode})
    LEFT JOIN enrolment e ON e.person_id = t.person_id AND e.class_id = c.id
                         AND e.status = 'reserved'
    WHERE t.channel = 'web_form' AND t.external_ref = ${key}`;
  if (!row) return null;
  const personId = row.person_id as string;
  const dealId = row.deal_id as string;
  // An HRDC registration reserves nothing, so there is nothing else to find.
  if (!row.enrolment_id)
    return row.funding_type === "hrdc"
      ? { kind: "hrdc", personId, dealId }
      : null;
  const live =
    row.checkout_url &&
    row.seat_reserved_until &&
    new Date(row.seat_reserved_until as string) > new Date();
  return live
    ? {
        kind: "checkout",
        personId,
        dealId,
        checkoutUrl: row.checkout_url as string,
      }
    : null;
}
