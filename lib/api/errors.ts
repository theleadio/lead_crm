import type { ZodError } from "zod";

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
