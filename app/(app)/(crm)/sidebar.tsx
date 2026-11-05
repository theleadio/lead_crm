"use client";

import Image from "next/image";
import { useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import leadLogoWhite from "@/public/brand/lead-logo-white.webp";
import { NavLinks } from "./nav-links";
import { SIDEBAR_COLLAPSED, SIDEBAR_COOKIE } from "./sidebar-state";

const ONE_YEAR = 60 * 60 * 24 * 365;

// Collapsible sidebar. Open, it shows the full logo and labelled nav rows;
// closed, it narrows to an icon rail. The width animates and the main column
// reflows with it; labels stay in the flow and are clipped, so the icons never
// move. Below md the rail is the only state and the toggle is hidden.
export function Sidebar({
  items,
  initialCollapsed,
}: {
  items: { href: string; label: string }[];
  initialCollapsed: boolean;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? SIDEBAR_COLLAPSED : "open"}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
  }

  const label = collapsed ? "Open sidebar" : "Close sidebar";

  return (
    <aside
      id="crm-sidebar"
      className={`bg-charcoal border-line sticky top-4 h-[calc(100vh-2rem)] w-14 shrink-0 overflow-x-hidden overflow-y-auto rounded-lg border px-2 py-5 transition-[width] duration-200 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none ${
        collapsed ? "" : "md:w-56"
      }`}
    >
      <div className="relative mb-4 flex h-9 items-center justify-between pl-1">
        {/* One logo image, clipped to its disc when the rail is closed, so the
            disc stays put while the wordmark slides out of view. */}
        <span
          className={`block h-[30px] shrink-0 overflow-hidden transition-[width] duration-200 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none ${
            collapsed ? "w-[29px]" : "w-[29px] md:w-20"
          }`}
        >
          <Image
            src={leadLogoWhite}
            alt="LEAD"
            width={80}
            loading="eager"
            className="h-[30px] w-20 max-w-none"
          />
        </span>
        <button
          type="button"
          onClick={toggle}
          aria-label={label}
          title={label}
          aria-expanded={!collapsed}
          aria-controls="crm-sidebar"
          className={`text-on-charcoal hover:bg-charcoal-raised focus-visible:outline-focus-ring items-center justify-center rounded-full hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 max-md:hidden ${
            collapsed
              ? // Closed: sits over the logo disc, shown on hover or focus.
                "bg-charcoal-raised absolute top-1/2 left-0.5 flex size-8 -translate-y-1/2 opacity-0 transition-opacity duration-150 hover:opacity-100 focus-visible:opacity-100"
              : "flex size-8 shrink-0"
          }`}
        >
          {collapsed ? (
            <PanelLeftOpen aria-hidden="true" className="size-4" />
          ) : (
            <PanelLeftClose aria-hidden="true" className="size-4" />
          )}
        </button>
      </div>
      <NavLinks items={items} collapsed={collapsed} />
    </aside>
  );
}
