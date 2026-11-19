import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Search } from "lucide-react";
import { FlashToast } from "@/components/flash-toast";
import { getCurrentUser } from "@/lib/auth/current-user";
import { navFor } from "@/lib/auth/nav";
import { teamsOf } from "@/lib/enquiries/access";
import { SignOutButton } from "./sign-out-button";
import { Sidebar } from "./sidebar";
import { SIDEBAR_COLLAPSED, SIDEBAR_COOKIE } from "./sidebar-state";

// Shell per spec Section 9: role-filtered sidebar (lib/auth/nav.ts) + top bar
// (global people search, signed-in user, sign out). Styled after design.pen
// "Navigation": a floating ink sidebar card and a pill top bar on the canvas.
export default async function CrmLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  // No session, an expired one, or a deactivated account.
  if (!user) redirect("/sign-in");

  const sidebarCollapsed =
    (await cookies()).get(SIDEBAR_COOKIE)?.value === SIDEBAR_COLLAPSED;
  // A team member sees Inbox and Enquiries whatever their role (019).
  const inTeam = (await teamsOf(user.id)).length > 0;

  return (
    <div className="bg-surface flex min-h-screen gap-4 p-4">
      <Sidebar
        items={navFor(user, inTeam)}
        initialCollapsed={sidebarCollapsed}
      />
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
              placeholder="Search people by name, email or phone…"
              className="bg-surface-sunken text-ink placeholder:text-ink-subtle focus-visible:outline-focus-ring w-full max-w-80 rounded-full py-2 pr-3 pl-9 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2"
            />
          </form>
          <div className="text-ink flex shrink-0 items-center gap-3 text-sm">
            <span className="hidden truncate sm:inline">{user.email}</span>
            <SignOutButton />
            <span
              aria-hidden="true"
              className="bg-lead-blue text-on-blue flex size-9 items-center justify-center rounded-full text-[13px] font-bold"
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
