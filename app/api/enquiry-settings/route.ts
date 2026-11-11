import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, forbidden, validationError } from "@/lib/api/errors";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  addHolidays,
  addRule,
  addTeamMember,
  canEditEnquirySettings,
  deleteHoliday,
  deleteRule,
  removeTeamMember,
  saveCategory,
  SettingsError,
} from "@/lib/enquiries/settings";

// POST /api/enquiry-settings — teams, categories, routing rules and holidays
// (migration 019). super_admin and management only; the service checks again
// and audits every change.

const s = (max: number) => z.string().trim().max(max);

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("addMember"),
    teamId: s(36),
    email: s(254).min(3),
  }),
  z.object({
    action: z.literal("removeMember"),
    teamId: s(36),
    userId: s(36),
  }),
  z.object({
    action: z.literal("saveCategory"),
    code: s(31),
    labelEn: s(100),
    labelZh: s(100).nullable(),
    teamId: s(36),
    keywords: z.array(s(50)).max(30),
    active: z.boolean(),
    position: z.number().int(),
  }),
  z.object({
    action: z.literal("addRule"),
    position: z.number().int(),
    matchChannel: s(30).nullable(),
    matchCategory: s(31).nullable(),
    setTeamId: s(36).nullable(),
    assignMode: z.enum(["round_robin", "fixed", "none"]),
    assignEmail: s(254).nullable(),
  }),
  z.object({ action: z.literal("deleteRule"), ruleId: s(36) }),
  z.object({ action: z.literal("addHolidays"), text: s(10000) }),
  z.object({ action: z.literal("deleteHoliday"), day: s(10) }),
]);

export async function POST(request: NextRequest) {
  const viewer = await getCurrentUser();
  if (!viewer) return apiError(401, "unauthenticated", "Sign in to continue.");
  if (!canEditEnquirySettings(viewer.role))
    return forbidden(viewer, request, {
      what: "enquiry settings",
      resource: "settings",
    });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);
  const b = parsed.data;
  try {
    switch (b.action) {
      case "addMember":
        await addTeamMember(viewer, b.teamId, b.email);
        break;
      case "removeMember":
        await removeTeamMember(viewer, b.teamId, b.userId);
        break;
      case "saveCategory":
        await saveCategory(viewer, {
          code: b.code,
          labelEn: b.labelEn,
          labelZh: b.labelZh,
          teamId: b.teamId,
          keywords: b.keywords,
          active: b.active,
          position: b.position,
        });
        break;
      case "addRule":
        await addRule(viewer, {
          position: b.position,
          matchChannel: b.matchChannel,
          matchCategory: b.matchCategory,
          setTeamId: b.setTeamId,
          assignMode: b.assignMode,
          assignEmail: b.assignEmail,
        });
        break;
      case "deleteRule":
        await deleteRule(viewer, b.ruleId);
        break;
      case "addHolidays": {
        const r = await addHolidays(viewer, b.text);
        if (r.bad.length)
          return apiError(
            422,
            "invalid",
            `These lines aren't "YYYY-MM-DD Name": ${r.bad.slice(0, 5).join("; ")}`,
          );
        return Response.json({ added: r.added });
      }
      case "deleteHoliday":
        await deleteHoliday(viewer, b.day);
        break;
    }
  } catch (e) {
    if (e instanceof SettingsError)
      return e.code === "forbidden"
        ? forbidden(viewer, request, {
            what: "enquiry settings",
            resource: "settings",
          })
        : apiError(422, "invalid", e.message);
    throw e;
  }
  return new Response(null, { status: 204 });
}
