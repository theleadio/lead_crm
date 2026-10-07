import { apiError, forbidden } from "../api/errors.ts";
import type { Viewer } from "../auth/permissions.ts";
import { enumLabel } from "../classes/types.ts";
import type { EnrolmentWriteResult } from "./service.ts";

// One place that turns an enrolment write result into its §7 status code,
// shared by create, status change and transfer, so they cannot drift. The §13
// rule holds throughout: every message says what happened and what to do next.
export async function enrolmentWriteResponse(
  result: EnrolmentWriteResult,
  viewer: Viewer,
  request: Request,
  what: string,
): Promise<Response> {
  switch (result.kind) {
    case "ok":
      return Response.json({ id: result.id, version: result.version });
    case "created":
      return Response.json(
        { id: result.id, version: result.version },
        { status: 201 },
      );
    case "transferred":
      return Response.json({
        id: result.id,
        version: result.version,
        newEnrolmentId: result.newEnrolmentId,
        toClassCode: result.toClassCode,
      });
    case "forbidden":
      return forbidden(viewer, request, { what, resource: "enrolment" });
    case "not_found":
      return apiError(404, "not_found", "This enrolment doesn't exist.");
    case "stale":
      return apiError(
        409,
        "stale_edit",
        "Someone else changed this enrolment while you were reading it. Reload to see their version.",
      );
    // §12.4: the move is not on the diagram. The message names where this
    // enrolment may go instead, so nobody has to guess the next step.
    case "illegal_transition":
      return apiError(
        422,
        "illegal_transition",
        result.allowed.length
          ? `An enrolment that is ${enumLabel(result.from).toLowerCase()} can't become ${enumLabel(result.to).toLowerCase()}. It can become: ${result.allowed.map((s) => enumLabel(s).toLowerCase()).join(", ")}.`
          : `An enrolment that is ${enumLabel(result.from).toLowerCase()} can't change status.`,
      );
    // §12.1: the database refuses to oversell, so this is where that lands.
    case "no_seats":
      return apiError(
        409,
        "no_seats",
        `${result.classCode} has no seats left. Free a seat in it, or choose another class.`,
      );
    // §5: one live enrolment per person per class.
    case "duplicate":
      return apiError(
        409,
        "already_enrolled",
        `This person already has an enrolment in ${result.classCode}. Open that enrolment instead.`,
        result.enrolmentId
          ? { existing: { id: result.enrolmentId, fullName: result.classCode } }
          : undefined,
      );
    case "not_transferable":
      return apiError(
        422,
        "not_transferable",
        `Only a confirmed enrolment can be transferred. This one is ${enumLabel(result.status).toLowerCase()}.`,
      );
    case "same_class":
      return apiError(
        422,
        "same_class",
        "This enrolment is already in that class. Pick a different one.",
      );
  }
}
