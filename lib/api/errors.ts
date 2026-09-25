import type { ZodError } from "zod";
import { clientIp, writeAudit } from "../audit.ts";
import type { Viewer } from "../auth/permissions.ts";

// Spec §7: every error returns the same shape so the client has one renderer.
export function apiError(
  status: number,
  code: string,
  message: string,
  details?: {
    fields?: Record<string, string>;
    existing?: { id: string; fullName: string };
  },
) {
  return Response.json({ error: { code, message, ...details } }, { status });
}

// Field-level messages for forms (spec §9 cross-screen: field-level errors).
export function validationError(err: ZodError) {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".");
    if (key && !fields[key]) fields[key] = issue.message;
  }
  return apiError(400, "validation_failed", "Check the highlighted fields.", {
    fields,
  });
}

// Spec §6 + §13: every 403 is audited and says what was denied and who can
// grant access. A failed audit insert must never turn a denial into a 500.
export async function forbidden(
  viewer: Viewer,
  request: Request,
  { what, resource }: { what: string; resource: string },
) {
  try {
    await writeAudit({
      userId: viewer.id,
      action: "permission_denied",
      entity: resource,
      entityId: null,
      before: null,
      after: { route: new URL(request.url).pathname, method: request.method },
      ip: clientIp(request.headers.get("x-forwarded-for")),
    });
  } catch (err) {
    console.error("permission_denied audit failed", err);
  }
  return apiError(
    403,
    "forbidden",
    `You don't have access to ${what}. Ask a super admin if you need it.`,
  );
}
