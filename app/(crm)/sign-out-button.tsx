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
    <button onClick={handleSignOut} className="text-sm underline">
      Sign out
    </button>
  );
}
