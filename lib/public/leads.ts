import { writeAudit } from "../audit.ts";
import { raiseEvent } from "../events/raise.ts";
import { normalizeEmail } from "../format/email.ts";
import { normalizePhoneE164 } from "../format/phone.ts";
import { findDuplicate } from "../people/dedupe.ts";
import { raiseDuplicateTask } from "../people/duplicate-review.ts";
import { dedupeCandidates, normaliseCompanyName } from "../people/service.ts";
import { db, withTransaction } from "../sql.ts";
import type { LeadInput } from "../validation/public.ts";

// Spec §8.2 server behaviour, steps 2-7 (steps 1 and 8 are the route's).
// One transaction: either the person, touchpoint, consent, deal and the
// LeadCaptured row all exist, or none of them do.

export type LeadResult = { personId: string; dealId: string };
export type LeadContext = {
  // No ip: audit_log is append-only, so a public write must not put the
  // visitor's address there (PDPA; guard.ts keeps it out of the rate-limit
  // table too).
  // Already cleaned by cleanUrl(); chosen by the route from body and headers.
  landingUrl: string | null;
  referrer: string | null;
};

// O14 fallback (decision calendar, 16 Oct): keep only the path and utm_*,
// gclid, fbclid; drop other query parameters, credentials and the fragment.
// Anything that is not http(s) is dropped.
export function cleanUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    u.username = "";
    u.password = "";
    u.hash = "";
    for (const k of [...u.searchParams.keys()])
      if (!/^(utm_[a-z]+|gclid|fbclid)$/.test(k)) u.searchParams.delete(k);
    return u.toString().slice(0, 500);
  } catch {
    return null;
  }
}

// Prefix of touchpoint.external_ref on the synthetic first touch made from a
// first-touch cookie. Contains a space, which no idempotencyKey may.
export const COOKIE_TOUCH_REF = "cookie first touch of";

const isUniqueViolation = (err: unknown, constraint?: string) =>
  typeof err === "object" &&
  err !== null &&
  (err as { code?: string }).code === "23505" &&
  (!constraint ||
    (err as { constraint_name?: string }).constraint_name === constraint);

// A repeat idempotencyKey (§4, §8.2 step 8) finds the first call's touchpoint
// (migration 009, O31) and answers with the same ids. The deal is the one the
// call created (deal.source_touchpoint_id) or, when it attached to an
// existing open deal, the one named in that call's LeadCaptured row.
export async function findReplay(key: string): Promise<LeadResult | null> {
  const sql = db();
  const [t] = await sql`
    SELECT id, person_id, occurred_at FROM touchpoint
    WHERE channel = 'web_form' AND external_ref = ${key}`;
  if (!t) return null;
  const [d] = await sql`
    SELECT id FROM deal WHERE source_touchpoint_id = ${t.id}`;
  if (d) return { personId: t.person_id, dealId: d.id };
  const [e] = await sql`
    SELECT payload->>'dealId' AS deal_id FROM event_outbox
    WHERE type = 'LeadCaptured' AND aggregate_id = ${t.person_id}
      AND payload->>'touchpointId' = ${t.id}
    LIMIT 1`;
  return e ? { personId: t.person_id, dealId: e.deal_id } : null;
}

const isReplayRace = (err: unknown) =>
  isUniqueViolation(err, "touchpoint_external_ref_uq");

export async function captureLead(
  input: LeadInput,
  ctx: LeadContext,
): Promise<LeadResult & { replayed: boolean }> {
  for (let attempt = 0; ; attempt++) {
    try {
      return { ...(await insertLead(input, ctx)), replayed: false };
    } catch (err) {
      // Two calls with one idempotencyKey at once: the loser's transaction is
      // rolled back whole; answer with the winner's result.
      if (input.idempotencyKey && isReplayRace(err)) {
        const replay = await findReplay(input.idempotencyKey);
        if (replay) return { ...replay, replayed: true };
      }
      // Two calls with the same new email/phone at once: the loser retries
      // once and finds the winner's person.
      if (attempt === 0 && isUniqueViolation(err) && !isReplayRace(err))
        continue;
      throw err;
    }
  }
}

async function insertLead(
  input: LeadInput,
  ctx: LeadContext,
): Promise<LeadResult> {
  const emailNorm = input.email ? normalizeEmail(input.email) : null;
  const phoneE164 = input.phone ? normalizePhoneE164(input.phone) : null;
  const a = input.attribution;

  return withTransaction(async () => {
    const sql = db();

    // 3. Find by email_norm / phone_e164 (§12.2 hard match) or create. A soft
    // match still creates, flagged for review. Same code as the CRM's create.
    const candidate = {
      fullName: input.fullName,
      emailNorm,
      phoneE164,
      companyNorm: await normaliseCompanyName(input.companyName),
    };
    const dup = findDuplicate(
      candidate,
      await dedupeCandidates(candidate, null),
    );
    let personId: string;
    if (dup.kind === "hard") {
      personId = dup.match.id;
    } else {
      // §4: an unnormalisable phone is kept and flagged, never dropped.
      const reason =
        input.phone && !phoneE164
          ? "phone_unnormalised"
          : dup.kind === "soft"
            ? `possible_duplicate_${dup.on}`
            : null;
      const [p] = await sql`
        INSERT INTO person (full_name, email, phone, phone_e164,
                            whatsapp_e164, preferred_language, job_title,
                            needs_review, needs_review_reason)
        VALUES (${input.fullName}, ${input.email}, ${input.phone},
                ${phoneE164}, ${phoneE164}, ${input.preferredLanguage},
                ${input.jobTitle}, ${reason !== null}, ${reason})
        RETURNING id`;
      personId = p.id;
      // §12.2 rule 3 / §7.1: same as createPerson. A soft match also records
      // WHO the new person may duplicate, so §9.2 and §9.3 have a pair to open.
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
        after: { source: "public_form", formName: input.formName },
      });
    }

    // 3a. Company: only ever links to an existing one (migration 003).
    if (input.companyName)
      await sql`SELECT link_company_from_form(${personId}, ${input.companyName})`;

    // 4. Touchpoint. The first one a person ever has is their first touch; if
    // the browser's first-touch cookie says they arrived earlier through
    // something else, that becomes the first touch and this one is a later one.
    const [{ n: priorTouches }] = await sql`
      SELECT count(*)::int AS n FROM touchpoint WHERE person_id = ${personId}`;
    const ft = a?.firstTouch;
    const ftAt = ft?.occurredAt ? new Date(ft.occurredAt) : null;
    const ftTime =
      ftAt &&
      ftAt.getTime() <= Date.now() + 60_000 &&
      ftAt.getTime() >= Date.now() - 400 * 86_400_000
        ? ftAt
        : null;
    // Only believed with a usable time: without one the earlier visit cannot be
    // placed before this submission, so this submission stays the first touch.
    const cookieFirst =
      priorTouches === 0 &&
      ftTime !== null &&
      !!(ft?.utmSource || ft?.utmCampaign) &&
      (ft?.utmSource !== a?.utmSource || ft?.utmCampaign !== a?.utmCampaign);

    const [tp] = await sql`
      INSERT INTO touchpoint (person_id, channel, utm_source, utm_medium,
                              utm_campaign, utm_content, utm_term, gclid, fbclid,
                              landing_url, referrer, form_name, is_first_touch,
                              external_ref)
      VALUES (${personId}, 'web_form', ${a?.utmSource ?? null},
              ${a?.utmMedium ?? null}, ${a?.utmCampaign ?? null},
              ${a?.utmContent ?? null}, ${a?.utmTerm ?? null},
              ${a?.gclid ?? null}, ${a?.fbclid ?? null}, ${ctx.landingUrl},
              ${ctx.referrer}, ${input.formName},
              ${priorTouches === 0 && !cookieFirst}, ${input.idempotencyKey})
      RETURNING id`;
    let firstId: string | null = priorTouches === 0 ? tp.id : null;
    if (cookieFirst) {
      // Never later than the submission's own touch (LEAST with the database
      // clock, which the form touch's default also uses). external_ref marks it
      // as the cookie's visit, not a submission: phoneLimited skips it. A
      // client key cannot start with this text (no spaces allowed in a key).
      const [f] = await sql`
        INSERT INTO touchpoint (person_id, channel, occurred_at, utm_source,
                                utm_medium, utm_campaign, is_first_touch,
                                external_ref)
        VALUES (${personId}, 'web_form', LEAST(${ftTime}::timestamptz, now()),
                ${ft?.utmSource ?? null}, ${ft?.utmMedium ?? null},
                ${ft?.utmCampaign ?? null}, true,
                ${`${COOKIE_TOUCH_REF} ${tp.id}`})
        RETURNING id`;
      firstId = f.id;
    }
    // §12.9: a form is a touchpoint, so it counts as activity.
    await sql`
      UPDATE person
      SET last_activity_at = now(),
          first_touchpoint_id = coalesce(first_touchpoint_id, ${firstId})
      WHERE id = ${personId}`;

    // The visitor's message has no column of its own (O41): it is appended to
    // the person's notes, never overwriting what staff wrote.
    if (input.message)
      await sql`
        UPDATE person
        SET notes = left(coalesce(notes || E'\n', '') ||
              ${`[Web form ${input.formName ?? ""}] ${input.message}`}, 10000)
        WHERE id = ${personId}`;

    // 5. Consent. A ticked box grants email and WhatsApp marketing (the form's
    // wording, §10.3). An unticked box records nothing: it is the default, not
    // a withdrawal, and "no consent row" already means "no consent" (§14).
    // A purpose whose latest row is a WITHDRAWAL is never granted again from
    // the public form (PDPA; O45: needs a double opt-in decision). Nothing is
    // recorded for it, but the lead itself is still captured.
    if (input.consentMarketing) {
      for (const purpose of ["marketing_email", "marketing_whatsapp"]) {
        const [latest] = await sql`
          SELECT is_granted FROM consent
          WHERE person_id = ${personId} AND purpose = ${purpose}
          ORDER BY recorded_at DESC, created_at DESC LIMIT 1`;
        if (latest) continue; // granted already, or withdrawn (O45)
        await sql`
          INSERT INTO consent (person_id, purpose, is_granted, source)
          VALUES (${personId}, ${purpose}, true, 'web_form')`;
        await raiseEvent(
          "ConsentChanged",
          personId,
          { personId, purpose, isGranted: true },
          null,
        );
      }
    }

    // 6. Deal in `new`, unless this person already has an open one for the
    // same course. Class code wins over course interest; unknown codes, and
    // classes the public schedule does not show (private, draft, cancelled,
    // completed), are ignored: the lead is still worth capturing.
    const [cls] = input.classCode
      ? await sql`
          SELECT id, course_id FROM class
          WHERE lower(code) = lower(${input.classCode})
            AND is_public AND status IN ('open', 'few_seats', 'full')`
      : [];
    const [crs] =
      !cls && input.courseInterest
        ? await sql`
            SELECT id FROM course WHERE lower(code) = lower(${input.courseInterest})`
        : [];
    const courseId: string | null = cls?.course_id ?? crs?.id ?? null;

    // Two submissions at once for one person must not both miss each other's
    // new deal. They cannot: step 4's UPDATE of the person row holds its lock
    // until commit, so the second waits there and then sees the first's deal.
    // (tests/public-api-db.test.ts fails if that UPDATE is removed.) If that
    // UPDATE ever moves after this lookup, lock the row here with FOR UPDATE.
    const [open] = await sql`
      SELECT id FROM deal
      WHERE person_id = ${personId} AND deleted_at IS NULL
        AND stage NOT IN ('won', 'lost')
        AND course_id IS NOT DISTINCT FROM ${courseId}::uuid
      ORDER BY created_at DESC LIMIT 1`;
    let dealId: string;
    if (open) {
      dealId = open.id;
    } else {
      const [d] = await sql`
        INSERT INTO deal (pipeline, stage, person_id, course_id, class_id,
                          funding_type, source_touchpoint_id)
        VALUES ('individual', 'new', ${personId}, ${courseId}, ${cls?.id ?? null},
                ${input.hrdcIntended ? "hrdc" : null}, ${tp.id})
        RETURNING id`;
      dealId = d.id;
      await writeAudit({
        userId: null,
        action: "create",
        entity: "deal",
        entityId: dealId,
        before: null,
        after: { source: "public_form", pipeline: "individual", stage: "new" },
      });
    }

    // 7. LeadCaptured, in this transaction (§11.1).
    await raiseEvent(
      "LeadCaptured",
      personId,
      { personId, dealId, formName: input.formName ?? "", touchpointId: tp.id },
      null,
    );
    return { personId, dealId };
  });
}
