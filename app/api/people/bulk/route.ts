import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { permissionFor } from "@/lib/auth/permissions";
import { apiError, validationError } from "@/lib/api/errors";
import { bulkUpdatePeople, InvalidBulkChange } from "@/lib/people/service";
import { bulkPeopleSchema } from "@/lib/validation/people-query";

// POST /api/people/bulk — spec §9.1 bulk assign owner / bulk add tag.
// Not in the §7 endpoint table yet: raised as an open item in §15.3.
export async function POST(request: NextRequest) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!permissionFor(viewer, "person", "write").allowed)
    return apiError(403, "forbidden", "You don't have access to edit people.");

  const body = await request.json().catch(() => null);
  const parsed = bulkPeopleSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  try {
    return Response.json(
      await bulkUpdatePeople(parsed.data.ids, parsed.data.change, viewer),
    );
  } catch (err) {
    if (err instanceof InvalidBulkChange)
      return apiError(422, "invalid_change", err.message);
    throw err;
  }
}
