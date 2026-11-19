import { apiError } from "@/lib/api/errors";
import {
  checkSyncKey,
  MAX_ROWS,
  syncBodySchema,
  syncParticipants,
} from "@/lib/sync/participants";

// POST /api/sync/participants — the LEAD Participant List sheet pushes its
// rows here (migration 026, scripts/apps-script/participant-push.gs). Server
// to server: no session, no CORS, no browser. It is closed unless
// PARTICIPANT_SYNC_KEY is set, and that key is never the public API key.
// The answer is counts only; nothing about a person is logged or returned.
const MAX_BYTES = 1_000_000;

export async function POST(request: Request) {
  const key = checkSyncKey(process.env, request.headers.get("x-api-key"));
  if (key === "unconfigured")
    return apiError(
      503,
      "sync_not_configured",
      "The participant sync is not set up.",
    );
  if (key === "bad")
    return apiError(401, "unauthorised", "That key isn't valid.");

  const text = await request.text();
  if (text.length > MAX_BYTES)
    return apiError(
      413,
      "too_large",
      `Send at most ${MAX_ROWS} rows at a time.`,
    );
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return apiError(400, "bad_json", "The body isn't valid JSON.");
  }
  const body = syncBodySchema.safeParse(json);
  if (!body.success)
    return apiError(
      422,
      "validation_failed",
      `Send { mode, dryRun, rows } with at most ${MAX_ROWS} rows.`,
    );

  try {
    return Response.json(await syncParticipants(body.data));
  } catch (err) {
    // The message can carry a row's text through the database driver; log
    // only that it failed.
    console.error(
      "[participants sync] failed",
      (err as { code?: string }).code,
    );
    return apiError(500, "sync_failed", "The sync failed. Try again.");
  }
}
