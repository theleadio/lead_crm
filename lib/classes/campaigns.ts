// Which Meta campaigns sell a class (class page, 12 Nov 2026; migration 023).
// Home's Upcoming classes cards count WhatsApp opt-ins through these links.
// The link is Meta's numeric campaign id; the name is display only, so a
// renamed or respelled campaign stays linked. One campaign sells one class at
// most (the class_meta_campaign_one_class key), so its opt-ins never count on
// two cards. Every link and unlink is audited (Shawn's review of #71).
import { writeAudit } from "../audit.ts";
import {
  PermissionError,
  requirePermission,
  type Viewer,
} from "../auth/permissions.ts";
import { isUuid } from "../people/service.ts";
import { db, withTransaction } from "../sql.ts";

export type LinkedCampaign = {
  campaignId: string;
  name: string;
  // Last day the campaign spent, Kuala Lumpur date; null with no Meta rows.
  lastDay: string | null;
  // Linked by the nightly auto-link (no created_by), not by a person.
  automatic: boolean;
};

export type CampaignChoice = {
  campaignId: string;
  name: string;
  lastDay: string;
  // Its name carries the class's start day and month.
  suggested: boolean;
  // Code of the class it already sells, or null when free to link.
  linkedTo: string | null;
};

// Campaigns that spent this recently are offered for linking.
const CHOICE_DAYS = 90;

// Zixuan, 12 Nov: the people who run the ads and the classes.
export function canLinkCampaigns(viewer: Viewer): boolean {
  return ["super_admin", "operations", "marketing", "management"].includes(
    viewer.role,
  );
}

const MONTHS = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");
const FULL_MONTHS = (
  "january february march april may june july " +
  "august september october november december"
).split(" ");

// "LEAD | Oct2026 | WhatsApp | AI Full-Stack CN 14-15 Nov KL" names its class
// in the part after the third "|". The "Oct2026" part is when the campaign
// was made, so it is never read as the class date.
export function suggestsClass(
  campaignName: string,
  startDate: string,
): boolean {
  const parts = campaignName.split("|");
  if (parts.length < 4) return false;
  const event = parts.slice(3).join("|");
  const day = Number(startDate.slice(8, 10));
  const m = Number(startDate.slice(5, 7)) - 1;
  // The month as a whole word, short or full ("Nov", "28Nov", "November"),
  // so "Marketing" or "Junior" are never read as Mar or Jun (review, 12 Nov).
  const month = [MONTHS[m], FULL_MONTHS[m], ...(m === 8 ? ["sept"] : [])].join(
    "|",
  );
  return (
    new RegExp(`(^|\\D)0?${day}(\\D|$)`).test(event) &&
    new RegExp(`(^|[^a-z])(${month})(?![a-z])`, "i").test(event)
  );
}

const MONTH_WORDS = new Set([...MONTHS, ...FULL_MONTHS, "sept"]);

// Words too common to tell two courses apart.
const GENERIC = new Set(
  (
    "ai en cn zh kl jb pg hrdc self funded the and for with of " +
    "certification certificate mastery masterclass workshop course courses " +
    "programme program class online live webinar foundation building " +
    "sales lead leads whatsapp traffic impression conversion details targeting copy"
  ).split(" "),
);

function courseWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(
        (w) =>
          w.length >= 3 &&
          !/\d/.test(w) &&
          !GENERIC.has(w) &&
          !MONTH_WORDS.has(w),
      ),
  );
}

// The auto-link's second test, beside the date: the campaign's event part
// shares a real word with the course name or the class code ("Automation",
// "Full-Stack", "Claude"), so a same-day campaign for another course
// ("AI 全栈开发课程 11 Nov" against AI Automation 11 Nov) is not linked.
export function sharesCourseWord(
  campaignName: string,
  courseName: string,
  classCode: string,
): boolean {
  const parts = campaignName.split("|");
  if (parts.length < 4) return false;
  const course = courseWords(`${courseName} ${classCode}`);
  for (const w of courseWords(parts.slice(3).join(" ")))
    if (course.has(w)) return true;
  return false;
}

// Meta rows of the configured ad account only, like the ads report.
function accountSql(sql: ReturnType<typeof db>) {
  const account = process.env.META_AD_ACCOUNT_ID?.trim().replace(/^act_/, "");
  return account ? sql`AND account_id = ${account}` : sql``;
}

export async function classCampaigns(
  classId: string,
  viewer: Viewer,
): Promise<{ linked: LinkedCampaign[]; choices: CampaignChoice[] }> {
  requirePermission(viewer, "class", "read");
  if (!isUuid(classId)) return { linked: [], choices: [] };
  const sql = db();
  const [cls] = await sql`
    SELECT to_char(start_date, 'YYYY-MM-DD') AS start_date FROM class
    WHERE id = ${classId}`;
  if (!cls) return { linked: [], choices: [] };

  // Meta's latest name per campaign and its last day with a row, read only
  // for the campaigns asked about (review, 12 Nov: the whole table was
  // aggregated twice on every class page).
  const meta = (only: ReturnType<typeof sql>) => sql`
    SELECT campaign_id, (array_agg(campaign_name ORDER BY day DESC))[1] AS name,
           max(day) AS last_day
    FROM meta_ad_insight WHERE ${only} ${accountSql(sql)}
    GROUP BY campaign_id`;

  const linked = await sql`
    SELECT l.meta_campaign_id, coalesce(m.name, l.campaign_name) AS name,
           to_char(m.last_day, 'YYYY-MM-DD') AS last_day,
           l.created_by IS NULL AS automatic
    FROM class_meta_campaign l
    LEFT JOIN (${meta(sql`campaign_id IN (SELECT meta_campaign_id FROM class_meta_campaign
                                           WHERE class_id = ${classId})`)}) m
      ON m.campaign_id = l.meta_campaign_id
    WHERE l.class_id = ${classId}
    ORDER BY m.last_day DESC NULLS LAST, name`;

  // The picker lists every recent campaign, so only people who may link get
  // it; other class readers see the linked ones only (review, 12 Nov).
  const choices = canLinkCampaigns(viewer)
    ? await sql`
        SELECT m.campaign_id, m.name, to_char(m.last_day, 'YYYY-MM-DD') AS last_day,
               k.code AS linked_to
        FROM (${meta(sql`day >= (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date - ${CHOICE_DAYS}::int`)}) m
        LEFT JOIN class_meta_campaign l ON l.meta_campaign_id = m.campaign_id
        LEFT JOIN class k ON k.id = l.class_id
        WHERE l.class_id IS DISTINCT FROM ${classId}::uuid`
    : [];

  return {
    linked: linked.map((r) => ({
      campaignId: r.meta_campaign_id as string,
      name: r.name as string,
      lastDay: (r.last_day as string | null) ?? null,
      automatic: r.automatic as boolean,
    })),
    choices: choices
      .map((r) => ({
        campaignId: r.campaign_id as string,
        name: r.name as string,
        lastDay: r.last_day as string,
        suggested: suggestsClass(r.name as string, cls.start_date as string),
        linkedTo: (r.linked_to as string | null) ?? null,
      }))
      .sort(
        (a, b) =>
          Number(b.suggested) - Number(a.suggested) ||
          b.lastDay.localeCompare(a.lastDay) ||
          a.name.localeCompare(b.name),
      ),
  };
}

export type LinkResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "unknown_campaign" }
  | { ok: false; reason: "linked_elsewhere"; classCode: string };

export async function linkCampaign(
  viewer: Viewer,
  classId: string,
  campaignId: string,
): Promise<LinkResult> {
  if (!canLinkCampaigns(viewer)) throw new PermissionError("class");
  if (!isUuid(classId)) return { ok: false, reason: "not_found" };
  return withTransaction(async () => {
    const sql = db();
    const [cls] = await sql`SELECT id FROM class WHERE id = ${classId}`;
    if (!cls) return { ok: false, reason: "not_found" } as const;
    const [campaign] = await sql`
      SELECT (array_agg(campaign_name ORDER BY day DESC))[1] AS name
      FROM meta_ad_insight
      WHERE campaign_id = ${campaignId} ${accountSql(sql)}
      HAVING count(*) > 0`;
    if (!campaign) return { ok: false, reason: "unknown_campaign" } as const;

    const elsewhere = async () => {
      const [other] = await sql`
        SELECT k.code FROM class_meta_campaign l JOIN class k ON k.id = l.class_id
        WHERE l.meta_campaign_id = ${campaignId} AND l.class_id <> ${classId}`;
      return other?.code as string | undefined;
    };
    const code = await elsewhere();
    if (code)
      return {
        ok: false,
        reason: "linked_elsewhere",
        classCode: code,
      } as const;

    // No conflict target: a same-pair relink and a lost race on the
    // one-class key both insert nothing, rather than raising (review, 12 Nov:
    // a caught unique violation still failed the outer transaction). A new
    // statement then sees the winner's commit and says which class it is.
    const inserted = await sql`
      INSERT INTO class_meta_campaign (class_id, meta_campaign_id, campaign_name, created_by)
      VALUES (${classId}, ${campaignId}, ${campaign.name}, ${viewer.id})
      ON CONFLICT DO NOTHING
      RETURNING class_id`;
    if (!inserted.length) {
      const winner = await elsewhere();
      if (winner)
        return {
          ok: false,
          reason: "linked_elsewhere",
          classCode: winner,
        } as const;
    }

    if (inserted.length)
      await writeAudit({
        userId: viewer.id,
        action: "create",
        entity: "class",
        entityId: classId,
        before: null,
        after: { linkedCampaign: { id: campaignId, name: campaign.name } },
      });
    return { ok: true } as const;
  });
}

export async function unlinkCampaign(
  viewer: Viewer,
  classId: string,
  campaignId: string,
): Promise<{ ok: true; removed: boolean }> {
  if (!canLinkCampaigns(viewer)) throw new PermissionError("class");
  if (!isUuid(classId)) return { ok: true, removed: false };
  return withTransaction(async () => {
    const sql = db();
    const [removed] = await sql`
      DELETE FROM class_meta_campaign
      WHERE class_id = ${classId} AND meta_campaign_id = ${campaignId}
      RETURNING campaign_name`;
    if (removed)
      await writeAudit({
        userId: viewer.id,
        action: "delete",
        entity: "class",
        entityId: classId,
        before: {
          linkedCampaign: { id: campaignId, name: removed.campaign_name },
        },
        after: null,
      });
    return { ok: true, removed: Boolean(removed) };
  });
}

// Nightly auto-link (Zixuan, 12 Nov 2026), run by scripts/link-class-campaigns.ts
// after the Meta sync. A campaign that spent in the last 90 days and is not
// linked yet is linked to a class that starts today or later when:
//  - its name carries that class's start day and month (suggestsClass), and
//  - it shares a course word with the class (sharesCourseWord), and
//  - exactly one class fits both; two fitting classes are left to a person.
// A link someone removed (an audited unlink of that class and campaign) is
// never added back. Auto links have no created_by, which the class page shows
// as "Linked automatically"; the audit row names the script in `after.by`.
export async function autoLinkCampaigns(opts: { apply: boolean }): Promise<{
  links: { classCode: string; campaignId: string; name: string }[];
  stats: Record<string, number>;
}> {
  return withTransaction(async () => {
    const sql = db();
    const classes = await sql`
      SELECT k.id, k.code, to_char(k.start_date, 'YYYY-MM-DD') AS start_date,
             co.name_en AS course_name
      FROM class k JOIN course co ON co.id = k.course_id
      WHERE k.status <> 'cancelled'
        AND k.start_date >= (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date`;
    const campaigns = await sql`
      SELECT m.campaign_id, (array_agg(m.campaign_name ORDER BY m.day DESC))[1] AS name
      FROM meta_ad_insight m
      WHERE m.day >= (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date - ${CHOICE_DAYS}::int
        ${accountSql(sql)}
        AND NOT EXISTS (SELECT 1 FROM class_meta_campaign l
                        WHERE l.meta_campaign_id = m.campaign_id)
      GROUP BY m.campaign_id`;
    const removed = new Set(
      (
        await sql`
          SELECT entity_id::text || '|' || (before -> 'linkedCampaign' ->> 'id') AS pair
          FROM audit_log
          WHERE entity = 'class' AND action = 'delete'
            AND before -> 'linkedCampaign' ->> 'id' IS NOT NULL`
      ).map((r) => r.pair as string),
    );

    const stats: Record<string, number> = {
      "campaigns read": campaigns.length,
    };
    const bump = (k: string) => (stats[k] = (stats[k] ?? 0) + 1);
    const links: { classCode: string; campaignId: string; name: string }[] = [];
    for (const c of campaigns) {
      const fits = classes.filter(
        (k) =>
          suggestsClass(c.name, k.start_date) &&
          sharesCourseWord(c.name, k.course_name, k.code),
      );
      if (fits.length === 0) continue;
      if (fits.length > 1) {
        bump("skip: fits more than one class");
        continue;
      }
      const [k] = fits;
      if (removed.has(`${k.id}|${c.campaign_id}`)) {
        bump("skip: someone removed this link");
        continue;
      }
      if (opts.apply) {
        // A person may have linked it since the read above: then nothing is
        // inserted, audited or counted (review, 12 Nov).
        const made = await sql`
          INSERT INTO class_meta_campaign (class_id, meta_campaign_id, campaign_name)
          VALUES (${k.id}, ${c.campaign_id}, ${c.name})
          ON CONFLICT DO NOTHING
          RETURNING class_id`;
        if (!made.length) {
          bump("skip: linked by someone meanwhile");
          continue;
        }
        await writeAudit({
          userId: null,
          action: "create",
          entity: "class",
          entityId: k.id,
          before: null,
          after: {
            linkedCampaign: { id: c.campaign_id, name: c.name },
            by: "auto-link",
          },
        });
      }
      links.push({
        classCode: k.code,
        campaignId: c.campaign_id,
        name: c.name,
      });
      bump("links");
    }
    return { links, stats };
  });
}
