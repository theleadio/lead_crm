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
  const month = MONTHS[Number(startDate.slice(5, 7)) - 1];
  return (
    new RegExp(`(^|\\D)0?${day}(\\D|$)`).test(event) &&
    new RegExp(`(^|[^a-z])${month}`, "i").test(event)
  );
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

  // Meta's latest name per campaign, and its last day with a row.
  const meta = sql`
    SELECT campaign_id, (array_agg(campaign_name ORDER BY day DESC))[1] AS name,
           max(day) AS last_day
    FROM meta_ad_insight WHERE true ${accountSql(sql)}
    GROUP BY campaign_id`;

  const linked = await sql`
    SELECT l.meta_campaign_id, coalesce(m.name, l.campaign_name) AS name,
           to_char(m.last_day, 'YYYY-MM-DD') AS last_day
    FROM class_meta_campaign l
    LEFT JOIN (${meta}) m ON m.campaign_id = l.meta_campaign_id
    WHERE l.class_id = ${classId}
    ORDER BY m.last_day DESC NULLS LAST, name`;

  const choices = await sql`
    SELECT m.campaign_id, m.name, to_char(m.last_day, 'YYYY-MM-DD') AS last_day,
           k.code AS linked_to
    FROM (${meta}) m
    LEFT JOIN class_meta_campaign l ON l.meta_campaign_id = m.campaign_id
    LEFT JOIN class k ON k.id = l.class_id
    WHERE m.last_day >= (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date - ${CHOICE_DAYS}::int
      AND l.class_id IS DISTINCT FROM ${classId}::uuid`;

  return {
    linked: linked.map((r) => ({
      campaignId: r.meta_campaign_id as string,
      name: r.name as string,
      lastDay: (r.last_day as string | null) ?? null,
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

    let inserted: { length: number };
    try {
      // A savepoint, so a lost race on the one-class key leaves this
      // transaction usable for the answer below.
      inserted = await withTransaction(
        () => sql`
          INSERT INTO class_meta_campaign (class_id, meta_campaign_id, campaign_name, created_by)
          VALUES (${classId}, ${campaignId}, ${campaign.name}, ${viewer.id})
          ON CONFLICT (class_id, meta_campaign_id) DO NOTHING
          RETURNING class_id`,
      );
    } catch (err) {
      const raced =
        (err as { constraint_name?: string }).constraint_name ===
        "class_meta_campaign_one_class";
      if (!raced) throw err;
      return {
        ok: false,
        reason: "linked_elsewhere",
        classCode: (await elsewhere()) ?? "another class",
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
