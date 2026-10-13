// Spec §9.10 Roster, §12.1 seats, §6 enrolment row: who one class's roster
// lists, which rows hold a seat, and which roles may read it at all.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { listRoster } from "../lib/classes/roster.ts";
import { getClass } from "../lib/classes/service.ts";
import {
  PermissionError,
  ROLES,
  type Role,
  type Viewer,
} from "../lib/auth/permissions.ts";
import { closeDb, db, rollbackAfter } from "../lib/sql.ts";

after(closeDb);

const it = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !process.env.DATABASE_URL && "no DATABASE_URL" }, () =>
    rollbackAfter(fn),
  );

async function newUser(role: Role = "operations"): Promise<Viewer> {
  const [u] = await db()`
    INSERT INTO app_user (email, full_name, role_code)
    VALUES (${`${crypto.randomUUID()}@lead.test`}, 'Test user', ${role})
    RETURNING id`;
  return { id: u.id, role };
}

async function newCourse(): Promise<string> {
  const [c] = await db()`
    INSERT INTO course (code, name_en, track, duration_days)
    VALUES (${`T-${crypto.randomUUID()}`}, 'Test course', 'workshop', 1)
    RETURNING id`;
  return c.id;
}

async function newClass(capacity = 10): Promise<string> {
  const [c] = await db()`
    INSERT INTO class (course_id, code, start_date, end_date, language, mode,
                       venue_name, venue_address, city, capacity, status,
                       is_public)
    VALUES (${await newCourse()}, ${`C-${crypto.randomUUID()}`},
            (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date + 7,
            (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date + 7,
            'en', 'in_person', 'LEAD Training Centre', '1 Jalan Test',
            'Kuala Lumpur', ${capacity}, 'open', true)
    RETURNING id`;
  return c.id;
}

async function newPerson(fullName: string, phone: string | null = null) {
  const [p] = await db()`
    INSERT INTO person (full_name, phone) VALUES (${fullName}, ${phone})
    RETURNING id`;
  return p.id as string;
}

// `reservedOffset` is a Postgres interval: a live reservation holds a seat,
// an expired one does not (§12.1).
async function enrol(
  classId: string,
  status: string,
  opts: {
    name?: string;
    phone?: string | null;
    reservedOffset?: string;
    bookerName?: string;
    pricePaid?: string;
    payerType?: string;
  } = {},
): Promise<string> {
  const personId = await newPerson(
    opts.name ?? `Person ${crypto.randomUUID().slice(0, 8)}`,
    opts.phone ?? null,
  );
  const bookerId = opts.bookerName ? await newPerson(opts.bookerName) : null;
  const [e] = await db()`
    INSERT INTO enrolment (person_id, class_id, status, seat_reserved_until,
                           booker_person_id, price_paid_myr, payer_type,
                           completed_at)
    VALUES (${personId}, ${classId}, ${status},
            now() + ${opts.reservedOffset ?? null}::interval,
            ${bookerId}, ${opts.pricePaid ?? null},
            ${opts.payerType ?? "self"},
            ${status === "completed" ? new Date() : null})
    RETURNING id`;
  return e.id as string;
}

it("lists every enrolment, marking which rows hold a seat", async () => {
  const viewer = await newUser();
  const classId = await newClass();
  await enrol(classId, "confirmed", { name: "Confirmed person" });
  await enrol(classId, "cancelled", { name: "Cancelled person" });
  await enrol(classId, "waitlisted", { name: "Waitlisted person" });

  const rows = await listRoster(classId, viewer);
  assert.equal(rows.length, 3);
  const seat = Object.fromEntries(rows.map((r) => [r.personName, r.holdsSeat]));
  assert.deepEqual(seat, {
    "Confirmed person": true,
    "Cancelled person": false,
    "Waitlisted person": false,
  });
  // Seat-holders first (§9.10).
  assert.equal(rows[0].personName, "Confirmed person");
});

it("carries the §9.10 columns and no contact details", async () => {
  const viewer = await newUser();
  const classId = await newClass();
  await enrol(classId, "confirmed", {
    name: "Tan Mei Ling",
    bookerName: "HR Officer",
    pricePaid: "1800.00",
    payerType: "company",
  });

  const [row] = await listRoster(classId, viewer);
  assert.equal(row.personName, "Tan Mei Ling");
  assert.equal(row.bookerName, "HR Officer");
  assert.equal(row.pricePaidMyr, "1800.00");
  assert.equal(row.payerType, "company");
  assert.equal(row.status, "confirmed");
  assert.ok(row.personId);
  assert.ok(row.createdAt);
  assert.ok(!("phone" in row), "the roster must not carry a phone");
  assert.ok(!("email" in row), "the roster must not carry an email");
});

it("an expired reservation holds no seat, matching the §12.1 counts", async () => {
  const viewer = await newUser();
  const classId = await newClass();
  await enrol(classId, "reserved", {
    name: "Live hold",
    reservedOffset: "2 days",
  });
  await enrol(classId, "reserved", {
    name: "Expired hold",
    reservedOffset: "-1 hour",
  });

  const rows = await listRoster(classId, viewer);
  const seat = Object.fromEntries(rows.map((r) => [r.personName, r.holdsSeat]));
  assert.equal(seat["Live hold"], true);
  assert.equal(seat["Expired hold"], false);
  assert.ok(rows.find((r) => r.personName === "Live hold")?.seatReservedUntil);

  // The same class read through getClass agrees: one live reservation.
  const cls = await getClass(classId, viewer);
  assert.equal(cls?.reservedCount, 1);
  assert.equal(cls?.confirmedCount, 0);
  assert.equal(cls?.seatsAvailable, 9);
});

it("only the roles with §6 enrolment read may see a roster", async () => {
  const classId = await newClass();
  await enrol(classId, "confirmed");

  const allowed: Role[] = [
    "super_admin",
    "management",
    "sales",
    "support",
    "operations",
  ];
  for (const role of ROLES) {
    const viewer = await newUser(role);
    if (allowed.includes(role)) {
      const rows = await listRoster(classId, viewer);
      assert.equal(rows.length, 1, `${role} should read the roster`);
    } else {
      await assert.rejects(
        () => listRoster(classId, viewer),
        PermissionError,
        `${role} must not read the roster`,
      );
    }
  }
});

it("an unknown or malformed class id is an empty roster, not an error", async () => {
  const viewer = await newUser();
  assert.deepEqual(await listRoster("not-a-uuid", viewer), []);
  assert.deepEqual(
    await listRoster("00000000-0000-0000-0000-000000000000", viewer),
    [],
  );
});
