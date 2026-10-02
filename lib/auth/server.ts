import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

// Server Components / Route Handlers: reads the session from cookies.
// Never touches the DB directly — screens/services do that via /lib/db.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component render — middleware refreshes
            // the session instead, so this is safe to ignore.
          }
        },
      },
    },
  );
}

// cache(): every auth check is a network round trip to Supabase (~150ms), and
// a single navigation asks for the session several times — layout, page, and
// anything they call. React dedupes those to one call per request.
export const getSession = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
});
