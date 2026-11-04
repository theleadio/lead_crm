import type { NextRequest } from "next/server";
import { apiError, validationError } from "@/lib/api/errors";
import {
  captureInternalLead,
  checkInternalKey,
  internalLeadSchema,
} from "@/lib/public/internal-leads";

// POST /api/internal/leads — see lib/public/internal-leads.ts. Answers
// 201 with the person and deal, or 200 for a repeat of the same key.
export async function POST(request: NextRequest) {
  const key = checkInternalKey(
    process.env,
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null,
  );
  if (key === "unconfigured")
    return apiError(
      503,
      "not_configured",
      "Internal intake is not configured.",
    );
  if (key === "bad") return apiError(401, "unauthenticated", "Bad key.");

  const parsed = internalLeadSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return validationError(parsed.error);

  const r = await captureInternalLead(parsed.data);
  return Response.json(
    { data: { personId: r.personId, dealId: r.dealId, replayed: r.replayed } },
    { status: r.replayed ? 200 : 201 },
  );
}
