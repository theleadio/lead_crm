import type { NextRequest } from "next/server";
import { editNotice } from "@/lib/classes/notices";
import { noticeWriteResponse } from "@/lib/classes/notice-response";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteClass } from "@/lib/auth/permissions";
import { apiError, forbidden, validationError } from "@/lib/api/errors";
import { classNoticeEditSchema } from "@/lib/validation/class-notice";

// PATCH /api/class-notices/:id — §7.1, §9.10. Corrects the wording of a
// pending notice. What the notice is about (`changedFields`) and who it is
// for (`recipientCount`) are not editable, so they are not in the schema.
// No If-Match: a notice has no `version` column (§5), and the conditional
// `status = 'pending'` update is what makes two editors safe.
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/class-notices/[id]">,
) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!canWriteClass(viewer))
    return forbidden(viewer, request, {
      what: "edit class notices",
      resource: "class_notice",
    });

  const parsed = classNoticeEditSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return validationError(parsed.error);

  const { id } = await ctx.params;
  const result = await editNotice(id, parsed.data, viewer);
  return noticeWriteResponse(result, viewer, request, "edit class notices");
}
