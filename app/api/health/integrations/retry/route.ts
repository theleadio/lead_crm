import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, forbidden, validationError } from "@/lib/api/errors";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  canRetryIntegrations,
  retryIntegration,
} from "@/lib/health/integrations";

// POST /api/health/integrations/retry — spec §11.4's Retry button. Revives
// dead outbox rows so the next drain runs them again: every dead row of the
// integration, or only `ids`. Stripe redelivers on its own and the daily
// syncs re-run from GitHub Actions, so only outbox integrations retry here.
const body = z.object({
  integration: z.enum(["outbox", "lms_notices"]),
  ids: z.array(z.uuid()).min(1).max(500).optional(),
});

export async function POST(request: NextRequest) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!canRetryIntegrations(viewer))
    return forbidden(viewer, request, {
      what: "retry integrations",
      resource: "settings",
    });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);
  const revived = await retryIntegration(parsed.data);
  return Response.json({ data: { revived } });
}
