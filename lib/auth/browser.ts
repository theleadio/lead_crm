import { createBrowserClient } from "@supabase/ssr";

// Client Components only (e.g. the sign-in form).
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
