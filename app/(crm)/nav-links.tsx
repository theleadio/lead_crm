"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import {
  Building2,
  ClipboardList,
  GraduationCap,
  Inbox,
  Kanban,
  LayoutDashboard,
  LibraryBig,
  Settings,
  SquareCheck,
  Users,
  type LucideIcon,
} from "lucide-react";

// design.pen "Navigation": pill rows, 16px lucide icon + 13px label, the
// active row filled with the primary blue.
const ICONS: Record<string, LucideIcon> = {
  "/dashboard": LayoutDashboard,
  "/people": Users,
  "/companies": Building2,
  "/deals": Kanban,
  "/classes": GraduationCap,
  "/courses": LibraryBig,
  "/enrolments": ClipboardList,
  "/enquiries": Inbox,
  "/tasks": SquareCheck,
  "/settings": Settings,
};

export function NavLinks({
  items,
}: {
  items: { href: string; label: string }[];
}) {
  const segment = useSelectedLayoutSegment();

  return (
    <nav className="space-y-0.5">
      {items.map((item) => {
        const Icon = ICONS[item.href] ?? LayoutDashboard;
        const active = item.href === `/${segment}`;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`focus-visible:outline-lead-blue flex items-center gap-2.5 rounded-full px-3.5 py-2.5 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 ${
              active
                ? "bg-lead-blue font-semibold text-white"
                : "text-on-charcoal hover:bg-charcoal-raised hover:text-white"
            }`}
          >
            <Icon aria-hidden="true" className="size-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
