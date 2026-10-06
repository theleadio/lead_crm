import type { NextRequest } from "next/server";
import { clientIp, writeAudit } from "@/lib/audit";
import { listRoster } from "@/lib/classes/roster";
import { getClass } from "@/lib/classes/service";
import { enumLabel } from "@/lib/classes/types";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canExportClassLists } from "@/lib/auth/permissions";
import { apiError, forbidden } from "@/lib/api/errors";
import { toCsv } from "@/lib/format/csv";
import { formatDate, formatDateTime } from "@/lib/format/date";

// GET /api/classes/:id/roster/export — §9.10 Export CSV, §6 export row
// (super_admin full, operations "class lists"), audit-logged like the §9.1
// people export. No phone and no email: the roster says who is coming, not
// how to reach them.
export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/classes/[id]/roster/export">,
) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!canExportClassLists(viewer))
    return forbidden(viewer, request, {
      what: "export class rosters",
      resource: "enrolment",
    });

  const { id } = await ctx.params;
  const cls = await getClass(id, viewer);
  if (!cls) return apiError(404, "not_found", "This class doesn't exist.");
  const rows = await listRoster(id, viewer);

  const csv = toCsv(
    [
      "Name",
      "Status",
      "Holds a seat",
      "Payer",
      "Booked by",
      "Price paid (MYR)",
      "Reserved until",
      "Enrolled",
    ],
    rows.map((r) => [
      r.personName,
      enumLabel(r.status),
      r.holdsSeat ? "Yes" : "No",
      enumLabel(r.payerType),
      r.bookerName,
      r.pricePaidMyr,
      r.seatReservedUntil ? formatDateTime(r.seatReservedUntil) : null,
      formatDate(r.createdAt),
    ]),
  );

  await writeAudit({
    userId: viewer.id,
    action: "export",
    entity: "enrolment",
    entityId: id,
    before: null,
    after: { classCode: cls.code, rows: rows.length },
    ip: clientIp(request.headers.get("x-forwarded-for")),
  });

  // The class code, not a person's name, so nothing identifying lands in a
  // download history (PDPA).
  const name = cls.code.replace(/[^A-Za-z0-9._-]+/g, "-");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="roster-${name}.csv"`,
    },
  });
}
