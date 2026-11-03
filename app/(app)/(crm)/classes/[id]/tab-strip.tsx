"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useRef } from "react";

// §9.10 tabs, §13 keyboard: the tab lives in the URL so a refresh, a back
// button and a deep link all land on the same panel (design 10). Roving
// tabindex plus arrow keys, as a tablist is expected to behave.
export function TabStrip<T extends string>({
  tabs,
  active,
}: {
  tabs: { id: T; label: string }[];
  active: T;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function go(id: T) {
    const next = new URLSearchParams(params.toString());
    next.set("tab", id);
    router.push(`?${next.toString()}`, { scroll: false });
  }

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    const last = tabs.length - 1;
    const to =
      event.key === "ArrowRight"
        ? index === last
          ? 0
          : index + 1
        : event.key === "ArrowLeft"
          ? index === 0
            ? last
            : index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (to === null) return;
    event.preventDefault();
    refs.current[to]?.focus();
    go(tabs[to].id);
  }

  return (
    <div
      role="tablist"
      aria-label="Class detail sections"
      className="border-line bg-surface-raised flex w-fit gap-1 rounded-full border p-1"
    >
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          ref={(el) => {
            refs.current[index] = el;
          }}
          role="tab"
          type="button"
          id={`tab-${tab.id}`}
          aria-selected={tab.id === active}
          aria-controls={`panel-${tab.id}`}
          tabIndex={tab.id === active ? 0 : -1}
          onClick={() => tab.id !== active && go(tab.id)}
          onKeyDown={(e) => onKeyDown(e, index)}
          className={`focus-visible:outline-focus-ring rounded-full px-5 py-2 text-[13px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 ${
            tab.id === active
              ? "bg-primary text-primary-foreground"
              : "text-ink-muted hover:text-ink"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
