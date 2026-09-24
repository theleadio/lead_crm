import type postgres from "postgres";
import {
  masksContactDetails,
  permissionFor,
  type Viewer,
} from "../auth/permissions.ts";
import { writeAudit } from "../audit.ts";
import { normalizeEmail } from "../format/email.ts";
import { maskEmail, maskPhone } from "../format/mask.ts";
import { normalizePhoneE164 } from "../format/phone.ts";
import { db, withTransaction } from "../sql.ts";
import type { PersonInput } from "../validation/person.ts";
import { findDuplicate, normaliseName, SOFT_REASON_TEXT } from "./dedupe.ts";
import { stageSql } from "./lifecycle.ts";
import { likeEscape, parsePersonQuery } from "./search.ts";
import type {
  ListResponse,
  OwnerOption,
  PeopleFilters,
  PeopleListQuery,
  PersonListItem,
  TagOption,
} from "./types.ts";

// Service layer (spec §3): the only code that touches the database for
// people. Screens → API routes → these functions.

export const isUuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

// Asia/Kuala_Lumpur is UTC+8 with no DST.
const klStartOfDay = (d: string) => new Date(`${d}T00:00:00+08:00`);
const klEndOfDay = (d: string) => new Date(`${d}T23:59:59.999+08:00`);

type Fragment = postgres.PendingQuery<postgres.Row[]>;
const and = (sql: postgres.Sql, parts: Fragment[]) =>
  parts.reduce((acc, part) => sql`${acc} AND ${part}`);

// Spec §6 (v1.2): a part-timer sees people they own, or who have an
// enquiry or task assigned to them — enforced in the WHERE clause, so there
// is no path to page through everyone. Expects person aliased as `p`.
export function visibleSql(sql: postgres.Sql, viewer: Viewer): Fragment {
  const { assignedOnly } = permissionFor(viewer, "person", "read");
  const base = sql`p.deleted_at IS NULL AND p.merged_into_id IS NULL`;
  if (!assignedOnly) return base;
  return sql`${base} AND (
    p.owner_user_id = ${viewer.id}
    OR EXISTS (SELECT 1 FROM enquiry e WHERE e.person_id = p.id AND e.assigned_user_id = ${viewer.id})
    OR EXISTS (SELECT 1 FROM task k WHERE k.person_id = p.id AND k.assigned_user_id = ${viewer.id})
  )`;
}

function whereSql(sql: postgres.Sql, viewer: Viewer, f: PeopleFilters) {
  const parts: Fragment[] = [visibleSql(sql, viewer)];

  const q = f.q ? parsePersonQuery(f.q) : null;
  if (q) {
    const like = `%${likeEscape(q.text)}%`;
    parts.push(sql`(
      p.full_name ILIKE ${like}
      OR p.email_norm LIKE ${like.toLowerCase()}
      ${q.phoneE164 ? sql`OR p.phone_e164 = ${q.phoneE164}` : sql``}
      ${q.digits ? sql`OR regexp_replace(p.phone_e164, '\\D', '', 'g') LIKE ${`%${q.digits}%`}` : sql``}
    )`);
  }
  if (f.stage) parts.push(sql`(${stageSql(sql)}) = ${f.stage}`);
  if (f.language) parts.push(sql`p.preferred_language = ${f.language}`);
  if (f.needsReview !== undefined)
    parts.push(sql`p.needs_review = ${f.needsReview}`);
  if (f.owner === "unassigned") parts.push(sql`p.owner_user_id IS NULL`);
  else if (f.owner)
    parts.push(
      isUuid(f.owner) ? sql`p.owner_user_id = ${f.owner}` : sql`false`,
    );
  if (f.tags?.length) {
    const ids = f.tags.filter(isUuid);
    parts.push(
      ids.length
        ? sql`EXISTS (SELECT 1 FROM person_tag pt WHERE pt.person_id = p.id AND pt.tag_id IN ${sql(ids)})`
        : sql`false`,
    );
  }
  if (f.hasOpenDeal !== undefined) {
    const open = sql`EXISTS (SELECT 1 FROM deal d WHERE d.person_id = p.id
      AND d.deleted_at IS NULL AND d.stage NOT IN ('won', 'lost'))`;
    parts.push(f.hasOpenDeal ? open : sql`NOT ${open}`);
  }
  if (f.createdFrom)
    parts.push(sql`p.created_at >= ${klStartOfDay(f.createdFrom)}`);
  if (f.createdTo) parts.push(sql`p.created_at <= ${klEndOfDay(f.createdTo)}`);

  return and(sql, parts);
}

type ListRow = {
  id: string;
  full_name: string;
  preferred_name: string | null;
  email: string | null;
  phone: string | null;
  phone_e164: string | null;
  preferred_language: "en" | "zh";
  needs_review: boolean;
  last_activity_at: Date | null;
  created_at: Date;
  owner_id: string | null;
  owner_name: string | null;
  stage: "lead" | "student" | "customer";
  tags: string[];
};

function selectList(sql: postgres.Sql) {
  return sql`
    SELECT p.id, p.full_name, p.preferred_name, p.email, p.phone, p.phone_e164,
           p.preferred_language, p.needs_review, p.last_activity_at, p.created_at,
           u.id AS owner_id, u.full_name AS owner_name,
           ${stageSql(sql)} AS stage,
           COALESCE((SELECT array_agg(t.name ORDER BY t.name)
                     FROM person_tag pt JOIN tag t ON t.id = pt.tag_id
                     WHERE pt.person_id = p.id), '{}') AS tags
    FROM person p LEFT JOIN app_user u ON u.id = p.owner_user_id`;
}

// The schema has needs_review but no reason column (raised with Shawn), so
// the reason is derived: an unnormalised phone is visible in the data itself.
export function reviewReason(r: {
  needs_review: boolean;
  phone: string | null;
  phone_e164: string | null;
}): string | null {
  if (!r.needs_review) return null;
  if (r.phone && !r.phone_e164) return "Phone number could not be normalised";
  return "Possible duplicate of another person";
}

// Spec §7: lists never return more than they must. Spec §6 footnote ¹:
// marketing gets masked strings — real values never leave the server.
function toListItem(r: ListRow, viewer: Viewer): PersonListItem {
  const masked = masksContactDetails(viewer.role);
  return {
    id: r.id,
    fullName: r.full_name,
    preferredName: r.preferred_name,
    email: masked ? maskEmail(r.email) : r.email,
    phone: masked ? maskPhone(r.phone_e164 ?? r.phone) : r.phone,
    phoneE164: masked ? null : r.phone_e164,
    preferredLanguage: r.preferred_language,
    stage: r.stage,
    owner: r.owner_id ? { id: r.owner_id, fullName: r.owner_name ?? "" } : null,
    lastActivityAt: r.last_activity_at?.toISOString() ?? null,
    tags: r.tags,
    needsReview: r.needs_review,
    needsReviewReason: reviewReason(r),
    createdAt: r.created_at.toISOString(),
  };
}

export async function listPeople(
  query: PeopleListQuery,
  viewer: Viewer,
): Promise<ListResponse<PersonListItem>> {
  const sql = db();
  const [{ total }] = await sql`
    SELECT count(*)::int AS total FROM person p
    WHERE ${whereSql(sql, viewer, query)}`;
  const rows = await sql<ListRow[]>`
    ${selectList(sql)}
    WHERE ${whereSql(sql, viewer, query)}
    ORDER BY p.created_at DESC, p.id
    LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`;
  return {
    data: rows.map((r) => toListItem(r, viewer)),
    page: { total, page: query.page, limit: query.limit },
  };
}

// Export CSV (spec §7.1): every matching row, not just the page. Audit-logged.
export async function exportPeople(
  filters: PeopleFilters,
  viewer: Viewer,
): Promise<PersonListItem[]> {
  const sql = db();
  const rows = await sql<ListRow[]>`
    ${selectList(sql)}
    WHERE ${whereSql(sql, viewer, filters)}
    ORDER BY p.created_at DESC, p.id`;
  await writeAudit({
    userId: viewer.id,
    action: "export",
    entity: "person",
    entityId: null,
    before: null,
    after: { filters, rowCount: rows.length },
  });
  return rows.map((r) => toListItem(r, viewer));
}

async function listItemById(
  id: string,
  viewer: Viewer,
): Promise<PersonListItem> {
  const sql = db();
  const [row] = await sql<ListRow[]>`${selectList(sql)} WHERE p.id = ${id}`;
  return toListItem(row, viewer);
}

type DupRow = {
  id: string;
  full_name: string;
  email_norm: string | null;
  phone_e164: string | null;
  company_name: string | null;
};

// Candidates for spec §12.2: hard matches on email/phone, plus people whose
// normalised name matches. The pure findDuplicate decides what counts.
export async function dedupeCandidates(
  c: { fullName: string; emailNorm: string | null; phoneE164: string | null },
  excludeId: string | null,
) {
  const sql = db();
  const rows = await sql<DupRow[]>`
    SELECT p.id, p.full_name, p.email_norm, p.phone_e164,
           (SELECT co.legal_name FROM company_membership m
            JOIN company co ON co.id = m.company_id
            WHERE m.person_id = p.id AND m.end_date IS NULL AND co.deleted_at IS NULL
            ORDER BY m.created_at LIMIT 1) AS company_name
    FROM person p
    WHERE p.deleted_at IS NULL AND p.merged_into_id IS NULL
      ${excludeId ? sql`AND p.id <> ${excludeId}` : sql``}
      AND (
        ${c.emailNorm ? sql`p.email_norm = ${c.emailNorm} OR` : sql``}
        ${c.phoneE164 ? sql`p.phone_e164 = ${c.phoneE164} OR` : sql``}
        ${
          normaliseName(c.fullName)
            ? sql`regexp_replace(lower(p.full_name), '[[:space:].''’-]', '', 'g') = ${normaliseName(c.fullName)}`
            : sql`false`
        }
      )
    -- Hard matches first, so the cap can never hide one.
    ORDER BY (
      ${c.emailNorm ? sql`coalesce(p.email_norm = ${c.emailNorm}, false)` : sql`false`}
      OR ${c.phoneE164 ? sql`coalesce(p.phone_e164 = ${c.phoneE164}, false)` : sql`false`}
    ) DESC
    LIMIT 200`;
  return rows.map((r) => ({
    id: r.id,
    fullName: r.full_name,
    emailNorm: r.email_norm,
    phoneE164: r.phone_e164,
    companyName: r.company_name,
  }));
}

export type CreatePersonResult =
  | { kind: "created"; person: PersonListItem }
  | {
      kind: "duplicate";
      on: "email" | "phone";
      existing: { id: string; fullName: string };
    };

const blankToNull = (s: string | undefined) => (s ? s : null);

export async function createPerson(
  input: PersonInput,
  viewer: Viewer,
): Promise<CreatePersonResult> {
  const email = blankToNull(input.email);
  const phone = blankToNull(input.phone);
  const emailNorm = email ? normalizeEmail(email) : null;
  const phoneE164 = phone ? normalizePhoneE164(phone) : null;
  const candidate = {
    fullName: input.fullName,
    emailNorm,
    phoneE164,
    companyName: null,
  };

  return withTransaction(async (): Promise<CreatePersonResult> => {
    // Spec §12.2 runs on every person create, from any route.
    const dup = findDuplicate(
      candidate,
      await dedupeCandidates(candidate, null),
    );
    if (dup.kind === "hard")
      return {
        kind: "duplicate",
        on: dup.on,
        existing: { id: dup.match.id, fullName: dup.match.fullName },
      };

    // Spec §4: an unnormalisable phone is kept and flagged, never dropped.
    const needsReview = Boolean(phone && !phoneE164) || dup.kind === "soft";
    const sql = db();
    const [row] = await sql`
      INSERT INTO person (full_name, preferred_name, email, phone, phone_e164,
                          whatsapp_e164, preferred_language, job_title, notes,
                          needs_review, created_by)
      VALUES (${input.fullName}, ${blankToNull(input.preferredName)}, ${email},
              ${phone}, ${phoneE164}, ${phoneE164}, ${input.preferredLanguage},
              ${blankToNull(input.jobTitle)}, ${blankToNull(input.notes)},
              ${needsReview}, ${viewer.id})
      RETURNING id`;
    // §12.9: a manual create is not an activity — last_activity_at stays null.

    await writeAudit({
      userId: viewer.id,
      action: "create",
      entity: "person",
      entityId: row.id,
      before: null,
      after: {
        ...input,
        needsReview,
        reviewReason:
          dup.kind === "soft" ? SOFT_REASON_TEXT[dup.on] : undefined,
      },
    });
    return { kind: "created", person: await listItemById(row.id, viewer) };
  });
}

export type BulkChange =
  | { kind: "assignOwner"; ownerId: string | null }
  | { kind: "addTag"; tagId: string };

export class InvalidBulkChange extends Error {}

export async function bulkUpdatePeople(
  ids: string[],
  change: BulkChange,
  viewer: Viewer,
): Promise<{ updated: number }> {
  const validIds = ids.filter(isUuid);

  return withTransaction(async () => {
    const sql = db();
    let ownerId: string | null = null;
    if (change.kind === "assignOwner" && change.ownerId) {
      const [owner] = isUuid(change.ownerId)
        ? await sql`SELECT id FROM app_user WHERE id = ${change.ownerId} AND is_active`
        : [];
      if (!owner) throw new InvalidBulkChange("That owner doesn't exist.");
      ownerId = owner.id;
    }
    if (change.kind === "addTag") {
      const [tag] = isUuid(change.tagId)
        ? await sql`SELECT id FROM tag WHERE id = ${change.tagId} AND is_active`
        : [];
      if (!tag) throw new InvalidBulkChange("That tag doesn't exist.");
    }
    if (!validIds.length) return { updated: 0 };

    // Only people this viewer can see (part_time: assigned ones) are touched.
    const targets = await sql<{ id: string; owner_user_id: string | null }[]>`
      SELECT p.id, p.owner_user_id FROM person p
      WHERE p.id IN ${sql(validIds)} AND ${visibleSql(sql, viewer)}
      FOR UPDATE`;
    if (!targets.length) return { updated: 0 };
    const targetIds = targets.map((t) => t.id);

    if (change.kind === "assignOwner") {
      await sql`UPDATE person SET owner_user_id = ${ownerId}
                WHERE id IN ${sql(targetIds)}`;
    } else {
      await sql`
        INSERT INTO person_tag (person_id, tag_id, tagged_by)
        SELECT id, ${change.tagId}, ${viewer.id}
        FROM person WHERE id IN ${sql(targetIds)}
        ON CONFLICT DO NOTHING`;
    }

    for (const t of targets)
      await writeAudit({
        userId: viewer.id,
        action: "update",
        entity: "person",
        entityId: t.id,
        before:
          change.kind === "assignOwner"
            ? { ownerUserId: t.owner_user_id }
            : null,
        after:
          change.kind === "assignOwner"
            ? { ownerUserId: ownerId }
            : { addedTagId: change.tagId },
      });
    return { updated: targets.length };
  });
}

// §7.1: {id, fullName} of active users, nothing else.
export async function listOwnerOptions(): Promise<OwnerOption[]> {
  const sql = db();
  const rows = await sql`
    SELECT id, full_name FROM app_user WHERE is_active ORDER BY full_name`;
  return rows.map((r) => ({ id: r.id, fullName: r.full_name }));
}

export async function listTagOptions(): Promise<TagOption[]> {
  const sql = db();
  const rows = await sql`
    SELECT id, name FROM tag WHERE is_active ORDER BY lower(name)`;
  return rows.map((r) => ({ id: r.id, name: r.name }));
}
