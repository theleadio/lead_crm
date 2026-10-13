import type { NextRequest } from "next/server";
import { setClassVisibility } from "@/lib/classes/service";
import { classWriteResponse } from "@/lib/classes/write-response";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteClass } from "@/lib/auth/permissions";
import {
  apiError,
  forbidden,
  readIfMatch,
  validationError,
} from "@/lib/api/errors";
import { classVisibilitySchema } from "@/lib/validation/class";

// POST /api/classes/:id/website — §9.10 Show on website / Hide from website
// (§12.1, v1.9). Writes `is_public` only: hiding stops public registration
// (§8.3) and drops the class from the §8.1 feed, while staff keep enrolling
// people. Refused unless the class is open for booking. Body `{isPublic}`.
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/classes/[id]/website">,
) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!canWriteClass(viewer))
    return forbidden(viewer, request, {
      what: "change what the website shows",
      resource: "class",
    });

  const ifMatch = readIfMatch(request);
  if (ifMatch === null)
    return apiError(
      428,
      "precondition_required",
      "Reload this class and try again.",
    );

  const parsed = classVisibilitySchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return validationError(parsed.error);

  const { id } = await ctx.params;
  const result = await setClassVisibility(
    id,
    parsed.data.isPublic,
    ifMatch,
    viewer,
  );
  return classWriteResponse(
    result,
    viewer,
    request,
    "change what the website shows",
  );
}
