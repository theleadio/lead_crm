// Integration tests for spec §9.4 Companies against the seeded dev database.
// Each test rolls back. Skipped when DATABASE_URL isn't set.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import type { Viewer } from "../lib/auth/permissions.ts";
import {
  attachMember,
  createCompany,
  getCompanyDetail,
  listCompanies,
  similarCompanies,
  updateCompany,
  updateMembership,
} from "../lib/companies/service.ts";
import { closeDb, db, rollbackAfter } from "../lib/sql.ts";
import { SEED_USERS } from "../scripts/seed-ids.ts";

after(closeDb);

const it = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !process.env.DATABASE_URL && "no DATABASE_URL" }, () =>
    rollbackAfter(fn),
  );

const admin: Viewer = { id: SEED_USERS.admin, role: "super_admin" };
const marketing: Viewer = { id: SEED_USERS.daphne, role: "marketing" };
const partTimer: Viewer = { id: SEED_USERS.leeYee, role: "part_time" };

const page = { page: 1, limit: 100 };

it("list: counts people, searches by name, hides deleted (§9.4)", async () => {
  const { data, page: p } = await listCompanies(page, admin);
  assert.ok(data.length > 0 && p.total === data.length);

  const [first] = data;
  const found = await listCompanies(
    { ...page, q: first.legalName.slice(0, 4) },
    admin,
  );
  assert.ok(found.data.some((c) => c.id === first.id));

  await db()`UPDATE company SET deleted_at = now() WHERE id = ${first.id}`;
  const after = await listCompanies(page, admin);
  assert.ok(!after.data.some((c) => c.id === first.id));
});

it("detail: members with flags; deals and revenue follow the role matrix (§6)", async () => {
  const [{ id }] = await db()`
    SELECT company_id AS id FROM company_membership WHERE end_date IS NULL LIMIT 1`;
  const asAdmin = await getCompanyDetail(id, admin);
  assert.ok(asAdmin.kind === "ok");
  assert.ok(asAdmin.detail.members.length > 0);
  assert.notEqual(asAdmin.detail.totalRevenueMyr, null);
  assert.ok(asAdmin.detail.deals && asAdmin.detail.enrolments);

  // Marketing: reads companies and deals, but not payments or enrolments.
  const asMarketing = await getCompanyDetail(id, marketing);
  assert.ok(asMarketing.kind === "ok");
  assert.equal(asMarketing.detail.totalRevenueMyr, null);
  assert.equal(asMarketing.detail.enrolments, null);
});

it("detail: missing id is 404; part-timer sees only their companies", async () => {
  const gone = await getCompanyDetail(
    "00000000-0000-4000-8000-000000000000",
    admin,
  );
  assert.equal(gone.kind, "not_found");
  assert.equal((await getCompanyDetail("nope", admin)).kind, "not_found");

  const mine = await listCompanies(page, partTimer);
  const everyone = await listCompanies(page, admin);
  assert.ok(mine.data.length <= everyone.data.length);
  for (const c of everyone.data.filter(
    (c) => !mine.data.some((m) => m.id === c.id),
  ))
    assert.equal((await getCompanyDetail(c.id, partTimer)).kind, "forbidden");
});

it("list filters: HRDC registered and open deal partition the list (§9)", async () => {
  const all = (await listCompanies(page, admin)).data;
  const yes = (await listCompanies({ ...page, hrdcRegistered: true }, admin))
    .data;
  const no = (await listCompanies({ ...page, hrdcRegistered: false }, admin))
    .data;
  assert.equal(yes.length + no.length, all.length);
  assert.ok(
    yes.every((c) => c.hrdcRegistered) && no.every((c) => !c.hrdcRegistered),
  );

  const open = (await listCompanies({ ...page, hasOpenDeal: true }, admin))
    .data;
  const none = (await listCompanies({ ...page, hasOpenDeal: false }, admin))
    .data;
  assert.equal(open.length + none.length, all.length);
  assert.ok(
    open.every((c) => c.openDeals > 0) && none.every((c) => c.openDeals === 0),
  );
});

it("attach member: adds a current link, audits, refuses duplicates and read-only roles (§7)", async () => {
  const sql = db();
  const [{ id: companyId }] =
    await sql`SELECT id FROM company WHERE deleted_at IS NULL LIMIT 1`;
  const [{ id: personId }] = await sql`
    SELECT p.id FROM person p WHERE p.deleted_at IS NULL AND p.merged_into_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM company_membership m
                      WHERE m.person_id = p.id AND m.company_id = ${companyId} AND m.end_date IS NULL)
    LIMIT 1`;
  const input = {
    personId,
    jobTitle: "HR Manager",
    isHrContact: true,
    isBillingContact: false,
    replaceCurrent: false,
  };

  assert.equal(
    (await attachMember(companyId, input, marketing)).kind,
    "forbidden",
  );
  assert.equal(
    (await attachMember(companyId, { ...input, personId: "nope" }, admin)).kind,
    "person_not_found",
  );
  assert.equal(
    (await attachMember("nope", input, admin)).kind,
    "company_not_found",
  );

  assert.equal((await attachMember(companyId, input, admin)).kind, "attached");
  const [m] = await sql`
    SELECT job_title, is_hr_contact FROM company_membership
    WHERE person_id = ${personId} AND company_id = ${companyId} AND end_date IS NULL`;
  assert.deepEqual({ ...m }, { job_title: "HR Manager", is_hr_contact: true });

  const [audit] =
    await sql`SELECT action, entity FROM audit_log ORDER BY created_at DESC LIMIT 1`;
  assert.deepEqual(
    { ...audit },
    { action: "create", entity: "company_membership" },
  );
  assert.equal((await attachMember(companyId, input, admin)).kind, "duplicate");
});

const sales: Viewer = { id: SEED_USERS.weiPing, role: "sales" };

it("company write: super_admin, sales and support only; audited (§7)", async () => {
  const input = {
    legalName: "  Nova Logistics Sdn Bhd ",
    industry: "",
    hrdcRegistered: true,
  };
  assert.equal((await createCompany(input, marketing)).kind, "forbidden");
  assert.equal((await createCompany(input, partTimer)).kind, "forbidden");
  assert.equal(
    (await createCompany({ ...input, ownerId: "nope" }, admin)).kind,
    "invalid",
  );

  const r = await createCompany(input, sales);
  assert.ok(r.kind === "ok");
  const [c] =
    await db()`SELECT legal_name, industry, hrdc_registered, name_norm FROM company WHERE id = ${r.id}`;
  assert.deepEqual(
    { ...c },
    {
      legal_name: "Nova Logistics Sdn Bhd",
      industry: null,
      hrdc_registered: true,
      name_norm: "novalogistics",
    },
  );

  assert.equal(
    (await updateCompany(r.id, { industry: "Freight" }, marketing)).kind,
    "forbidden",
  );
  assert.equal(
    (
      await updateCompany(
        r.id,
        { industry: "Freight", legalName: "Nova Freight Bhd" },
        sales,
      )
    ).kind,
    "ok",
  );
  const [u] =
    await db()`SELECT industry, legal_name FROM company WHERE id = ${r.id}`;
  assert.deepEqual(
    { ...u },
    { industry: "Freight", legal_name: "Nova Freight Bhd" },
  );
  const audit =
    await db()`SELECT action, after FROM audit_log WHERE entity = 'company' AND entity_id = ${r.id} ORDER BY created_at`;
  assert.deepEqual(
    audit.map((a) => a.action),
    ["create", "update"],
  );
});

it("similar companies: same normalised name or registration no., never itself (§9.4)", async () => {
  const made = await createCompany(
    { legalName: "Acme (M) Sdn. Bhd.", registrationNo: "2019-01 234-X" },
    admin,
  );
  assert.ok(made.kind === "ok");
  const names = async (q: object) =>
    (await similarCompanies(q, admin)).map((s) => s.id);

  assert.ok((await names({ name: "ACME SDN BHD" })).includes(made.id));
  assert.ok((await names({ name: "acme berhad" })).includes(made.id));
  assert.ok((await names({ registrationNo: "201901234x" })).includes(made.id));
  assert.ok(
    !(await names({ name: "ACME SDN BHD", excludeId: made.id })).includes(
      made.id,
    ),
  );
  assert.deepEqual(await names({ name: "N/A" }), []);
  assert.deepEqual(await names({}), []);
});

it("members: replaceCurrent switches company; PATCH edits and ends, never deletes (§7)", async () => {
  const sql = db();
  const [a, b] =
    await sql`SELECT id FROM company WHERE deleted_at IS NULL LIMIT 2`;
  const [{ id: personId }] = await sql`
    SELECT id FROM person WHERE deleted_at IS NULL AND merged_into_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM company_membership m WHERE m.person_id = person.id AND m.end_date IS NULL)
    LIMIT 1`;
  const base = {
    personId,
    isHrContact: false,
    isBillingContact: false,
    replaceCurrent: false,
  };
  const current = async () =>
    (
      await sql`SELECT company_id FROM company_membership WHERE person_id = ${personId} AND end_date IS NULL`
    ).map((r) => r.company_id);

  const first = await attachMember(a.id, base, admin);
  assert.ok(first.kind === "attached");
  // Without replaceCurrent, a second company is added next to the first.
  assert.ok((await attachMember(b.id, base, admin)).kind === "attached");
  assert.equal((await current()).length, 2);

  // With it, every other current membership ends.
  const c = await createCompany({ legalName: "Third Co" }, admin);
  assert.ok(c.kind === "ok");
  assert.ok(
    (await attachMember(c.id, { ...base, replaceCurrent: true }, admin))
      .kind === "attached",
  );
  assert.deepEqual(await current(), [c.id]);

  // Edit flags, then end. Ended rows are kept and can't be edited again.
  const [m] =
    await sql`SELECT id FROM company_membership WHERE person_id = ${personId} AND company_id = ${c.id}`;
  assert.equal(
    (
      await updateMembership(
        c.id,
        m.id,
        { jobTitle: "CFO", isBillingContact: true },
        marketing,
      )
    ).kind,
    "forbidden",
  );
  assert.equal(
    (
      await updateMembership(
        c.id,
        m.id,
        { jobTitle: "CFO", isBillingContact: true },
        sales,
      )
    ).kind,
    "ok",
  );
  const bad = await updateMembership(
    c.id,
    m.id,
    { endDate: "1999-01-01" },
    admin,
  );
  assert.ok(bad.kind === "invalid" && bad.fields.endDate);
  assert.equal(
    (await updateMembership(c.id, m.id, { endDate: "2099-01-01" }, admin)).kind,
    "ok",
  );
  assert.equal(
    (await updateMembership(c.id, m.id, { jobTitle: "x" }, admin)).kind,
    "already_ended",
  );
  assert.equal(
    (await updateMembership(a.id, m.id, { jobTitle: "x" }, admin)).kind,
    "not_found",
  );
  const [kept] =
    await sql`SELECT job_title, is_billing_contact, end_date FROM company_membership WHERE id = ${m.id}`;
  assert.equal(kept.job_title, "CFO");
  assert.ok(kept.is_billing_contact && kept.end_date);

  const detail = await getCompanyDetail(c.id, admin);
  assert.ok(detail.kind === "ok");
  assert.ok(detail.detail.pastMembers.some((p) => p.personId === personId));
  assert.ok(!detail.detail.members.some((p) => p.personId === personId));
});
