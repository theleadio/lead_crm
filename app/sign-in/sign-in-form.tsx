"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/auth/browser";

export function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setSaving(false);
    if (error) {
      setError("Wrong email or password. Try again.");
      return;
    }
    router.push(searchParams.get("next") ?? "/people");
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label
          htmlFor="email"
          className="text-ink mb-1 block text-sm font-medium"
        >
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="border-line-strong bg-surface-raised text-ink focus-visible:outline-focus-ring w-full rounded-sm border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
        />
      </div>
      <div>
        <label
          htmlFor="password"
          className="text-ink mb-1 block text-sm font-medium"
        >
          Password
        </label>
        <input
          id="password"
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="border-line-strong bg-surface-raised text-ink focus-visible:outline-focus-ring w-full rounded-sm border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
        />
      </div>
      {error && <p className="text-danger text-sm">{error}</p>}
      <button
        type="submit"
        disabled={saving}
        className="bg-lead-yellow text-on-yellow focus-visible:outline-focus-ring w-full cursor-pointer rounded-sm py-2 text-sm font-medium hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-default disabled:opacity-50"
      >
        {saving ? "Signing in…" : "Sign in"}
      </button>
      {/* Google SSO button goes here once O1 (spec §15.3) picks Google
          Workspace and the provider is enabled in Supabase Auth. */}
    </form>
  );
}
