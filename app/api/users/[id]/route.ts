import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { permissionFor } from "@/lib/auth/permissions";
import {
  apiError,
  forbidden,
  readIfMatch,
  validationError,
} from "@/lib/api/errors";
import { userWriteResponse } from "@/lib/users/responses";
import { updateUser } from "@/lib/users/service";
import { userUpdateSchema } from "@/lib/validation/user";

// PATCH /api/users/:id — §7, §9.15 Users: role, employment type, deactivate
// and reactivate. super_admin only; If-Match contract (record-concurrency).
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/users/[id]">,
) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!permissionFor(viewer, "settings", "write").allowed)
    return forbidden(viewer, request, {
      what: "change users",
      resource: "app_user",
    });

  const ifMatch = readIfMatch(request);
  if (ifMatch === null)
    return apiError(
      428,
      "precondition_required",
      "Reload this user and try again.",
    );

  const parsed = userUpdateSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return validationError(parsed.error, 422);

  const { id } = await ctx.params;
  return userWriteResponse(
    await updateUser(id, parsed.data, ifMatch, viewer),
  );
}
