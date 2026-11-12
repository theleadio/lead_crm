import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, forbidden, validationError } from "@/lib/api/errors";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  canLinkCampaigns,
  linkCampaign,
  unlinkCampaign,
} from "@/lib/classes/campaigns";

// POST /api/classes/:id/campaigns — link a Meta campaign to this class.
// DELETE /api/classes/:id/campaigns — unlink it. Body `{campaignId}`, Meta's
// numeric id. super_admin, operations, marketing and management (12 Nov
// 2026); the service checks again and audits both.
const bodySchema = z.object({
  campaignId: z.string().regex(/^\d+$/, "Pick a campaign from the list."),
});

async function handle(
  request: NextRequest,
  ctx: RouteContext<"/api/classes/[id]/campaigns">,
  action: "link" | "unlink",
) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!canLinkCampaigns(viewer))
    return forbidden(viewer, request, {
      what: "linking campaigns to a class",
      resource: "class",
    });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);
  const { id } = await ctx.params;

  if (action === "unlink") {
    await unlinkCampaign(viewer, id, parsed.data.campaignId);
    return Response.json({ ok: true });
  }

  const result = await linkCampaign(viewer, id, parsed.data.campaignId);
  if (result.ok) return Response.json({ ok: true });
  if (result.reason === "linked_elsewhere")
    return apiError(
      409,
      "linked_elsewhere",
      `This campaign already sells ${result.classCode}. Unlink it there first.`,
    );
  if (result.reason === "not_found")
    return apiError(404, "not_found", "This class no longer exists.");
  return apiError(
    422,
    "unknown_campaign",
    "That campaign isn't in the Meta data yet. Try again tomorrow.",
  );
}

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/classes/[id]/campaigns">,
) {
  return handle(request, ctx, "link");
}

export async function DELETE(
  request: NextRequest,
  ctx: RouteContext<"/api/classes/[id]/campaigns">,
) {
  return handle(request, ctx, "unlink");
}
