import type { NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  readCookie,
  verifySession,
} from "./lib/auth/session.ts";

const CRM_ROUTES = [
  "/people",
  "/companies",
  "/deals",
  "/classes",
  "/enrolments",
  "/enquiries",
  "/settings",
  "/dashboard",
  "/courses",
  "/tasks",
  "/inbox",
  "/reports",
];

// Gates the CRM screens on a validly signed, unexpired session cookie
// (lib/auth/session.ts). No database call here: a deactivated user with a
// live cookie passes, and the CRM layout's getCurrentUser() turns them away.
// Permission checks (role, record ownership) are per-route in the API layer
// (spec Section 6), and every API route authenticates itself. Returning
// nothing lets the request through.
export async function proxy(request: NextRequest) {
  const { pathname } = new URL(request.url);
  const isCrmRoute =
    pathname.startsWith("/(crm)") ||
    CRM_ROUTES.some((path) => pathname.startsWith(path));
  if (!isCrmRoute) return;
  const token = readCookie(request, SESSION_COOKIE);
  // A host that runs the proxy without the server's env (an edge runtime)
  // can't see SESSION_SECRET; then any cookie passes here instead of locking
  // everyone out. The layout and every API route verify it fully anyway.
  if (token && (!process.env.SESSION_SECRET || (await verifySession(token))))
    return;

  const signInUrl = new URL("/sign-in", request.url);
  signInUrl.searchParams.set("next", pathname);
  return Response.redirect(signInUrl);
}

// The public website (§10) and the public API (§8) need no session, so they
// skip this proxy entirely: a marketing page should not cost a session check. Each new public
// page adds itself here — /register landed with 10.4, /help with migration
// 019, the landing pages are still to come — and so does each locale of it:
// the whole /zh tree is public by construction, and a path under it that we
// do not serve is a 404 either way (§10.5). Hiding a path from the proxy is not a security decision: the CRM
// screens keep their own check in app/(crm)/layout.tsx and every API route
// authenticates itself. The enquiry form authenticates its own submission
// with the public API key, server-side (§8.2).
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/public|schedule(?:/|$)|enquiry(?:/|$)|help(?:/|$)|register(?:/|$)|zh(?:/|$)).*)",
  ],
};
