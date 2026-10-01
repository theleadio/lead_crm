"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { signInAction } from "@/lib/auth/actions";

export function SignInForm() {
  const next = useSearchParams().get("next") ?? "";
  const [state, action, pending] = useActionState(signInAction, undefined);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
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
          name="email"
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
          name="password"
          className="border-line-strong bg-surface-raised text-ink focus-visible:outline-focus-ring w-full rounded-sm border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
        />
      </div>
      {state?.error && <p className="text-danger text-sm">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="bg-lead-yellow text-on-yellow focus-visible:outline-focus-ring w-full cursor-pointer rounded-sm py-2 text-sm font-medium hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-default disabled:opacity-50"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
      {/* Google SSO button goes here once O1 (spec §15.3) picks Google
          Workspace and the provider is enabled in Supabase Auth. */}
    </form>
  );
}
