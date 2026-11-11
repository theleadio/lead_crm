import { writeAudit } from "../audit.ts";
import { normalizePhoneE164 } from "../format/phone.ts";
import { findDuplicate } from "../people/dedupe.ts";
import { raiseDuplicateTask } from "../people/duplicate-review.ts";
import { dedupeCandidates } from "../people/service.ts";
import { db, withTransaction } from "../sql.ts";

// Click-to-WhatsApp (CTWA) opt-ins from WATI. When someone taps a Meta ad and
// messages us, WATI keeps Meta's referral on the message (`messageReferral`):
// `sourceId` is the Meta ad id (21 of 22 matched meta_ad_insight.ad_id on
// 11 Nov) and `ctwaClid` is the click id Meta's Conversions API takes back.
// Each referral becomes one `ctwa` touchpoint, so /reports/ads can count
// WhatsApp opt-ins per ad and campaign (campaignJoinSql resolves utm_ad_id).
//
// WATI repeats the same referral on several messages of one conversation, so
// a touchpoint is keyed on the click id; a referral without one is keyed on
// ad id and day. Only the ids are kept: never the message text (PDPA).

export type WatiMessage = {
  id?: string | null;
  whatsappMessageId?: string | null;
  owner?: boolean | null;
  created?: string | null;
  timestamp?: string | number | null;
  messageReferral?: unknown;
};

export type CtwaReferral = {
  adId: string | null;
  ctwaClid: string | null;
  headline: string | null;
  url: string | null;
};

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim()
    ? v.trim()
    : typeof v === "number"
      ? String(v)
      : null;

// The referral on a customer's message, or null. WATI sends it as an object
// through the API; a JSON string is accepted too.
export function referralOf(m: WatiMessage): CtwaReferral | null {
  if (m.owner === true) return null; // sent by us, not the customer
  let r = m.messageReferral;
  if (typeof r === "string") {
    try {
      r = JSON.parse(r);
    } catch {
      return null;
    }
  }
  if (!r || typeof r !== "object") return null;
  const o = r as Record<string, unknown>;
  const adId = str(o.sourceId);
  const ctwaClid = str(o.ctwaClid);
  if (!adId && !ctwaClid) return null;
  return { adId, ctwaClid, headline: str(o.headline), url: str(o.url) };
}

export function sentAt(m: WatiMessage): Date | null {
  const t = str(m.timestamp);
  if (t && /^\d+$/.test(t))
    return new Date(Number(t) * (t.length > 10 ? 1 : 1000));
  const d = m.created ? new Date(m.created) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

// The touchpoint's idempotency key (touchpoint_external_ref_uq is per channel).
export function ctwaRef(r: CtwaReferral, at: Date): string {
  return r.ctwaClid
    ? `wati:clid:${r.ctwaClid}`
    : `wati:ad:${r.adId}:${at.toISOString().slice(0, 10)}`;
}

export type CtwaSave =
  | { kind: "saved"; touchpointId: string; firstTouch: boolean; newPerson: boolean }
  | { kind: "exists" }
  | { kind: "skipped"; reason: string };

// One opt-in: find the person by WhatsApp number (§12.2 hard match) or create
// them as the public form does, then add the touchpoint. Safe to repeat.
export async function saveCtwaTouch(
  waId: string,
  name: string | null,
  r: CtwaReferral,
  at: Date,
): Promise<CtwaSave> {
  const digits = waId.replace(/\D/g, "");
  const e164 = digits ? normalizePhoneE164(`+${digits}`) : null;
  if (!e164) return { kind: "skipped", reason: "no usable phone" };
  const ref = ctwaRef(r, at);

  return withTransaction(async () => {
    const sql = db();
    // Two runs, or a run and the future webhook, never make two people.
    await sql`SELECT pg_advisory_xact_lock(hashtext(${`wati:${e164}`}))`;
    const [seen] = await sql`
      SELECT 1 FROM touchpoint WHERE channel = 'ctwa' AND external_ref = ${ref}`;
    if (seen) return { kind: "exists" } as const;

    const candidate = {
      fullName: name ?? `WhatsApp ${e164}`,
      emailNorm: null,
      phoneE164: e164,
      companyNorm: null,
    };
    const dup = findDuplicate(candidate, await dedupeCandidates(candidate, null));
    let personId: string;
    let newPerson = false;
    if (dup.kind === "hard") {
      personId = dup.match.id;
    } else {
      const reason = dup.kind === "soft" ? `possible_duplicate_${dup.on}` : null;
      const [p] = await sql`
        INSERT INTO person (full_name, phone, phone_e164, whatsapp_e164,
                            needs_review, needs_review_reason)
        VALUES (${candidate.fullName}, ${e164}, ${e164}, ${e164},
                ${reason !== null}, ${reason})
        RETURNING id`;
      personId = p.id;
      newPerson = true;
      if (dup.kind === "soft")
        await raiseDuplicateTask(
          personId,
          { id: dup.match.id, fullName: dup.match.fullName },
          null,
        );
      await writeAudit({
        userId: null,
        action: "create",
        entity: "person",
        entityId: personId,
        before: null,
        after: { source: "wati_ctwa" },
      });
    }

    // First touch only for someone with no touchpoint at all (as the form).
    const [{ n }] = await sql`
      SELECT count(*)::int AS n FROM touchpoint WHERE person_id = ${personId}`;
    const firstTouch = n === 0;
    const [tp] = await sql`
      INSERT INTO touchpoint (person_id, channel, occurred_at, utm_source,
                              utm_medium, utm_content, utm_ad_id, ctwa_clid,
                              landing_url, form_name, is_first_touch,
                              external_ref)
      VALUES (${personId}, 'ctwa', ${at}, 'facebook', 'ctwa', ${r.adId},
              ${r.adId}, ${r.ctwaClid}, ${r.url}, 'wati-ctwa', ${firstTouch},
              ${ref})
      RETURNING id`;
    await sql`
      UPDATE person
      SET last_activity_at = greatest(last_activity_at, ${at}),
          first_touchpoint_id = coalesce(first_touchpoint_id,
                                         ${firstTouch ? tp.id : null})
      WHERE id = ${personId}`;
    return {
      kind: "saved",
      touchpointId: tp.id as string,
      firstTouch,
      newPerson,
    } as const;
  });
}

// ---- WATI API (read only) -----------------------------------------------------

type WatiContact = {
  wAid?: string;
  fullName?: string | null;
  lastUpdated?: string | null;
};

function watiGet(path: string): Promise<Record<string, unknown>> {
  const host = process.env.WATI_API_HOST?.replace(/\/$/, "");
  const tok = process.env.WATI_API_TOKEN;
  if (!host || !tok) throw new Error("WATI_API_HOST / WATI_API_TOKEN are not set");
  const auth = tok.startsWith("Bearer") ? tok : `Bearer ${tok}`;
  return fetch(`${host}${path}`, { headers: { Authorization: auth } }).then(
    async (res) => {
      if (!res.ok) throw new Error(`WATI ${path.split("?")[0]}: HTTP ${res.status}`);
      return (await res.json()) as Record<string, unknown>;
    },
  );
}

// Contacts newest-updated first (WATI's order), stopping at `since`.
export async function* watiContactsSince(
  since: Date,
): AsyncGenerator<WatiContact> {
  for (let page = 1; ; page++) {
    const r = await watiGet(`/api/v1/getContacts?pageSize=100&pageNumber=${page}`);
    const list = (r.contact_list ?? []) as WatiContact[];
    for (const c of list) {
      const u = c.lastUpdated ? new Date(c.lastUpdated) : null;
      if (u && u < since) return;
      yield c;
    }
    if (list.length < 100) return;
  }
}

// One contact's messages from `since` on (WATI pages newest first).
export async function watiMessagesSince(
  waId: string,
  since: Date,
): Promise<WatiMessage[]> {
  const out: WatiMessage[] = [];
  for (let page = 1; page <= 20; page++) {
    const r = await watiGet(
      `/api/v1/getMessages/${encodeURIComponent(waId)}?pageSize=100&pageNumber=${page}`,
    );
    const m = (r.messages ?? {}) as { items?: WatiMessage[]; hasNextPage?: boolean };
    const items = m.items ?? [];
    let older = false;
    for (const it of items) {
      const at = sentAt(it);
      if (at && at < since) older = true;
      else out.push(it);
    }
    if (older || !m.hasNextPage || items.length === 0) break;
  }
  return out;
}
