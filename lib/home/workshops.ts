// Home's Free workshops section (12 Nov 2026). Free workshops are not CRM
// classes yet (January, after cutover). Their registrations are the GHL form
// submissions that ghl:forms imports as touchpoints named after the form
// (lib/import/ghl-forms.ts), so a workshop is read from its form's name, e.g.
//   ".02 LEAD - AI Vibe Coding Masterclass 18 Nov 2026"
// An earlier version read "| Lead |" campaign names, but those only reach the
// CRM for a contact's first or last ad: 31 people against 157 registrations.
import { writeAudit } from "../audit.ts";
import { PermissionError, type Viewer } from "../auth/permissions.ts";
import { parseWorkshopForm, type WorkshopKey } from "../import/ghl-forms.ts";
import { livePersonSql } from "../reports/ads.ts";
import { db, withTransaction } from "../sql.ts";
import { canSeeLeadCounts } from "./service.ts";
import type { HomeWorkshop } from "./types.ts";

export type { WorkshopKey };

const WINDOW_DAYS = 14;

// Free workshops dated today to 14 days ahead in Kuala Lumpur (§4), the same
// window as Upcoming classes. Forms whose title differs only in case are one
// workshop; a person who registered twice, or on two of its forms, counts
// once. Registrations are counted over all time: each form is for one date.
export async function upcomingWorkshops(
  viewer: Viewer,
): Promise<HomeWorkshop[]> {
  if (!canSeeLeadCounts(viewer)) throw new PermissionError("person");
  const sql = db();
  // shortcut: groups in TypeScript over every imported registration (299 on
  // 12 Nov); move into SQL if they pass ~50k.
  const rows = await sql`
    SELECT DISTINCT t.form_name, t.person_id
    FROM touchpoint t
    JOIN person p ON p.id = t.person_id
    WHERE t.channel = 'import' AND t.external_ref LIKE 'ghl-form:%'
      AND ${livePersonSql(sql)}`;

  const goals = new Map(
    (
      await sql`
        SELECT key, (value ->> 'goal')::int AS goal, version FROM app_setting
        WHERE key LIKE ${GOAL_PREFIX + "%"}`
    ).map((r) => [
      r.key as string,
      { goal: r.goal as number, version: Number(r.version) },
    ]),
  );

  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
  });
  const last = new Date(Date.parse(`${today}T00:00:00Z`) + WINDOW_DAYS * 864e5)
    .toISOString()
    .slice(0, 10);

  const groups = new Map<
    string,
    {
      key: WorkshopKey;
      people: Set<string>;
      // People per spelling, to show the most-used one.
      titles: Map<string, Set<string>>;
      forms: Set<string>;
    }
  >();
  for (const r of rows) {
    const key = parseWorkshopForm(r.form_name as string);
    if (!key || key.date < today || key.date > last) continue;
    const id = `${key.title.toLowerCase()}|${key.language}|${key.date}`;
    const g = groups.get(id) ?? {
      key,
      people: new Set(),
      titles: new Map(),
      forms: new Set(),
    };
    g.people.add(r.person_id as string);
    g.forms.add(r.form_name as string);
    const spelled = g.titles.get(key.title) ?? new Set<string>();
    spelled.add(r.person_id as string);
    g.titles.set(key.title, spelled);
    groups.set(id, g);
  }

  return [...groups.values()]
    .map((g) => {
      const goal = goals.get(workshopGoalKey(g.key));
      return {
        title: [...g.titles].sort((a, b) => b[1].size - a[1].size)[0][0],
        language: g.key.language,
        date: g.key.date,
        signups: g.people.size,
        forms: g.forms.size,
        goal: goal?.goal ?? null,
        goalVersion: goal?.version ?? null,
      };
    })
    .sort(
      (a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title),
    );
}

// Sign-up goals (Zixuan, 12 Nov 2026). Free workshops have no table of their
// own until they become classes (January), so each goal is an app_setting
// row keyed by the workshop the way upcomingWorkshops groups it. A form
// renamed to a new title or date is a new workshop and starts without a goal.
// shortcut: per-event data in the settings table; move goals to class capacity
// when free workshops become classes, then delete these rows.
const GOAL_PREFIX = "workshop_goal:";

export function workshopGoalKey(k: WorkshopKey): string {
  return `${GOAL_PREFIX}${k.title.toLowerCase()}|${k.language}|${k.date}`;
}

// Zixuan, 12 Nov: management (the boss), marketing and operations set goals.
export function canSetWorkshopGoal(viewer: Viewer): boolean {
  return ["super_admin", "management", "marketing", "operations"].includes(
    viewer.role,
  );
}

export type SetGoalResult =
  | { ok: true; goal: number; version: number }
  | { ok: false; reason: "conflict" };

// `version` is the goal's version as the screen saw it, null when it saw no
// goal. Someone else's change in between is refused, not overwritten (§7).
export async function setWorkshopGoal(
  viewer: Viewer,
  input: WorkshopKey & { goal: number; version: number | null },
): Promise<SetGoalResult> {
  if (!canSetWorkshopGoal(viewer)) throw new PermissionError("settings");
  if (!Number.isInteger(input.goal) || input.goal < 1 || input.goal > 10000)
    throw new RangeError("goal must be a whole number from 1 to 10000");
  const key = workshopGoalKey(input);

  return withTransaction(async () => {
    const sql = db();
    const [before] = await sql`
      SELECT (value ->> 'goal')::int AS goal, version FROM app_setting
      WHERE key = ${key} FOR UPDATE`;
    const seen = before ? Number(before.version) : null;
    if (seen !== input.version) return { ok: false, reason: "conflict" };

    const [after] = before
      ? await sql`
          UPDATE app_setting
          SET value = ${sql.json({ goal: input.goal })}, updated_by = ${viewer.id},
              updated_at = now()
          WHERE key = ${key} RETURNING version`
      : await sql`
          INSERT INTO app_setting (key, value, created_by, updated_by)
          VALUES (${key}, ${sql.json({ goal: input.goal })}, ${viewer.id}, ${viewer.id})
          RETURNING version`;

    await writeAudit({
      userId: viewer.id,
      action: before ? "update" : "create",
      entity: "workshop_goal",
      entityId: null,
      before: before ? { key, goal: before.goal } : null,
      after: { key, goal: input.goal },
    });
    return { ok: true, goal: input.goal, version: Number(after.version) };
  });
}
