import type { NextRequest } from "next/server";
import { apiError, forbidden, validationError } from "@/lib/api/errors";
import { getCurrentUser } from "@/lib/auth/current-user";
import { addEnquiryNote } from "@/lib/enquiries/service";
import { enquiryNoteSchema } from "@/lib/validation/enquiry";

// POST /api/enquiries/:id/notes — an internal note in the enquiry's history
// (migration 019). Never sent to the customer. No If-Match: a note changes
// nothing anyone could be editing.
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/enquiries/[id]/notes">,
) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  const parsed = enquiryNoteSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return validationError(parsed.error);
  const { id } = await ctx.params;
  const result = await addEnquiryNote(id, parsed.data.note, viewer);
  switch (result.kind) {
    case "ok":
      return new Response(null, { status: 204 });
    case "forbidden":
      return forbidden(viewer, request, {
        what: "add notes to enquiries",
        resource: "enquiry",
      });
    case "not_found":
      return apiError(
        404,
        "not_found",
        "This enquiry doesn't exist, or isn't one you can work on.",
      );
  }
}
