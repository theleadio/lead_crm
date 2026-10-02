import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Refreshes the Supabase session cookie on every request and gates the
// authenticated CRM routes. Permission checks (role, record ownership) are
// per-route in the API layer (spec Section 6) — this only checks "signed in".
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // API routes authenticate themselves (every handler calls getCurrentUser),
  // so this only has to keep the session cookie fresh for them. getSession()
  // reads the cookie locally and refreshes only when the token has expired —
  // getUser() is a round trip to Supabase on every single list fetch.
  if (request.nextUrl.pathname.startsWith("/api")) {
    await supabase.auth.getSession();
    return response;
  }

  const { data } = await supabase.auth.getUser();
  const isCrmRoute =
    request.nextUrl.pathname.startsWith("/(crm)") ||
    [
      "/people",
      "/companies",
      "/deals",
      "/classes",
      "/enrolments",
      "/enquiries",
      "/settings",
      "/dashboard",
    ].some((path) => request.nextUrl.pathname.startsWith(path));

  if (isCrmRoute && !data.user) {
    const signInUrl = new URL("/sign-in", request.url);
    signInUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(signInUrl);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/public).*)"],
};
