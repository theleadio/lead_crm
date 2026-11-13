"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import {
  BarChart3,
  Building2,
  ClipboardList,
  GraduationCap,
  Inbox,
  Kanban,
  LayoutDashboard,
  LibraryBig,
  MessagesSquare,
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
  "/inbox": MessagesSquare,
  "/enquiries": Inbox,
  "/tasks": SquareCheck,
  "/reports/ads": BarChart3,
  "/settings": Settings,
};

export function NavLinks({
  items,
  collapsed,
}: {
  items: { href: string; label: string }[];
  collapsed: boolean;
}) {
  const segment = useSelectedLayoutSegment();

  return (
    <nav className="space-y-0.5">
      {items.map((item) => {
        const Icon = ICONS[item.href] ?? LayoutDashboard;
        // The segment is only the URL's first part and Reports links to
        // /reports/ads, so compare the href's first part.
        const active = item.href.split("/")[1] === segment;
        return (
          <Link
            key={item.href}
            href={item.href}
            // Every CRM page is dynamic and reads the database. Prefetching all
            // ten sidebar links on each load started ten serverless functions at
            // once, which exhausted Supabase's connection pool and made pages 500.
            prefetch={false}
            aria-current={active ? "page" : undefined}
            title={item.label}
            // Fixed left padding keeps each icon centred in the 40px rail and still
            // while the sidebar opens or closes; the label is clipped, not moved.
            className={`focus-visible:outline-lead-blue flex items-center gap-2.5 overflow-hidden rounded-full px-3 py-2.5 text-[13px] whitespace-nowrap focus-visible:outline-2 focus-visible:-outline-offset-2 ${
              active
                ? "bg-lead-blue text-on-blue font-semibold"
                : "text-on-charcoal hover:bg-charcoal-raised hover:text-white"
            }`}
          >
            <Icon aria-hidden="true" className="size-4 shrink-0" />
            <span
              className={`transition-opacity duration-150 motion-reduce:transition-none ${
                collapsed ? "opacity-0" : "opacity-0 md:opacity-100"
              }`}
            >
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
