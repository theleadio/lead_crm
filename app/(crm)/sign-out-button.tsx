"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/auth/browser";

export function SignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/sign-in");
  }

  return (
    <button
      onClick={handleSignOut}
      className="cursor-pointer text-sm text-[var(--ink-muted)] underline hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
    >
      Sign out
    </button>
  );
}
