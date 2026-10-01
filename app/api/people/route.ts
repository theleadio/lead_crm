import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAddPersonStandalone, permissionFor } from "@/lib/auth/permissions";
import { apiError, forbidden, validationError } from "@/lib/api/errors";
import { createPerson, listPeople } from "@/lib/people/service";
import { personSchema } from "@/lib/validation/person";
import {
  peopleListQuerySchema,
  readPeopleParams,
} from "@/lib/validation/people-query";

// GET /api/people — spec §7 search + list.
export async function GET(request: NextRequest) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!permissionFor(viewer, "person", "read").allowed)
    return forbidden(viewer, request, { what: "people", resource: "person" });

  const parsed = peopleListQuerySchema.safeParse(
    readPeopleParams(request.nextUrl.searchParams),
  );
  if (!parsed.success)
    return apiError(400, "validation_failed", "Invalid list filters.");

  return Response.json(await listPeople(parsed.data, viewer));
}

// POST /api/people — spec §7 create; runs dedupe (§12.2), 409 on hard match.
export async function POST(request: NextRequest) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!canAddPersonStandalone(viewer))
    return forbidden(viewer, request, {
      what: "add people",
      resource: "person",
    });

  const body = await request.json().catch(() => null);
  const parsed = personSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  const result = await createPerson(parsed.data, viewer);
  if (result.kind === "duplicate") {
    const what = result.on === "phone" ? "phone number" : "email";
    const name = result.existing.fullName || "another person";
    return apiError(
      409,
      "duplicate",
      `This ${what} already belongs to ${name}. Open their record, or merge them.`,
      {
        fields: { [result.on]: `Already belongs to ${name}` },
        existing: result.existing,
      },
    );
  }
  return Response.json(result.person, { status: 201 });
}
