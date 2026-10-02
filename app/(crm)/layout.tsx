import { redirect } from "next/navigation";
import { Search } from "lucide-react";
import { FlashToast } from "@/components/flash-toast";
import { getCurrentUser } from "@/lib/auth/current-user";
import { navFor } from "@/lib/auth/nav";
import { getSession } from "@/lib/auth/server";
import { NavLinks } from "./nav-links";
import { SignOutButton } from "./sign-out-button";

// Shell per spec Section 9: role-filtered sidebar (lib/auth/nav.ts) + top bar
// (global people search, signed-in user, sign out). Styled after design.pen
// "Navigation": a floating ink sidebar card and a pill top bar on the canvas.
export default async function CrmLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) {
    // Signed in to Supabase but no active staff account: a redirect to
    // /sign-in would loop, because the proxy sees a valid session.
    if (!(await getSession())) redirect("/sign-in");
    return (
      <main className="bg-surface text-ink flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-lg font-semibold">
          Your login isn&apos;t linked to a staff account
        </h1>
        <p className="text-ink-muted text-sm">
          Ask a super admin to link or reactivate your account.
        </p>
        <SignOutButton />
      </main>
    );
  }

  return (
    <div className="bg-surface flex min-h-screen gap-4 p-4">
      <aside className="bg-charcoal border-line sticky top-4 h-[calc(100vh-2rem)] w-56 shrink-0 overflow-y-auto rounded-lg border px-3.5 py-5">
        <div className="mb-4 flex items-center gap-2.5 px-1.5 pb-2">
          <span
            aria-hidden="true"
            className="bg-charcoal-raised flex size-[30px] items-center justify-center gap-0.5 rounded-full"
          >
            <span className="bg-lead-yellow h-3.5 w-1 rounded-[1px]" />
            <span className="flex flex-col gap-0.5">
              <span className="h-[2.5px] w-[9px] rounded-[1px] bg-[#8FA6F5]" />
              <span className="h-[2.5px] w-[7px] rounded-[1px] bg-[#8FA6F5]" />
              <span className="h-[2.5px] w-[9px] rounded-[1px] bg-[#8FA6F5]" />
            </span>
          </span>
          <span className="text-base font-bold tracking-wider text-white">
            LEAD
          </span>
        </div>
        <NavLinks items={navFor(user)} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <header className="border-line bg-surface-raised flex items-center justify-between gap-4 rounded-full border py-2.5 pr-2.5 pl-3.5">
          <form
            action="/people"
            method="get"
            className="relative min-w-0 flex-1"
          >
            <Search
              aria-hidden="true"
              className="text-ink-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            />
            <input
              type="search"
              name="q"
              required
              pattern=".*\S.*"
              aria-label="Search people"
              placeholder="Search people, companies…"
              className="bg-surface-sunken text-ink placeholder:text-ink-subtle focus-visible:outline-focus-ring w-full max-w-80 rounded-full py-2 pr-3 pl-9 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2"
            />
          </form>
          <div className="text-ink flex shrink-0 items-center gap-3 text-sm">
            <span>{user.email}</span>
            <SignOutButton />
            <span
              aria-hidden="true"
              className="bg-lead-blue flex size-9 items-center justify-center rounded-full text-[13px] font-bold text-white"
            >
              {(user.email ?? "?").slice(0, 2).toUpperCase()}
            </span>
          </div>
        </header>
        <main className="text-ink min-w-0 flex-1">{children}</main>
        <FlashToast />
      </div>
    </div>
  );
}
