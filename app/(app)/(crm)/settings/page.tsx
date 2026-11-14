import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { permissionFor } from "@/lib/auth/permissions";
import { canEditEnquirySettings } from "@/lib/enquiries/settings";

// Settings (§9): one row per settings screen that exists, for the roles that
// may open it. Enquiry settings are the ticket settings that moved here from
// lead_sales (migration 019): teams, categories, routing rules, holidays.
// The other §9 settings screens are not built yet.
const SECTIONS = [
  {
    href: "/settings/enquiries",
    title: "Enquiries",
    about:
      "Teams and members, categories and keywords, routing rules, and public holidays for reply deadlines.",
    may: (role: Parameters<typeof canEditEnquirySettings>[0]) =>
      canEditEnquirySettings(role),
  },
];

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) notFound();
  const sections = SECTIONS.filter((s) => s.may(user.role));
  if (!sections.length && !permissionFor(user, "settings", "read").allowed)
    notFound();
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">Settings</h1>
      {sections.length ? (
        <ul className="border-line divide-line bg-surface-raised divide-y rounded-md border">
          {sections.map((s) => (
            <li key={s.href}>
              <Link
                href={s.href}
                className="hover:bg-surface-sunken focus-visible:outline-focus-ring flex items-center gap-3 px-5 py-4 focus-visible:outline-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{s.title}</span>
                  <span className="text-ink-muted block text-sm">
                    {s.about}
                  </span>
                </span>
                <ChevronRight
                  aria-hidden="true"
                  className="text-ink-muted size-4 shrink-0"
                />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ink-muted text-sm">
          No settings you can change yet.
        </p>
      )}
    </div>
  );
}
