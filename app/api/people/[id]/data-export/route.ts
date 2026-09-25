import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { apiError, forbidden } from "@/lib/api/errors";
import { toCsv } from "@/lib/format/csv";
import {
  exportPersonData,
  personDataToRows,
} from "@/lib/people/detail-service";

// GET /api/people/:id/data-export?format=json|csv — spec §7.1 / §14 PDPA
// portability. super_admin only, on the person's request; audit-logged.
export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/people/[id]/data-export">,
) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");

  const format = request.nextUrl.searchParams.get("format") ?? "json";
  if (format !== "json" && format !== "csv")
    return apiError(400, "validation_failed", "format must be json or csv.");

  const { id } = await ctx.params;
  const result = await exportPersonData(id, viewer, format);
  if (result.kind === "not_found")
    return apiError(
      404,
      "not_found",
      "This person doesn't exist or was removed.",
    );
  if (result.kind === "forbidden")
    return forbidden(viewer, request, {
      what: "export personal data",
      resource: "person",
    });

  const filename = `person-${id}-data.${format}`;
  const body =
    format === "json"
      ? JSON.stringify(result.data, null, 2)
      : toCsv(
          ["Section", "Record", "Field", "Value"],
          personDataToRows(result.data),
        );

  return new Response(body, {
    headers: {
      "Content-Type":
        format === "json" ? "application/json" : "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
