import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { permissionFor } from "@/lib/auth/permissions";
import { apiError, forbidden, validationError } from "@/lib/api/errors";
import { userWriteResponse } from "@/lib/users/responses";
import { createUser, listUsers } from "@/lib/users/service";
import { userCreateSchema } from "@/lib/validation/user";

// GET /api/users — §7, §9.15 Users: every user with status and last sign-in.
// super_admin only (§6 settings row); owner pickers use /api/users/options.
export async function GET(request: NextRequest) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!permissionFor(viewer, "settings", "read").allowed)
    return forbidden(viewer, request, { what: "users", resource: "app_user" });
  return Response.json({ data: await listUsers() });
}

// POST /api/users — §9.15 Add user: a new app_user row, the allowlist for
// AI365 sign-in. super_admin only.
export async function POST(request: NextRequest) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!permissionFor(viewer, "settings", "write").allowed)
    return forbidden(viewer, request, {
      what: "add users",
      resource: "app_user",
    });

  const parsed = userCreateSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return validationError(parsed.error, 422);

  return userWriteResponse(await createUser(parsed.data, viewer), 201);
}
