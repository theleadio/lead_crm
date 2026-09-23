// Spec §7: every error returns the same shape so the client has one renderer.
export function apiError(
  status: number,
  code: string,
  message: string,
  fields?: Record<string, string>,
) {
  return Response.json({ error: { code, message, fields } }, { status });
}
