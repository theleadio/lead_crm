import type { NextRequest } from "next/server";
import { apiError, validationError } from "@/lib/api/errors";
import { originAllowed, requestIp, withCors } from "@/lib/public/guard";
import {
  helpFormSchema,
  isHelpFormConfigured,
  submitHelpForm,
} from "@/lib/public/help";

// POST /api/public/help: the help form for the LEAD website (moved from
// lead_sales with migration 019). Open to anyone (decided 4 Nov), so it is
// guarded by an origin allow-list, rate limits and, once one is chosen, a
// CAPTCHA (lib/public/help.ts). No API key: it creates no lead and no deal.
//
// 201 { reference } on success (200 for a repeat of the same key);
// 400 bad body or CAPTCHA; 403 origin; 404 unknown category; 429 too many;
// 503 not configured. Logs never carry the body.

const env = () => process.env as Record<string, string | undefined>;

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!originAllowed(env(), origin))
    return apiError(403, "origin_not_allowed", "Origin not allowed.");
  return withCors(env(), origin, new Response(null, { status: 204 }), {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
  });
}

export async function POST(request: NextRequest) {
  const e = env();
  const origin = request.headers.get("origin");
  const reply = (res: Response) => withCors(e, origin, res);
  if (!originAllowed(e, origin))
    return apiError(403, "origin_not_allowed", "Origin not allowed.");
  if (!isHelpFormConfigured(e))
    return reply(
      apiError(503, "not_configured", "The help form is not configured."),
    );

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return reply(apiError(400, "bad_body", "Send JSON."));
  }
  const parsed = helpFormSchema.safeParse(body);
  if (!parsed.success) return reply(validationError(parsed.error));

  try {
    const r = await submitHelpForm(parsed.data, {
      ip: requestIp(request.headers),
      env: e,
    });
    switch (r.kind) {
      case "created":
        return reply(
          Response.json(
            { reference: r.reference },
            { status: r.replayed ? 200 : 201 },
          ),
        );
      case "rate_limited":
        return reply(
          apiError(429, "rate_limited", "Too many requests. Try again later."),
        );
      case "captcha_failed":
        return reply(apiError(400, "captcha_failed", "Please try again."));
      case "unknown_category":
        return reply(apiError(404, "unknown_category", "Unknown category."));
    }
  } catch (err) {
    console.error(
      "help form failed:",
      err instanceof Error ? err.message : String(err),
    );
    return reply(apiError(500, "server_error", "Something went wrong."));
  }
}
