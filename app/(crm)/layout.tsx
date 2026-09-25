import Link from "next/link";
import { redirect } from "next/navigation";
import { FlashToast } from "@/components/flash-toast";
import { getCurrentUser } from "@/lib/auth/current-user";
import { navFor } from "@/lib/auth/nav";
import { getSession } from "@/lib/auth/server";
import { SignOutButton } from "./sign-out-button";

// Shell per spec Section 9: role-filtered sidebar (lib/auth/nav.ts) + top bar
// (global people search, signed-in user, sign out).
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
    <div className="bg-surface flex min-h-screen">
      <aside className="bg-charcoal text-on-charcoal w-56 shrink-0 p-4">
        <div className="bg-lead-yellow text-on-yellow mb-6 rounded-sm px-3 py-1.5 text-lg font-semibold">
          LEAD CRM
        </div>
        <nav className="space-y-1">
          {navFor(user).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-on-charcoal focus-visible:outline-lead-yellow block rounded-sm px-3 py-2 text-sm hover:bg-black/20 focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="border-line bg-surface-raised flex items-center justify-between border-b px-6 py-3">
          <form action="/people" method="get">
            <input
              type="search"
              name="q"
              required
              pattern=".*\S.*"
              aria-label="Search people"
              placeholder="Search people by name, email, phone…"
              className="border-line-strong bg-surface-raised text-ink placeholder:text-ink-muted focus-visible:outline-focus-ring w-80 rounded-sm border px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
            />
          </form>
          <div className="text-ink flex items-center gap-3 text-sm">
            <span>{user.email}</span>
            <SignOutButton />
          </div>
        </header>
        <main className="text-ink flex-1 p-6">{children}</main>
        <FlashToast />
      </div>
    </div>
  );
}
