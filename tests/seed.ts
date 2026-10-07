// Seed rows for the database tests, and the `it` wrapper that rolls each one
// back. Not a test file (the runner only takes `*.test.ts`), so the §9.11
// tests can share one set of helpers instead of four copies of the same
// INSERTs.
import test from "node:test";
import { type Role, type Viewer } from "../lib/auth/permissions.ts";
import { db, rollbackAfter } from "../lib/sql.ts";

// Skipped, not failed, where there is no database to roll back in.
export const it = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !process.env.DATABASE_URL && "no DATABASE_URL" }, () =>
    rollbackAfter(fn),
  );

export async function newUser(role: Role = "operations"): Promise<Viewer> {
  const [u] = await db()`
    INSERT INTO app_user (email, full_name, role_code)
    VALUES (${`${crypto.randomUUID()}@lead.test`}, 'Test user', ${role})
    RETURNING id`;
  return { id: u.id, role };
}

export async function newCourse(): Promise<string> {
  const [c] = await db()`
    INSERT INTO course (code, name_en, track, duration_days)
    VALUES (${`T-${crypto.randomUUID()}`}, 'Test course', 'workshop', 1)
    RETURNING id`;
  return c.id as string;
}

export async function newClass(
  opts: {
    capacity?: number;
    courseId?: string;
    status?: string;
    priceMyr?: string | null;
    startOffsetDays?: number;
  } = {},
): Promise<string> {
  const day = `${opts.startOffsetDays ?? 7}`;
  const [c] = await db()`
    INSERT INTO class (course_id, code, start_date, end_date, language, mode,
                       venue_name, venue_address, city, capacity, price_myr,
                       status, is_public)
    VALUES (${opts.courseId ?? (await newCourse())}, ${`C-${crypto.randomUUID()}`},
            (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date + ${day}::int,
            (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date + ${day}::int,
            'en', 'in_person', 'LEAD Training Centre', '1 Jalan Test',
            'Kuala Lumpur', ${opts.capacity ?? 10}, ${opts.priceMyr ?? null},
            ${opts.status ?? "open"}, true)
    RETURNING id`;
  return c.id as string;
}

export async function newPerson(
  fullName: string | null,
  phone: string | null = null,
): Promise<string> {
  const [p] = await db()`
    INSERT INTO person (full_name, phone) VALUES (${fullName}, ${phone})
    RETURNING id`;
  return p.id as string;
}

// `reservedOffset` is a Postgres interval: a live reservation holds a seat, an
// expired one does not (§12.1).
export async function enrol(
  classId: string,
  status: string,
  opts: {
    personId?: string;
    name?: string | null;
    phone?: string | null;
    reservedOffset?: string;
    bookerName?: string;
    pricePaid?: string;
    payerType?: string;
  } = {},
): Promise<string> {
  const personId =
    opts.personId ??
    (await newPerson(
      opts.name === undefined
        ? `Person ${crypto.randomUUID().slice(0, 8)}`
        : opts.name,
      opts.phone ?? null,
    ));
  const bookerId = opts.bookerName ? await newPerson(opts.bookerName) : null;
  const sql = db();
  // §12.1 / migration 007: only a reservation carries a hold, and the test
  // decides whether it is still live.
  const hold =
    status === "reserved"
      ? sql`now() + ${opts.reservedOffset ?? "48 hours"}::interval`
      : sql`NULL`;
  const [e] = await sql`
    INSERT INTO enrolment (person_id, class_id, status, seat_reserved_until,
                           booker_person_id, price_paid_myr, payer_type,
                           completed_at)
    VALUES (${personId}, ${classId}, ${status}, ${hold},
            ${bookerId}, ${opts.pricePaid ?? null},
            ${opts.payerType ?? "self"},
            ${status === "completed" ? new Date() : null})
    RETURNING id`;
  return e.id as string;
}

// One payment against an enrolment (§5 `payment`), for the §6 payment-row
// checks on the enrolment screen. A manual method needs a reference and a
// proof key (§5 CHECK, §9.12).
export async function pay(
  enrolmentId: string,
  opts: { amount?: string; method?: string; status?: string } = {},
): Promise<string> {
  const [p] = await db()`
    INSERT INTO payment (enrolment_id, method, status, amount_myr, paid_at,
                         match_status, reference_no, proof_file_key)
    VALUES (${enrolmentId}, ${opts.method ?? "bank_transfer"},
            ${opts.status ?? "succeeded"}, ${opts.amount ?? "1800.00"}, now(),
            'matched', 'REF-1', 'proofs/test.pdf')
    RETURNING id`;
  return p.id as string;
}
