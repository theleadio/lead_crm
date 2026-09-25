// Integration tests against the seeded dev database (npm run db:seed).
// Every test runs in a transaction that is rolled back, so nothing sticks.
// Skipped when DATABASE_URL isn't set.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import type { Viewer } from "../lib/auth/permissions.ts";
import { toCsv } from "../lib/format/csv.ts";
import {
  exportPersonData,
  getPersonConsent,
  getPersonDetail,
  getPersonTimeline,
  personDataToRows,
  updatePerson,
} from "../lib/people/detail-service.ts";
import {
  bulkUpdatePeople,
  createPerson,
  dedupeCandidates,
  normaliseCompanyName,
  exportPeople,
  InvalidBulkChange,
  listPeople,
} from "../lib/people/service.ts";
import { deletePerson, erasePerson } from "../lib/people/delete-service.ts";
import { findDuplicate } from "../lib/people/dedupe.ts";
import { mergePeople } from "../lib/people/merge-service.ts";
import { closeDb, db, rollbackAfter } from "../lib/sql.ts";
import { SEED_USERS } from "../scripts/seed-ids.ts";

after(closeDb);

const it = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !process.env.DATABASE_URL && "no DATABASE_URL" }, () =>
    rollbackAfter(fn),
  );

const admin: Viewer = { id: SEED_USERS.admin, role: "super_admin" };
const sales: Viewer = { id: SEED_USERS.weiPing, role: "sales" };
const marketing: Viewer = { id: SEED_USERS.daphne, role: "marketing" };
const partTimer: Viewer = { id: SEED_USERS.leeYee, role: "part_time" };

const idOf = async (fullName: string) =>
  (await db()`SELECT id FROM person WHERE full_name = ${fullName}`)[0]
    .id as string;
const auditCount = async () =>
  (await db()`SELECT count(*)::int AS n FROM audit_log`)[0].n as number;
const lastAudit = async () =>
  (
    await db()`SELECT action, entity, after FROM audit_log ORDER BY at DESC, created_at DESC LIMIT 1`
  )[0];
const all = (viewer: Viewer, f: object = {}) =>
  listPeople({ page: 1, limit: 100, ...f }, viewer);

// Seed: person i is created i days ago; stage by i % 4 = lead, lead, student,
// customer; no owner when i % 4 === 1.

it("list: paginates with a total (spec §7)", async () => {
  const first = await listPeople({ page: 1, limit: 25 }, admin);
  assert.equal(first.data.length, 25);
  assert.equal(first.page.total, 61);
  const last = await listPeople({ page: 3, limit: 25 }, admin);
  assert.equal(last.data.length, 11);
});

it("search: every phone shape finds the same person (spec §9.1)", async () => {
  // Seed person 0: phone 012-000 0000.
  const id = await idOf("Tan Mei Ling");
  for (const q of ["012-000 0000", "+60120000000", "120000000", "tan mei"]) {
    const { data } = await all(admin, { q });
    assert.ok(
      data.some((p) => p.id === id),
      q,
    );
  }
});

it("filters: stage, owner, tag, open deal, created between", async () => {
  const everyone = (await all(admin)).data;

  const students = (await all(admin, { stage: "student" })).data;
  assert.ok(
    students.length > 0 && students.every((p) => p.stage === "student"),
  );

  const unowned = (await all(admin, { owner: "unassigned" })).data;
  assert.ok(unowned.length > 0 && unowned.every((p) => !p.owner));

  const [vip] = await db()`SELECT id FROM tag WHERE name = 'vip'`;
  const tagged = (await all(admin, { tags: [vip.id] })).data;
  assert.ok(tagged.length > 0 && tagged.every((p) => p.tags.includes("vip")));

  const withDeal = await all(admin, { hasOpenDeal: true });
  const without = await all(admin, { hasOpenDeal: false });
  assert.equal(withDeal.page.total + without.page.total, everyone.length);

  // Created between, in Malaysia dates (UTC+8).
  const kl = (iso: string) =>
    new Date(Date.parse(iso) + 8 * 3600e3).toISOString().slice(0, 10);
  const newest = kl(everyone[0].createdAt);
  const weekAgo = kl(
    new Date(Date.parse(everyone[0].createdAt) - 6 * 864e5).toISOString(),
  );
  const expected = everyone.filter(
    (p) => kl(p.createdAt) >= weekAgo && kl(p.createdAt) <= newest,
  );
  const got = await all(admin, { createdFrom: weekAgo, createdTo: newest });
  assert.equal(got.page.total, expected.length);
});

it("marketing: masked contact details, never the real values (§6 ¹)", async () => {
  for (const p of (await all(marketing)).data) {
    assert.equal(p.phoneE164, null);
    if (p.email) assert.match(p.email, /^.••••@/);
    if (p.phone && p.phone !== "••••") assert.match(p.phone, /-•••• \d{4}$/);
  }
});

it("part_time: only people they own or have an enquiry/task for (§6 v1.2)", async () => {
  const { data } = await all(partTimer);
  assert.ok(data.length > 0 && data.length < 61);
  const ids = data.map((p) => p.id);
  const [{ n }] = await db()`
    SELECT count(*)::int AS n FROM person p
    WHERE p.id IN ${db()(ids)}
      AND NOT (p.owner_user_id = ${partTimer.id}
        OR EXISTS (SELECT 1 FROM enquiry e WHERE e.person_id = p.id AND e.assigned_user_id = ${partTimer.id})
        OR EXISTS (SELECT 1 FROM task k WHERE k.person_id = p.id AND k.assigned_user_id = ${partTimer.id}))`;
  assert.equal(n, 0);
  // Some are visible only through an assigned enquiry, not ownership.
  assert.ok(data.some((p) => p.owner?.id !== partTimer.id));
});

it("create: hard match on phone returns the existing person (§12.2)", async () => {
  const id = await idOf("Tan Mei Ling");
  const r = await createPerson(
    {
      fullName: "Someone Else",
      phone: "012-000 0000",
      preferredLanguage: "en",
    },
    admin,
  );
  assert.equal(r.kind === "duplicate" && r.existing.id, id);
});

it("create: soft match (name + email username) is created and flagged", async () => {
  const r = await createPerson(
    {
      fullName: "TAN MEI-LING",
      email: "tan0@other.com",
      preferredLanguage: "en",
    },
    admin,
  );
  assert.equal(r.kind, "created");
  assert.equal(r.kind === "created" && r.person.needsReview, true);
});

it("create: unnormalisable phone is kept and flagged; audit row written", async () => {
  const before = await auditCount();
  const r = await createPerson(
    { fullName: "Odd Phone", phone: "999", preferredLanguage: "en" },
    admin,
  );
  assert.equal(r.kind, "created");
  if (r.kind !== "created") return;
  assert.equal(r.person.phone, "999");
  assert.equal(r.person.phoneE164, null);
  assert.equal(
    r.person.needsReviewReason,
    "Phone number could not be normalised",
  );
  assert.equal(r.person.stage, "lead");
  assert.equal(await auditCount(), before + 1);
  assert.equal((await lastAudit()).action, "create");
});

it("bulk: assigns owner and adds tag; rejects unknown tag", async () => {
  const ids = (await listPeople({ page: 1, limit: 2 }, admin)).data.map(
    (p) => p.id,
  );
  const [vip] = await db()`SELECT id FROM tag WHERE name = 'vip'`;

  assert.equal(
    (
      await bulkUpdatePeople(
        ids,
        { kind: "assignOwner", ownerId: sales.id },
        admin,
      )
    ).updated,
    2,
  );
  await bulkUpdatePeople(ids, { kind: "addTag", tagId: vip.id }, admin);
  const after = (await listPeople({ page: 1, limit: 2 }, admin)).data;
  assert.ok(
    after.every((p) => p.owner?.id === sales.id && p.tags.includes("vip")),
  );

  await assert.rejects(
    bulkUpdatePeople(
      ids,
      { kind: "addTag", tagId: "00000000-0000-4000-8000-0000000000ff" },
      admin,
    ),
    InvalidBulkChange,
  );
});

it("bulk: part_time can't touch people not assigned to them", async () => {
  const visible = new Set((await all(partTimer)).data.map((p) => p.id));
  const others = (await all(admin)).data
    .map((p) => p.id)
    .filter((id) => !visible.has(id));
  const [vip] = await db()`SELECT id FROM tag WHERE name = 'vip'`;
  const r = await bulkUpdatePeople(
    others,
    { kind: "addTag", tagId: vip.id },
    partTimer,
  );
  assert.equal(r.updated, 0);
});

it("export: every matching row, audit-logged", async () => {
  const rows = await exportPeople({}, admin);
  assert.equal(rows.length, 61);
  assert.equal((await lastAudit()).action, "export");
});

it("detail: not_found vs forbidden", async () => {
  assert.equal(
    (await getPersonDetail("00000000-0000-4000-8000-0000000000ff", admin)).kind,
    "not_found",
  );
  assert.equal((await getPersonDetail("not-a-uuid", admin)).kind, "not_found");
  const visible = new Set((await all(partTimer)).data.map((p) => p.id));
  const hidden = (await all(admin)).data.find((p) => !visible.has(p.id))!;
  assert.equal((await getPersonDetail(hidden.id, partTimer)).kind, "forbidden");
});

it("detail: admin sees every panel; payment views are audit-logged", async () => {
  // Seed person 3 is a customer owned by Wei Ping.
  const id = await idOf("Nur Aisyah binti Ahmad");
  const before = await auditCount();
  const r = await getPersonDetail(id, admin);
  assert.equal(r.kind, "ok");
  if (r.kind !== "ok") return;
  assert.equal(r.detail.person.stage, "customer");
  assert.ok(
    r.detail.deals?.length && r.detail.enrolments?.length && r.detail.enquiries,
  );
  assert.equal(r.detail.payments?.length, 1);
  assert.ok(r.detail.attribution.firstTouch);
  assert.equal(await auditCount(), before + 1);
  assert.equal((await lastAudit()).entity, "payment");
});

it("detail: marketing is masked and gets no enrolments/payments/enquiries", async () => {
  const r = await getPersonDetail(
    await idOf("Nur Aisyah binti Ahmad"),
    marketing,
  );
  assert.equal(r.kind, "ok");
  if (r.kind !== "ok") return;
  assert.match(r.detail.person.email!, /^.••••@/);
  assert.equal(r.detail.enrolments, null);
  assert.equal(r.detail.payments, null);
  assert.equal(r.detail.enquiries, null);
  assert.ok(r.detail.deals);
});

it("detail: sales only sees payments on deals they own (§6 ²)", async () => {
  // Seed person 3 is a customer owned by Wei Ping; person 7 one owned by Daphne.
  const own = await getPersonDetail(
    await idOf("Nur Aisyah binti Ahmad"),
    sales,
  );
  assert.equal(own.kind === "ok" && own.detail.payments?.length, 1);
  const notOwn = await getPersonDetail(await idOf("Rajesh Kumar"), sales);
  assert.equal(notOwn.kind === "ok" && notOwn.detail.payments?.length, 0);
});

it("update: saves changed fields, audits only those, leaves last activity alone", async () => {
  const id = await idOf("Wong Kar Wai");
  const d = await getPersonDetail(id, admin);
  if (d.kind !== "ok") throw new Error("setup");
  const r = await updatePerson(
    id,
    { jobTitle: "HR Manager" },
    d.detail.person.version,
    admin,
  );
  assert.equal(r.kind, "updated");
  if (r.kind !== "updated") return;
  assert.equal(r.person.jobTitle, "HR Manager");
  assert.equal(r.person.lastActivityAt, d.detail.person.lastActivityAt);
  assert.deepEqual((await lastAudit()).after, { job_title: "HR Manager" });
});

it("update: a stale updated_at is rejected (§7 concurrency)", async () => {
  const id = await idOf("Siti Nurhaliza");
  const d = await getPersonDetail(id, admin);
  if (d.kind !== "ok") throw new Error("setup");
  const loaded = d.detail.person.version;
  // Another save in between: force updated_at forward, as a separate request would.
  await db()`UPDATE person SET notes = 'someone else' WHERE id = ${id}`;
  await db()`UPDATE person SET updated_at = updated_at + interval '1 second' WHERE id = ${id}`;
  assert.equal(
    (await updatePerson(id, { jobTitle: "x" }, loaded, admin)).kind,
    "stale",
  );
});

it("update: phone that belongs to someone else is a duplicate", async () => {
  const id = await idOf("Chong Wei Ming");
  const d = await getPersonDetail(id, admin);
  if (d.kind !== "ok") throw new Error("setup");
  const r = await updatePerson(
    id,
    { phone: "012-000 0000" },
    d.detail.person.version,
    admin,
  );
  assert.equal(
    r.kind === "duplicate" && r.existing.id,
    await idOf("Tan Mei Ling"),
  );
});

it("update: bad WhatsApp is a field error; bad phone flags, fixing it clears", async () => {
  const id = await idOf("Muhammad Faiz");
  const load = async () => {
    const d = await getPersonDetail(id, admin);
    if (d.kind !== "ok") throw new Error("setup");
    return d.detail.person;
  };
  const bad = await updatePerson(
    id,
    { whatsapp: "123" },
    (await load()).version,
    admin,
  );
  assert.equal(bad.kind === "invalid" && Boolean(bad.fields.whatsapp), true);

  const flagged = await updatePerson(
    id,
    { phone: "999" },
    (await load()).version,
    admin,
  );
  assert.equal(flagged.kind === "updated" && flagged.person.needsReview, true);

  // Same transaction → same now() → force the clock on so the next check passes.
  await db()`UPDATE person SET updated_at = updated_at + interval '1 second' WHERE id = ${id}`;
  const fixed = await updatePerson(
    id,
    { phone: "019-876 5432" },
    (await load()).version,
    admin,
  );
  assert.equal(fixed.kind === "updated" && fixed.person.needsReview, false);
});

it("update: marketing can't edit", async () => {
  const id = await idOf("Kavitha Raman");
  assert.equal(
    (await updatePerson(id, { jobTitle: "x" }, "anything", marketing)).kind,
    "forbidden",
  );
});

it("timeline: newest first, paginated; payments hidden from marketing", async () => {
  const id = await idOf("Nur Aisyah binti Ahmad");
  const page1 = await getPersonTimeline(id, admin, 1, 3);
  assert.equal(page1.kind, "ok");
  if (page1.kind !== "ok") return;
  assert.equal(page1.result.data.length, 3);
  assert.ok(page1.result.page.total > 3);
  const times = page1.result.data.map((t) => Date.parse(t.at));
  assert.deepEqual(
    times,
    [...times].sort((a, b) => b - a),
  );

  const full = await getPersonTimeline(id, admin, 1, 50);
  assert.ok(
    full.kind === "ok" && full.result.data.some((t) => t.kind === "payment"),
  );
  const mkt = await getPersonTimeline(id, marketing, 1, 50);
  assert.ok(
    mkt.kind === "ok" &&
      mkt.result.data.every(
        (t) => t.kind !== "payment" && t.kind !== "enrolment_change",
      ),
  );
});

it("consent: marketing reads both purposes; part_time is forbidden", async () => {
  const id = await idOf("Ali bin Hassan");
  const r = await getPersonConsent(id, marketing);
  assert.equal(r.kind === "ok" && r.consent.length, 2);
  assert.equal((await getPersonConsent(id, partTimer)).kind, "forbidden");
});

it("PDPA export: super_admin only, unmasked, audit-logged, CSV rows", async () => {
  const id = await idOf("Nur Aisyah binti Ahmad");
  assert.equal(
    (await exportPersonData(id, marketing, "json")).kind,
    "forbidden",
  );
  const r = await exportPersonData(id, admin, "csv");
  assert.equal(r.kind, "ok");
  if (r.kind !== "ok") return;
  assert.equal((r.data.person as { email: string }).email, "nur3@example.com");
  assert.equal((await lastAudit()).action, "export");
  const rows = personDataToRows(r.data);
  assert.ok(rows.some(([s, , f]) => s === "person" && f === "email"));
  assert.ok(rows.some(([s]) => s === "payments"));
  assert.ok(
    toCsv(["Section", "Record", "Field", "Value"], rows).includes(
      "nur3@example.com",
    ),
  );
});

it("merge: super_admin only; moves children, keeps chosen fields (§9.3)", async () => {
  const sql = db();
  const ids = (
    await sql`SELECT id FROM person WHERE deleted_at IS NULL ORDER BY created_at LIMIT 2`
  ).map((r) => r.id as string);
  const [a, b] = ids;
  const bothDeals = async () =>
    (
      await sql`SELECT count(*)::int AS n FROM deal WHERE person_id IN ${sql(ids)}`
    )[0].n;
  const before = await bothDeals();
  const [src] = await sql`SELECT full_name, email FROM person WHERE id = ${a}`;

  assert.equal(
    (await mergePeople(a, { targetId: b, fields: {} }, sales)).kind,
    "forbidden",
  );
  assert.equal(
    (await mergePeople(a, { targetId: a, fields: {} }, admin)).kind,
    "invalid",
  );

  const r = await mergePeople(
    a,
    { targetId: b, fields: { fullName: "source", email: "source" } },
    admin,
  );
  assert.equal(r.kind, "merged");

  const [{ n }] =
    await sql`SELECT count(*)::int AS n FROM deal WHERE person_id = ${b}`;
  assert.equal(n, before);
  const [t] = await sql`SELECT full_name, email FROM person WHERE id = ${b}`;
  assert.deepEqual({ ...t }, { ...src });
  const [s] = await sql`SELECT merged_into_id FROM person WHERE id = ${a}`;
  assert.equal(s.merged_into_id, b);
  assert.equal(
    (await mergePeople(a, { targetId: b, fields: {} }, admin)).kind,
    "conflict",
  );
});

it("delete: super_admin only, reason audited", async () => {
  const sql = db();
  const [{ id: free }] = await sql`
    SELECT p.id FROM person p WHERE p.deleted_at IS NULL AND p.merged_into_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM enrolment e WHERE e.person_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM deal d JOIN payment y ON y.deal_id = d.id WHERE d.person_id = p.id)
    LIMIT 1`;

  assert.equal((await deletePerson(free, "test", sales)).kind, "forbidden");
  assert.equal(
    (await deletePerson(free, "made by mistake", admin)).kind,
    "done",
  );
  const [gone] = await sql`SELECT deleted_at FROM person WHERE id = ${free}`;
  assert.ok(gone.deleted_at);
  const audit = await lastAudit();
  assert.equal(audit.action, "soft_delete");
  assert.equal(audit.after.reason, "made by mistake");
  assert.equal((await deletePerson(free, "again", admin)).kind, "not_found");
});

it("delete: refused for someone with an enrolment", async () => {
  const [{ id: used }] =
    await db()`SELECT person_id AS id FROM enrolment LIMIT 1`;
  assert.equal((await deletePerson(used, "test", admin)).kind, "conflict");
});

it("erase: anonymises, keeps enrolments, super_admin only", async () => {
  const sql = db();
  const [{ id }] = await sql`SELECT person_id AS id FROM enrolment LIMIT 1`;
  const [{ n: before }] =
    await sql`SELECT count(*)::int AS n FROM enrolment WHERE person_id = ${id}`;

  assert.equal(
    (await erasePerson(id, "PDPA request", sales)).kind,
    "forbidden",
  );
  assert.equal((await erasePerson(id, "PDPA request", admin)).kind, "done");

  const [p] =
    await sql`SELECT full_name, email, phone, erased_at, deleted_at FROM person WHERE id = ${id}`;
  assert.equal(p.full_name, "Erased person");
  assert.equal(p.email, null);
  assert.equal(p.phone, null);
  assert.ok(p.erased_at && p.deleted_at);
  const [{ n }] =
    await sql`SELECT count(*)::int AS n FROM enrolment WHERE person_id = ${id}`;
  assert.equal(n, before);
});

it("needs_review_reason is set with the flag (migration 002)", async () => {
  const r = await createPerson(
    { fullName: "Bad Phone", phone: "12345", preferredLanguage: "en" },
    admin,
  );
  assert.ok(r.kind === "created");
  assert.equal(r.person.needsReview, true);
  const [row] =
    await db()`SELECT needs_review_reason FROM person WHERE id = ${r.person.id}`;
  assert.equal(row.needs_review_reason, "phone_unnormalised");
});

it("soft match (a): typed company vs current company or company_name_given, via the database rule (§12.2)", async () => {
  const sql = db();
  const id = await idOf("Chong Wei Ming");
  await sql`UPDATE person SET company_name_given = 'Kilat Trading (M) Sdn. Bhd.' WHERE id = ${id}`;

  const d = await getPersonDetail(id, admin);
  assert.ok(d.kind === "ok");
  assert.equal(d.detail.person.companyNameGiven, "Kilat Trading (M) Sdn. Bhd.");

  const typed = await normaliseCompanyName("KILAT TRADING SDN BHD");
  assert.equal(typed, "kilattrading");
  assert.equal(await normaliseCompanyName("N/A"), null);

  const norms = await dedupeCandidates(
    { fullName: "Chong Wei Ming", emailNorm: null, phoneE164: null },
    null,
  );
  const me = norms.find((p) => p.id === id);
  assert.ok(me?.companyNorms.includes("kilattrading"));
  const hit = findDuplicate(
    {
      fullName: "chong wei-ming",
      emailNorm: null,
      phoneE164: null,
      companyNorm: typed,
    },
    norms,
  );
  assert.ok(hit.kind === "soft" && hit.on === "company");
  // A null company (e.g. "N/A") never matches on its own.
  assert.equal(
    findDuplicate(
      {
        fullName: "chong wei-ming",
        emailNorm: null,
        phoneE164: null,
        companyNorm: null,
      },
      norms,
    ).kind,
    "none",
  );
});
