import { writeAudit } from "../audit.ts";
import { canWriteDeal, type Viewer } from "../auth/permissions.ts";
import { createDeal } from "../deals/detail-service.ts";
import type { Pipeline } from "../deals/types.ts";
import { raiseEvent } from "../events/raise.ts";
import { isUuid } from "../people/service.ts";
import { db, withTransaction } from "../sql.ts";
import { enquiryAccessSql, mayUseEnquiries } from "./access.ts";
import { enquiryRow } from "./list.ts";
import { enquiryEvent } from "./routing.ts";
import {
  isActiveStatus,
  type EnquiryRow,
  type EnquiryStatus,
} from "./types.ts";

// POST /api/enquiries/:id/convert — §9.13 "convert to deal": a deal for the
// enquiry's person, opened in `new` through the same createDeal() as the New
// deal control (owner: the person converting), the enquiry closed as
// `converted` and linked to it (§5 CHECK), its history and audit rows, and
// EnquiryConverted (§11.1), all in one transaction. Closing is final, as for
// any close.

export type ConvertInput = {
  pipeline: Pipeline;
  courseId?: string | null;
};

export type ConvertResult =
  | { kind: "ok"; enquiry: EnquiryRow; dealId: string }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "stale" }
  | { kind: "not_open"; status: EnquiryStatus }
  | { kind: "invalid"; fields: Record<string, string> };

// Thrown inside the transaction so a refused deal rolls everything back.
class Refused extends Error {
  readonly result: ConvertResult;
  constructor(result: ConvertResult) {
    super(result.kind);
    this.result = result;
  }
}

export async function convertEnquiry(
  id: string,
  input: ConvertInput,
  ifMatch: number,
  viewer: Viewer,
): Promise<ConvertResult> {
  // Both: working the enquiry, and opening a deal (§6 deal write).
  if (!canWriteDeal(viewer) || !(await mayUseEnquiries(viewer, "write")))
    return { kind: "forbidden" };
  if (!isUuid(id)) return { kind: "not_found" };

  try {
    return await withTransaction(async (): Promise<ConvertResult> => {
      const sql = db();
      const [before] = await sql`
        SELECT e.* FROM enquiry e
        WHERE e.id = ${id} AND ${enquiryAccessSql(sql, viewer, "write")}
        FOR UPDATE`;
      if (!before) return { kind: "not_found" };
      if (Number(before.version) !== ifMatch) return { kind: "stale" };
      if (!isActiveStatus(before.status as EnquiryStatus))
        return { kind: "not_open", status: before.status as EnquiryStatus };

      const made = await createDeal(
        {
          pipeline: input.pipeline,
          personId: before.person_id as string,
          ...(input.courseId ? { courseId: input.courseId } : {}),
        },
        viewer,
      );
      if (made.kind === "invalid")
        throw new Refused({ kind: "invalid", fields: made.fields });
      if (made.kind !== "created") throw new Refused({ kind: made.kind });
      const dealId = made.deal.id;

      await sql`
        UPDATE enquiry
        SET status = 'converted', deal_id = ${dealId}, handled_by = 'user',
            closed_at = now()
        WHERE id = ${id} AND version = ${ifMatch}`;
      await enquiryEvent(
        id,
        viewer.id,
        "status",
        { status: before.status },
        { status: "converted", dealId },
      );
      await writeAudit({
        userId: viewer.id,
        action: "update",
        entity: "enquiry",
        entityId: id,
        before: { status: before.status, deal_id: null },
        after: { status: "converted", deal_id: dealId },
      });
      await raiseEvent(
        "EnquiryConverted",
        id,
        { enquiryId: id, dealId },
        viewer.id,
      );
      return { kind: "ok", enquiry: (await enquiryRow(id))!, dealId };
    });
  } catch (e) {
    if (e instanceof Refused) return e.result;
    throw e;
  }
}
