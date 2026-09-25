import type postgres from "postgres";
import {
  canWriteCompany,
  permissionFor,
  type Viewer,
} from "../auth/permissions.ts";
import { writeAudit } from "../audit.ts";
import { db, withTransaction } from "../sql.ts";
import type {
  CompanyCreate,
  CompanyUpdate,
  MemberInput,
  MembershipUpdate,
} from "../validation/company.ts";
import { likeEscape } from "../people/search.ts";
import { isUuid, visibleSql } from "../people/service.ts";
import type { ListResponse } from "../people/types.ts";
import type {
  CompanyDetail,
  CompanyListItem,
  CompanyListQuery,
} from "./types.ts";

// Service layer for spec §9.4 Companies. Companies fall under the `person`
// row of the §6 matrix.

// §6 (v1.2): a part-timer sees companies they own, or of people they can
// see. Expects company aliased as `c`.
export function visibleCompanySql(sql: postgres.Sql, viewer: Viewer) {
  const { assignedOnly } = permissionFor(viewer, "person", "read");
  const base = sql`c.deleted_at IS NULL`;
  if (!assignedOnly) return base;
  return sql`${base} AND (
    c.owner_user_id = ${viewer.id}
    OR EXISTS (
      SELECT 1 FROM company_membership m JOIN person p ON p.id = m.person_id
      WHERE m.company_id = c.id AND m.end_date IS NULL AND ${visibleSql(sql, viewer)}
    )
  )`;
}

export async function listCompanies(
  query: CompanyListQuery,
  viewer: Viewer,
): Promise<ListResponse<CompanyListItem>> {
  const sql = db();
  const text = query.q?.trim();
  const openDeal = sql`EXISTS (SELECT 1 FROM deal d WHERE d.company_id = c.id
    AND d.deleted_at IS NULL AND d.stage NOT IN ('won', 'lost'))`;
  // "Similar companies" (§9.4): the same name_norm (the database's
  // normalise_company_name(), migration 003) or the same registration no.
  // ignoring case, spaces and hyphens. A warning for the caller, not a block.
  const similarTo = query.similarTo?.trim();
  const reg = query.registrationNo?.trim();
  const similar =
    similarTo || reg
      ? sql`AND (
          ${
            similarTo
              ? sql`(c.name_norm IS NOT NULL AND c.name_norm = normalise_company_name(${similarTo}))`
              : sql`false`
          }
          OR ${
            reg
              ? sql`(c.registration_no IS NOT NULL AND regexp_replace(lower(c.registration_no), '[\\s-]', '', 'g')
                     = regexp_replace(lower(${reg}), '[\\s-]', '', 'g'))`
              : sql`false`
          }
        )`
      : sql``;
  const where = sql`${visibleCompanySql(sql, viewer)}
    ${similar}
    ${query.excludeId && isUuid(query.excludeId) ? sql`AND c.id <> ${query.excludeId}` : sql``}
    ${text ? sql`AND c.legal_name ILIKE ${`%${likeEscape(text)}%`}` : sql``}
    ${query.hrdcRegistered === undefined ? sql`` : sql`AND c.hrdc_registered = ${query.hrdcRegistered}`}
    ${query.hasOpenDeal === undefined ? sql`` : query.hasOpenDeal ? sql`AND ${openDeal}` : sql`AND NOT ${openDeal}`}`;
  const [{ total }] = await sql`
    SELECT count(*)::int AS total FROM company c WHERE ${where}`;
  const rows = await sql`
    SELECT c.id, c.legal_name, c.industry, c.size_band, c.hrdc_registered,
           (SELECT count(*)::int FROM company_membership m
              JOIN person p ON p.id = m.person_id
             WHERE m.company_id = c.id AND m.end_date IS NULL
               AND p.deleted_at IS NULL AND p.merged_into_id IS NULL) AS people_count,
           (SELECT count(*)::int FROM deal d
             WHERE d.company_id = c.id AND d.deleted_at IS NULL
               AND d.stage NOT IN ('won', 'lost')) AS open_deals
    FROM company c
    WHERE ${where}
    ORDER BY lower(c.legal_name) ${query.sort === "-name" ? sql`DESC` : sql`ASC`}, c.id
    LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`;
  return {
    data: rows.map((r) => ({
      id: r.id,
      legalName: r.legal_name,
      industry: r.industry,
      sizeBand: r.size_band,
      hrdcRegistered: r.hrdc_registered,
      peopleCount: r.people_count,
      openDeals: r.open_deals,
    })),
    page: { total, page: query.page, limit: query.limit },
  };
}

export type CompanyResult =
  | { kind: "ok"; detail: CompanyDetail }
  | { kind: "not_found" }
  | { kind: "forbidden" };

export async function getCompanyDetail(
  id: string,
  viewer: Viewer,
): Promise<CompanyResult> {
  if (!isUuid(id)) return { kind: "not_found" };
  const sql = db();
  const [c] = await sql`
    SELECT c.*,
           to_char(c.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at_text,
           u.id AS owner_id, u.full_name AS owner_name
    FROM company c LEFT JOIN app_user u ON u.id = c.owner_user_id
    WHERE c.id = ${id} AND ${visibleCompanySql(sql, viewer)}`;
  if (!c) {
    const [exists] = await sql`
      SELECT 1 FROM company WHERE id = ${id} AND deleted_at IS NULL`;
    return { kind: exists ? "forbidden" : "not_found" };
  }

  const members = await sql`
    SELECT m.id AS membership_id, p.id, p.full_name, m.job_title,
           m.is_hr_contact, m.is_billing_contact,
           to_char(m.start_date, 'YYYY-MM-DD') AS start_date
    FROM company_membership m JOIN person p ON p.id = m.person_id
    WHERE m.company_id = ${id} AND m.end_date IS NULL AND ${visibleSql(sql, viewer)}
    ORDER BY m.is_hr_contact DESC, lower(p.full_name)`;

  const past = await sql`
    SELECT m.id AS membership_id, p.id, p.full_name, m.job_title,
           to_char(m.start_date, 'YYYY-MM-DD') AS start_date,
           to_char(m.end_date, 'YYYY-MM-DD') AS end_date
    FROM company_membership m JOIN person p ON p.id = m.person_id
    WHERE m.company_id = ${id} AND m.end_date IS NOT NULL AND ${visibleSql(sql, viewer)}
    ORDER BY m.end_date DESC, lower(p.full_name)`;

  const can = (r: "deal" | "enrolment" | "payment") =>
    permissionFor(viewer, r, "read").allowed;

  const deals = can("deal")
    ? await sql`
        SELECT d.id, d.stage, d.amount_myr, co.name_en AS course_name, u.full_name AS owner_name
        FROM deal d
        LEFT JOIN course co ON co.id = d.course_id
        LEFT JOIN app_user u ON u.id = d.owner_user_id
        WHERE d.company_id = ${id} AND d.deleted_at IS NULL
        ORDER BY d.created_at DESC`
    : null;

  const enrolments = can("enrolment")
    ? await sql`
        SELECT e.id, p.full_name AS person_name, cl.code AS class_code, e.status, e.price_paid_myr
        FROM enrolment e
        JOIN deal d ON d.id = e.deal_id
        JOIN person p ON p.id = e.person_id
        JOIN class cl ON cl.id = e.class_id
        WHERE d.company_id = ${id} AND d.deleted_at IS NULL
        ORDER BY e.created_at DESC`
    : null;

  // Net of refunds. §6 ²: sales sees only payments on deals they own.
  let totalRevenue: string | null = null;
  if (can("payment")) {
    const [r] = await sql`
      SELECT coalesce(sum(pay.amount_myr - pay.refunded_amount_myr), 0)::text AS total
      FROM payment pay
      LEFT JOIN enrolment e ON e.id = pay.enrolment_id
      JOIN deal d ON d.id = coalesce(pay.deal_id, e.deal_id)
      WHERE d.company_id = ${id} AND d.deleted_at IS NULL
        AND pay.status IN ('succeeded', 'partially_refunded', 'refunded')
        ${viewer.role === "sales" ? sql`AND d.owner_user_id = ${viewer.id}` : sql``}`;
    totalRevenue = r.total;
  }

  return {
    kind: "ok",
    detail: {
      company: {
        id: c.id,
        legalName: c.legal_name,
        registrationNo: c.registration_no,
        industry: c.industry,
        sizeBand: c.size_band,
        hrdcRegistered: c.hrdc_registered,
        billingAddress: c.billing_address,
        billingEmail: c.billing_email,
        owner: c.owner_id ? { id: c.owner_id, fullName: c.owner_name } : null,
        updatedAt: c.updated_at_text,
      },
      members: members.map((m) => ({
        membershipId: m.membership_id,
        startDate: m.start_date,
        personId: m.id,
        fullName: m.full_name,
        jobTitle: m.job_title,
        isHrContact: m.is_hr_contact,
        isBillingContact: m.is_billing_contact,
      })),
      pastMembers: past.map((m) => ({
        membershipId: m.membership_id,
        personId: m.id,
        fullName: m.full_name,
        jobTitle: m.job_title,
        startDate: m.start_date,
        endDate: m.end_date,
      })),
      deals:
        deals?.map((d) => ({
          id: d.id,
          stage: d.stage,
          courseName: d.course_name,
          amountMyr: d.amount_myr,
          owner: d.owner_name,
        })) ?? null,
      enrolments:
        enrolments?.map((e) => ({
          id: e.id,
          personName: e.person_name,
          classCode: e.class_code,
          status: e.status,
          pricePaidMyr: e.price_paid_myr,
        })) ?? null,
      totalRevenueMyr: totalRevenue,
    },
  };
}

// ---------------------------------------------------------------------------
// Writes — spec §7 / §9.4 (v1.5). Roles: super_admin, sales, support.
// ---------------------------------------------------------------------------

const blankToNull = (s: string | undefined) => (s?.trim() ? s.trim() : null);

async function activeOwner(id: string | null | undefined) {
  if (id === undefined || id === null) return { ok: true as const, id: null };
  if (!isUuid(id)) return { ok: false as const };
  const [u] =
    await db()`SELECT id FROM app_user WHERE id = ${id} AND is_active`;
  return u ? { ok: true as const, id: u.id as string } : { ok: false as const };
}

export type WriteResult =
  | { kind: "ok"; id: string }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "invalid"; fields: Record<string, string> };

export async function createCompany(
  input: CompanyCreate,
  viewer: Viewer,
): Promise<WriteResult> {
  if (!canWriteCompany(viewer)) return { kind: "forbidden" };
  return withTransaction(async (): Promise<WriteResult> => {
    const sql = db();
    const owner = await activeOwner(input.ownerId);
    if (!owner.ok)
      return {
        kind: "invalid",
        fields: { ownerId: "That owner doesn't exist" },
      };
    const row = {
      legal_name: input.legalName.trim(),
      registration_no: blankToNull(input.registrationNo),
      industry: blankToNull(input.industry),
      size_band: blankToNull(input.sizeBand),
      hrdc_registered: input.hrdcRegistered ?? false,
      billing_address: blankToNull(input.billingAddress),
      billing_email: blankToNull(input.billingEmail),
      owner_user_id: owner.id,
      created_by: viewer.id,
    };
    const [c] = await sql`
      INSERT INTO company ${sql(row)} RETURNING id`;
    await writeAudit({
      userId: viewer.id,
      action: "create",
      entity: "company",
      entityId: c.id,
      before: null,
      after: row,
    });
    return { kind: "ok", id: c.id };
  });
}

export async function updateCompany(
  id: string,
  patch: CompanyUpdate,
  viewer: Viewer,
): Promise<WriteResult> {
  if (!canWriteCompany(viewer)) return { kind: "forbidden" };
  if (!isUuid(id)) return { kind: "not_found" };
  return withTransaction(async (): Promise<WriteResult> => {
    const sql = db();
    const [before] = await sql`
      SELECT c.* FROM company c
      WHERE c.id = ${id} AND ${visibleCompanySql(sql, viewer)} FOR UPDATE`;
    if (!before) return { kind: "not_found" };

    const set: Record<string, string | boolean | null> = {};
    if (patch.legalName !== undefined) set.legal_name = patch.legalName.trim();
    if (patch.registrationNo !== undefined)
      set.registration_no = blankToNull(patch.registrationNo);
    if (patch.industry !== undefined)
      set.industry = blankToNull(patch.industry);
    if (patch.sizeBand !== undefined)
      set.size_band = blankToNull(patch.sizeBand);
    if (patch.hrdcRegistered !== undefined)
      set.hrdc_registered = patch.hrdcRegistered;
    if (patch.billingAddress !== undefined)
      set.billing_address = blankToNull(patch.billingAddress);
    if (patch.billingEmail !== undefined)
      set.billing_email = blankToNull(patch.billingEmail);
    if (patch.ownerId !== undefined) {
      const owner = await activeOwner(patch.ownerId);
      if (!owner.ok)
        return {
          kind: "invalid",
          fields: { ownerId: "That owner doesn't exist" },
        };
      set.owner_user_id = owner.id;
    }
    const columns = Object.keys(set);
    if (!columns.length) return { kind: "ok", id };

    await sql`UPDATE company SET ${sql(set, columns)} WHERE id = ${id}`;
    await writeAudit({
      userId: viewer.id,
      action: "update",
      entity: "company",
      entityId: id,
      before: Object.fromEntries(columns.map((c) => [c, before[c] ?? null])),
      after: set,
    });
    return { kind: "ok", id };
  });
}

export type AttachResult =
  | {
      kind: "attached";
      member: { membershipId: string; personId: string; companyId: string };
    }
  | { kind: "forbidden" }
  | { kind: "company_not_found" }
  | { kind: "person_not_found" }
  | { kind: "duplicate" };

// POST /api/companies/:id/members — spec §7. Adds a current membership.
// `replaceCurrent` ends the person's other current memberships (end_date =
// today) in the same transaction — the 9.2 company picker. The schema
// allows one current link per (person, company): a second call for the
// same pair is a 409, not a silent no-op.
export async function attachMember(
  companyId: string,
  input: MemberInput,
  viewer: Viewer,
): Promise<AttachResult> {
  if (!canWriteCompany(viewer)) return { kind: "forbidden" };
  if (!isUuid(companyId)) return { kind: "company_not_found" };
  if (!isUuid(input.personId)) return { kind: "person_not_found" };

  return withTransaction(async (): Promise<AttachResult> => {
    const sql = db();
    const [company] = await sql`
      SELECT c.id FROM company c
      WHERE c.id = ${companyId} AND ${visibleCompanySql(sql, viewer)}`;
    if (!company) return { kind: "company_not_found" };
    const [person] = await sql`
      SELECT p.id FROM person p
      WHERE p.id = ${input.personId} AND ${visibleSql(sql, viewer)}
      FOR UPDATE`;
    if (!person) return { kind: "person_not_found" };

    const [existing] = await sql`
      SELECT 1 FROM company_membership
      WHERE person_id = ${input.personId} AND company_id = ${companyId}
        AND end_date IS NULL`;
    if (existing) return { kind: "duplicate" };

    let ended: string[] = [];
    if (input.replaceCurrent)
      ended = (
        await sql`
          UPDATE company_membership
          SET end_date = greatest(current_date, start_date)
          WHERE person_id = ${input.personId} AND end_date IS NULL
          RETURNING id`
      ).map((r) => r.id as string);

    const jobTitle = blankToNull(input.jobTitle);
    const [row] = await sql`
      INSERT INTO company_membership
        (person_id, company_id, job_title, is_hr_contact, is_billing_contact,
         start_date, created_by)
      VALUES (${input.personId}, ${companyId}, ${jobTitle},
              ${input.isHrContact}, ${input.isBillingContact},
              current_date, ${viewer.id})
      RETURNING id`;
    await writeAudit({
      userId: viewer.id,
      action: "create",
      entity: "company_membership",
      entityId: row.id,
      before: null,
      after: {
        personId: input.personId,
        companyId,
        jobTitle,
        isHrContact: input.isHrContact,
        isBillingContact: input.isBillingContact,
        endedMemberships: ended,
      },
    });
    return {
      kind: "attached",
      member: {
        membershipId: row.id,
        personId: input.personId,
        companyId,
      },
    };
  });
}

export type MembershipResult =
  | { kind: "ok" }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "already_ended" }
  | { kind: "invalid"; fields: Record<string, string> };

// PATCH /api/companies/:id/members/:membershipId — spec §7.1 (v1.5). Edit
// job title and HR/billing flags, or end the membership. Rows are never
// deleted; ending is one-way (to rejoin, POST a new membership).
export async function updateMembership(
  companyId: string,
  membershipId: string,
  patch: MembershipUpdate,
  viewer: Viewer,
): Promise<MembershipResult> {
  if (!canWriteCompany(viewer)) return { kind: "forbidden" };
  if (!isUuid(companyId) || !isUuid(membershipId)) return { kind: "not_found" };

  return withTransaction(async (): Promise<MembershipResult> => {
    const sql = db();
    const [m] = await sql`
      SELECT m.*, to_char(m.start_date, 'YYYY-MM-DD') AS start_text
      FROM company_membership m
      JOIN company c ON c.id = m.company_id
      WHERE m.id = ${membershipId} AND m.company_id = ${companyId}
        AND ${visibleCompanySql(sql, viewer)}
      FOR UPDATE OF m`;
    if (!m) return { kind: "not_found" };
    if (m.end_date) return { kind: "already_ended" };

    const set: Record<string, string | boolean | null> = {};
    if (patch.jobTitle !== undefined)
      set.job_title = blankToNull(patch.jobTitle);
    if (patch.isHrContact !== undefined) set.is_hr_contact = patch.isHrContact;
    if (patch.isBillingContact !== undefined)
      set.is_billing_contact = patch.isBillingContact;
    if (patch.endDate !== undefined) {
      const valid = !Number.isNaN(Date.parse(`${patch.endDate}T00:00:00Z`));
      if (!valid)
        return { kind: "invalid", fields: { endDate: "Enter a valid date" } };
      if (m.start_text && patch.endDate < m.start_text)
        return {
          kind: "invalid",
          fields: { endDate: "The end date can't be before the start date" },
        };
      set.end_date = patch.endDate;
    }
    const columns = Object.keys(set);
    if (!columns.length) return { kind: "ok" };

    await sql`UPDATE company_membership SET ${sql(set, columns)} WHERE id = ${membershipId}`;
    await writeAudit({
      userId: viewer.id,
      action: "update",
      entity: "company_membership",
      entityId: membershipId,
      before: Object.fromEntries(columns.map((c) => [c, m[c] ?? null])),
      after: set,
    });
    return { kind: "ok" };
  });
}
