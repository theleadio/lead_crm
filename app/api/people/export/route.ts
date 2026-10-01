import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canExportPeople } from "@/lib/auth/permissions";
import { apiError, forbidden } from "@/lib/api/errors";
import { toCsv } from "@/lib/format/csv";
import { formatDate } from "@/lib/format/date";
import { exportPeople } from "@/lib/people/service";
import {
  peopleFiltersSchema,
  readPeopleParams,
} from "@/lib/validation/people-query";

const LANGUAGE = { en: "English", zh: "Chinese" } as const;

// GET /api/people/export — spec §9.1 Export CSV, permitted roles only (§6),
// audit-logged (§4). Spec §7.1.
export async function GET(request: NextRequest) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!canExportPeople(viewer.role))
    return forbidden(viewer, request, {
      what: "export people",
      resource: "person",
    });

  const parsed = peopleFiltersSchema.safeParse(
    readPeopleParams(request.nextUrl.searchParams),
  );
  if (!parsed.success)
    return apiError(400, "validation_failed", "Invalid export filters.");

  const rows = await exportPeople(parsed.data, viewer);
  const csv = toCsv(
    [
      "Name",
      "Phone",
      "Email",
      "Language",
      "Stage",
      "Owner",
      "Last activity",
      "Tags",
      "Created",
    ],
    rows.map((p) => [
      p.fullName,
      p.phone,
      p.email,
      LANGUAGE[p.preferredLanguage],
      p.stage,
      p.owner?.fullName ?? null,
      p.lastActivityAt ? formatDate(p.lastActivityAt) : null,
      p.tags.join("; "),
      formatDate(p.createdAt),
    ]),
  );

  const today = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="people-${today}.csv"`,
    },
  });
}
