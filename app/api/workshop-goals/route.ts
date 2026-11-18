import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, forbidden, validationError } from "@/lib/api/errors";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canSetWorkshopGoal, setWorkshopGoal } from "@/lib/home/workshops";

// POST /api/workshop-goals — the sign-up goal on a Free workshops card on
// Home (Zixuan, 12 Nov 2026). super_admin, management, marketing and
// operations; the service checks again and audits every change. `version`
// is the goal's version as the card saw it, null when it had no goal.
const bodySchema = z.object({
  title: z.string().trim().min(1).max(200),
  language: z.enum(["en", "zh"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  goal: z.number().int().min(1).max(10000),
  version: z.number().int().min(1).nullable(),
});

export async function POST(request: NextRequest) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!canSetWorkshopGoal(viewer))
    return forbidden(viewer, request, {
      what: "workshop sign-up goals",
      resource: "settings",
    });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);

  const result = await setWorkshopGoal(viewer, parsed.data);
  if (!result.ok)
    return apiError(
      409,
      "conflict",
      "Someone else changed this goal. Reload the page and try again.",
    );
  return Response.json({ goal: result.goal, version: result.version });
}
