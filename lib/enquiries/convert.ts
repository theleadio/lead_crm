import { canWriteDeal, type Viewer } from "../auth/permissions.ts";
import { createDeal } from "../deals/detail-service.ts";
import type { Pipeline } from "../deals/types.ts";
import { raiseEvent } from "../events/raise.ts";
import { withTransaction } from "../sql.ts";
import { writeEnquiry, type EnquiryWriteResult } from "./service.ts";
import {
  isActiveStatus,
  type EnquiryRow,
  type EnquiryStatus,
} from "./types.ts";

// POST /api/enquiries/:id/convert — §9.13 "convert to deal": a deal for the
// enquiry's person, opened in `new` through the same createDeal() as the New
// deal control (owner: the person converting), and the enquiry closed as
// `converted` and linked to it (§5 CHECK) through the same writeEnquiry() as
// every other close: lock, If-Match, history and audit rows. EnquiryConverted
// (§11.1) is raised in the same transaction. Closing is final, as for any
// close. createDeal() refuses before it writes anything, so a refusal leaves
// nothing behind.

export type ConvertInput = {
  pipeline: Pipeline;
  courseId?: string | null;
};

export type ConvertResult =
  | { kind: "ok"; enquiry: EnquiryRow; dealId: string }
  | Exclude<EnquiryWriteResult, { kind: "ok" }>;

export async function convertEnquiry(
  id: string,
  input: ConvertInput,
  ifMatch: number,
  viewer: Viewer,
): Promise<ConvertResult> {
  // Converting opens a deal: §6 deal write, as well as working the enquiry
  // (which writeEnquiry checks).
  if (!canWriteDeal(viewer)) return { kind: "forbidden" };

  return withTransaction(async (): Promise<ConvertResult> => {
    let dealId: string | null = null;
    const r = await writeEnquiry(id, ifMatch, viewer, async (before) => {
      const status = before.status as EnquiryStatus;
      if (!isActiveStatus(status)) return { kind: "not_open", status };
      const made = await createDeal(
        {
          pipeline: input.pipeline,
          personId: before.person_id as string,
          ...(input.courseId ? { courseId: input.courseId } : {}),
        },
        viewer,
      );
      if (made.kind === "invalid")
        return { kind: "deal_refused", fields: made.fields };
      if (made.kind === "not_found") return { kind: "person_gone" };
      if (made.kind === "forbidden") return { kind: "forbidden" };
      dealId = made.deal.id;
      return {
        set: { status: "converted", deal_id: dealId, handled_by: "user" },
        closing: true,
        event: {
          kind: "status",
          before: { status },
          after: { status: "converted", dealId },
        },
      };
    });
    if (r.kind !== "ok") {
      // A deal opened but the enquiry not closed would be an orphan: undo
      // both. writeEnquiry cannot get here today (the row is locked at the
      // version checked); this keeps a future change from leaving one.
      if (dealId) throw new Error("convert: enquiry not updated after deal");
      return r;
    }
    await raiseEvent(
      "EnquiryConverted",
      id,
      { enquiryId: id, dealId: dealId! },
      viewer.id,
    );
    return { kind: "ok", enquiry: r.enquiry, dealId: dealId! };
  });
}
