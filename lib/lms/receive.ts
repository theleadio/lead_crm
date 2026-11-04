import { timingSafeEqual } from "node:crypto";
import { writeAudit } from "../audit.ts";
import { canChangeTo } from "../enrolments/status-rules.ts";
import { isUuid } from "../people/service.ts";
import { db, withTransaction } from "../sql.ts";
import { signLmsBody } from "./send.ts";

// LMS → CRM: attendance and completion (handoff spec §4.6, decided 4 Nov).
// The LMS owns attendance and certificates; it tells the CRM, signed the
// same way the CRM signs its own notices (LMS_WEBHOOK_SECRET), and each
// notice moves the enrolment one step through the CRM's own §12.4 rules.
//
//   enrolment.onboarded  confirmed → onboarded
//   enrolment.attended   onboarded → attended
//   enrolment.no_show    onboarded → no_show
//   enrolment.completed  attended  → completed, with completed_at and
//                        certificate_no
//
// A notice that would skip a step answers 409, so the LMS retries it after
// the earlier one. A repeat of a step already done is a duplicate (200).
// Each LMS messageId is claimed once in integration_event (source 'lms').

export const LMS_SIGNATURE_TOLERANCE_SECONDS = 300;

export function verifyLmsSignature(
  rawBody: string,
  timestampHeader: string | null,
  signatureHeader: string | null,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!secret || !timestampHeader || !signatureHeader) return false;
  const ts = Number.parseInt(timestampHeader, 10);
  if (!Number.isFinite(ts) || String(ts) !== timestampHeader.trim())
    return false;
  if (Math.abs(nowSeconds - ts) > LMS_SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = Buffer.from(signLmsBody(rawBody, secret, ts));
  const given = Buffer.from(signatureHeader.trim());
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export const LMS_INBOUND_TYPES = {
  "enrolment.onboarded": "onboarded",
  "enrolment.attended": "attended",
  "enrolment.no_show": "no_show",
  "enrolment.completed": "completed",
} as const;
type InboundType = keyof typeof LMS_INBOUND_TYPES;

export type LmsInboundEvent = {
  messageId: string;
  type: string;
  data: Record<string, unknown>;
};

export type LmsInboundResult =
  | { kind: "applied"; enrolmentId: string; status: string }
  | { kind: "duplicate" }
  | { kind: "ignored"; reason: string }
  | { kind: "not_found" }
  // Would skip a §12.4 step, e.g. completed before attended: the LMS retries.
  | { kind: "out_of_order"; from: string; to: string }
  | { kind: "invalid"; reason: string };

async function claim(e: LmsInboundEvent): Promise<boolean> {
  const sql = db();
  const [row] = await sql`
    INSERT INTO integration_event (source, external_event_id, payload)
    VALUES ('lms', ${e.messageId},
            ${sql.json({ type: e.type, enrolmentId: e.data.enrolmentId ?? null } as never)})
    ON CONFLICT (source, external_event_id) DO NOTHING
    RETURNING id`;
  if (row) return true;
  const [existing] = await sql`
    SELECT status FROM integration_event
    WHERE source = 'lms' AND external_event_id = ${e.messageId}`;
  return existing?.status === "received" || existing?.status === "failed";
}

async function settle(
  e: LmsInboundEvent,
  status: "processed" | "ignored" | "failed" | "received",
  error: string | null = null,
) {
  await db()`
    UPDATE integration_event
    SET status = ${status}, error = ${error}, updated_at = now(),
        processed_at = ${status === "received" ? null : new Date()}
    WHERE source = 'lms' AND external_event_id = ${e.messageId}`;
}

export async function processLmsEvent(
  e: LmsInboundEvent,
): Promise<LmsInboundResult> {
  if (!(await claim(e))) return { kind: "duplicate" };
  try {
    const result = await apply(e);
    // Out of order: leave it claimable, so the LMS's retry runs it again.
    if (result.kind === "out_of_order")
      await settle(
        e,
        "received",
        `out of order: ${result.from} → ${result.to}`,
      );
    else
      await settle(
        e,
        result.kind === "applied" || result.kind === "duplicate"
          ? "processed"
          : "ignored",
        result.kind === "applied" || result.kind === "duplicate"
          ? null
          : result.kind,
      );
    return result;
  } catch (err) {
    await settle(e, "failed", err instanceof Error ? err.message : String(err));
    throw err;
  }
}

async function apply(e: LmsInboundEvent): Promise<LmsInboundResult> {
  if (!(e.type in LMS_INBOUND_TYPES))
    return { kind: "ignored", reason: `not handled: ${e.type}` };
  const to = LMS_INBOUND_TYPES[e.type as InboundType];
  const enrolmentId = e.data.enrolmentId;
  if (typeof enrolmentId !== "string" || !isUuid(enrolmentId))
    return { kind: "invalid", reason: "data.enrolmentId must be a uuid" };

  let completedAt: Date | null = null;
  let certificateNo: string | null = null;
  if (to === "completed") {
    const at = e.data.completedAt;
    completedAt = typeof at === "string" ? new Date(at) : new Date();
    if (Number.isNaN(completedAt.getTime()))
      return { kind: "invalid", reason: "data.completedAt is not a date" };
    const cert = e.data.certificateNo;
    if (
      cert !== undefined &&
      cert !== null &&
      (typeof cert !== "string" || !cert.trim())
    )
      return { kind: "invalid", reason: "data.certificateNo must be text" };
    certificateNo = typeof cert === "string" ? cert.trim().slice(0, 100) : null;
  }

  return withTransaction(async (): Promise<LmsInboundResult> => {
    const sql = db();
    const [before] = await sql`
      SELECT id, status, certificate_no FROM enrolment
      WHERE id = ${enrolmentId} FOR UPDATE`;
    if (!before) return { kind: "not_found" };
    const from = before.status as string;
    if (from === to) return { kind: "duplicate" };
    if (!canChangeTo(from, to)) return { kind: "out_of_order", from, to };

    if (certificateNo) {
      const [taken] = await sql`
        SELECT 1 FROM enrolment
        WHERE certificate_no = ${certificateNo} AND id <> ${enrolmentId}`;
      if (taken)
        return {
          kind: "invalid",
          reason: "certificateNo is already on another enrolment",
        };
    }

    await sql`
      UPDATE enrolment SET
        status = ${to},
        completed_at = ${to === "completed" ? completedAt : sql`completed_at`},
        certificate_no = ${certificateNo ?? sql`certificate_no`}
      WHERE id = ${enrolmentId}`;
    await writeAudit({
      userId: null,
      action: "update",
      entity: "enrolment",
      entityId: enrolmentId,
      before: { status: from },
      after: {
        status: to,
        ...(certificateNo ? { certificate_no: certificateNo } : {}),
        source: "lms",
      },
    });
    return { kind: "applied", enrolmentId, status: to };
  });
}
