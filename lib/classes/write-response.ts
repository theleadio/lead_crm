import { apiError, forbidden } from "../api/errors.ts";
import type { Viewer } from "../auth/permissions.ts";
import type { ClassWriteResult } from "./service.ts";

// One place that turns a class write result into its §7 status code, shared
// by POST, PATCH, the two §9.10 controls and cancel, so they cannot drift.
// The §13 rule holds throughout: every message says what happened and what
// to do next.

const FIELD_LABELS: Record<string, string> = {
  venueName: "Venue name is required for a class that meets somewhere",
  venueAddress: "Venue address is required",
  city: "City is required",
  onlineUrl: "A joining link is required for a class that meets online",
  endDate: "The end date is before the start date",
  status: "A cancelled or completed class can't be opened or redrafted",
};

export async function classWriteResponse(
  result: ClassWriteResult,
  viewer: Viewer,
  request: Request,
  what: string,
  okStatus = 200,
): Promise<Response> {
  switch (result.kind) {
    case "ok":
      return Response.json(
        { id: result.id, version: result.version },
        { status: okStatus },
      );
    // §9.10: the count is what the toast names, so it comes back with the
    // version rather than being counted again by the screen.
    case "cancelled":
      return Response.json(
        {
          id: result.id,
          version: result.version,
          enrolmentCount: result.enrolmentCount,
        },
        { status: okStatus },
      );
    case "already_cancelled":
      return apiError(
        409,
        "already_cancelled",
        "This class is already cancelled. Its students have been told once; nothing more was sent.",
      );
    case "forbidden":
      return forbidden(viewer, request, { what, resource: "class" });
    case "not_found":
      return apiError(404, "not_found", "This class doesn't exist.");
    case "stale":
      return apiError(
        409,
        "stale_edit",
        "Someone else changed this class while you were editing. Reload to see their version.",
      );
    case "duplicate":
      return apiError(
        409,
        "duplicate_code",
        `Class code ${result.code} already belongs to another class. Edit that one instead.`,
        { fields: { code: "Already used by another class" } },
      );
    case "capacity_below_seats":
      return apiError(
        422,
        "capacity_below_enrolments",
        `This class already has ${result.taken} ${result.taken === 1 ? "seat" : "seats"} taken. Set the capacity to ${result.taken} or more, or move someone to another class first.`,
        { fields: { capacity: `At least ${result.taken}` } },
      );
    // §12.1 (v1.9): a class people have booked does not go back to draft —
    // Cancel class is the move that tells the students.
    case "class_has_seats":
      return apiError(
        422,
        "class_has_seats",
        `This class has ${result.taken} ${result.taken === 1 ? "seat" : "seats"} taken, so it can't go back to draft. Cancel the class, or move those students to another class first.`,
      );
    case "class_not_open":
      return apiError(
        422,
        "class_not_open",
        "Open this class for booking before changing whether the website shows it.",
      );
    case "notice_required":
      // §7.1: not an error the user has to fix — the 9.9 dialog answers it
      // and sends the same body again with the choice.
      return apiError(
        409,
        "notice_decision_required",
        `${result.recipientCount} ${result.recipientCount === 1 ? "student is" : "students are"} enrolled. They will not be told until you approve a notice.`,
        { recipientCount: result.recipientCount },
      );
    case "incomplete":
      return apiError(
        422,
        "class_incomplete",
        `This class can't be saved yet: ${result.missing.map((f) => FIELD_LABELS[f] ?? f).join("; ")}.`,
        {
          fields: Object.fromEntries(
            result.missing.map((f) => [f, FIELD_LABELS[f] ?? "Required"]),
          ),
        },
      );
  }
}
