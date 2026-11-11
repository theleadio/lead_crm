import { db } from "../sql.ts";
import type { Holidays } from "./deadline.ts";

// Where an enquiry goes (migration 019, from the lead_sales ticket design):
// the first matching `enquiry_rule`, otherwise its category's team. Inside the
// team it is given round robin to the active member who was given one longest
// ago, unless the rule names the person or says nobody.

export type Route = {
  teamId: string;
  mode: "round_robin" | "fixed" | "none";
  userId: string | null;
};

export class UnknownCategory extends Error {
  constructor() {
    super("Unknown or inactive category.");
  }
}

export async function loadHolidays(): Promise<Holidays> {
  const rows = await db()`
    SELECT day::text AS day FROM holiday
    WHERE day BETWEEN current_date - 7 AND current_date + 400`;
  return new Set(rows.map((r) => r.day as string));
}

export type CategoryOption = {
  code: string;
  label: string;
  labelZh: string | null;
  teamId: string;
  teamName: string;
  active: boolean;
};

// Every category, inactive ones too: an old enquiry may still carry one, and
// its label must still read. Pickers offer the active ones only.
export async function listCategories(): Promise<CategoryOption[]> {
  const rows = await db()`
    SELECT c.code, c.label_en, c.label_zh, c.team_id, c.active, t.name AS team_name
    FROM enquiry_category c JOIN team t ON t.id = c.team_id
    ORDER BY c.position, c.code`;
  return rows.map((r) => ({
    code: r.code as string,
    label: r.label_en as string,
    labelZh: (r.label_zh as string | null) ?? null,
    teamId: r.team_id as string,
    teamName: r.team_name as string,
    active: r.active as boolean,
  }));
}

export async function listTeams(): Promise<{ id: string; name: string }[]> {
  const rows = await db()`SELECT id, name FROM team ORDER BY name`;
  return rows.map((r) => ({ id: r.id as string, name: r.name as string }));
}

// The first active category whose keyword appears in the text. It only
// suggests: a person still picks.
export async function suggestCategory(text: string): Promise<string | null> {
  const lower = text.toLowerCase();
  const cats = await db()`
    SELECT code, keywords FROM enquiry_category
    WHERE active ORDER BY position, code`;
  for (const c of cats)
    if (
      (c.keywords as string[]).some((k) => k && lower.includes(k.toLowerCase()))
    )
      return c.code as string;
  return null;
}

export async function categoryTeam(category: string): Promise<string> {
  const [cat] = await db()`
    SELECT team_id FROM enquiry_category WHERE code = ${category} AND active`;
  if (!cat) throw new UnknownCategory();
  return cat.team_id as string;
}

// `category` null: an enquiry nobody has categorised yet (a first WhatsApp
// message with no keyword match). It goes to the default team, and only
// rules that match no category apply.
export async function route(
  category: string | null,
  channel: string,
): Promise<Route> {
  const teamId =
    category === null
      ? ((await db()`SELECT id FROM team WHERE is_default`)[0].id as string)
      : await categoryTeam(category);
  const [rule] = await db()`
    SELECT set_team_id, assign_mode, assign_user_id FROM enquiry_rule
    WHERE active
      AND (match_channel IS NULL OR match_channel = ${channel})
      AND (match_category IS NULL OR match_category = ${category})
    ORDER BY position, id
    LIMIT 1`;
  return {
    teamId: (rule?.set_team_id as string | null) ?? teamId,
    mode: (rule?.assign_mode as Route["mode"]) ?? "round_robin",
    userId: (rule?.assign_user_id as string | null) ?? null,
  };
}

// The active member given an enquiry longest ago (never-assigned first). The
// member rows are locked, so two enquiries at once go to two people.
export async function nextInTeam(teamId: string): Promise<string | null> {
  const [m] = await db()`
    SELECT m.user_id FROM team_member m
    JOIN app_user u ON u.id = m.user_id AND u.is_active
    WHERE m.team_id = ${teamId}
    ORDER BY m.last_assigned_at NULLS FIRST, m.added_at, m.user_id
    LIMIT 1
    FOR UPDATE OF m`;
  return (m?.user_id as string | undefined) ?? null;
}

// Moves the member to the back of the round-robin line. A no-op for someone
// who is not in the team.
export async function noteAssigned(teamId: string, userId: string | null) {
  if (!userId) return;
  await db()`
    UPDATE team_member SET last_assigned_at = clock_timestamp()
    WHERE team_id = ${teamId} AND user_id = ${userId}`;
}

export async function isActiveMember(teamId: string, userId: string) {
  const [m] = await db()`
    SELECT 1 FROM team_member m
    JOIN app_user u ON u.id = m.user_id AND u.is_active
    WHERE m.team_id = ${teamId} AND m.user_id = ${userId}`;
  return Boolean(m);
}

export async function teamIsRestricted(teamId: string): Promise<boolean> {
  const [t] = await db()`SELECT restricted FROM team WHERE id = ${teamId}`;
  return Boolean(t?.restricted);
}

export async function teamHasActiveMembers(teamId: string): Promise<boolean> {
  const [m] = await db()`
    SELECT 1 FROM team_member m
    JOIN app_user u ON u.id = m.user_id AND u.is_active
    WHERE m.team_id = ${teamId} LIMIT 1`;
  return Boolean(m);
}

// One history row. `before`/`after` carry ids and codes only, never free
// text: the table is append-only, and only `note` can be erased.
export async function enquiryEvent(
  enquiryId: string,
  actorId: string | null,
  kind:
    "created" | "status" | "assigned" | "category" | "note" | "first_response",
  before: unknown,
  after: unknown,
  note: string | null = null,
) {
  const sql = db();
  await sql`
    INSERT INTO enquiry_event (enquiry_id, user_id, kind, before, after, note)
    VALUES (${enquiryId}, ${actorId}, ${kind},
            ${before == null ? null : sql.json(before as never)},
            ${after == null ? null : sql.json(after as never)},
            ${note})`;
}
