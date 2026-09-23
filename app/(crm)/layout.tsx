import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/server";
import { SignOutButton } from "./sign-out-button";

// Shell per spec Section 9: sidebar nav (role-filtered later) + top bar
// (global search, signed-in user, sign out). Role filtering and the real
// search box land with 9.1 People — this is the skeleton only.
const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/people", label: "People" },
  { href: "/companies", label: "Companies" },
  { href: "/deals", label: "Deals" },
  { href: "/classes", label: "Classes" },
  { href: "/enrolments", label: "Enrolments" },
  { href: "/enquiries", label: "Enquiries" },
  { href: "/tasks", label: "Tasks" },
  { href: "/settings", label: "Settings" },
];

export default async function CrmLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSession();
  if (!user) redirect("/sign-in");

  return (
    <div className="bg-surface flex min-h-screen">
      <aside className="bg-charcoal text-on-charcoal w-56 shrink-0 p-4">
        <div className="bg-lead-yellow text-on-yellow mb-6 rounded-sm px-3 py-1.5 text-lg font-semibold">
          LEAD CRM
        </div>
        <nav className="space-y-1">
          {NAV_ITEMS.map((item) => (
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
          <input
            type="search"
            placeholder="Search people by name, email, phone…"
            className="border-line-strong bg-surface-raised text-ink placeholder:text-ink-muted focus-visible:outline-focus-ring w-80 rounded-sm border px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
          />
          <div className="text-ink flex items-center gap-3 text-sm">
            <span>{user.email}</span>
            <SignOutButton />
          </div>
        </header>
        <main className="text-ink flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
