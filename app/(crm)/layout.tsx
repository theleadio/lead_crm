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
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r bg-gray-50 p-4">
        <div className="mb-6 text-lg font-semibold">LEAD CRM</div>
        <nav className="space-y-1">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded px-3 py-2 text-sm hover:bg-gray-200"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b px-6 py-3">
          <input
            type="search"
            placeholder="Search people by name, email, phone…"
            className="w-80 rounded border px-3 py-1.5 text-sm"
          />
          <div className="flex items-center gap-3 text-sm">
            <span>{user.email}</span>
            <SignOutButton />
          </div>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
