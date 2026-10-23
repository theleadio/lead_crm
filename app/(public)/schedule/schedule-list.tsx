"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { ScheduleClass } from "@/lib/public/schedule";
import { ClassCard } from "./class-card";
import {
  LANGUAGE_LABEL,
  NO_FILTERS,
  type Filters,
  filterClasses,
  filterOptions,
  trackLabel,
} from "./schedule-view";

// The filters run in the browser over the classes the server already fetched
// (§10.1): no refetch, no navigation, and the server-rendered list is the
// final layout, which is what keeps §10.5's "no layout shift" honest. This
// renders on the server too, so the schedule is in the HTML and a visitor
// without JavaScript still sees every class.

// A filter chip: the field name until something is picked, then the value in
// the accent colour. It stays a native <select>, so the dropdown is the one
// the phone already knows how to show and there is no popover, focus trap or
// outside-click handling to get wrong. The CRM's FilterSelect is not reused
// here: it prefixes every option with the field name, which reads as
// "Language: all" rather than as a chip.
function FilterChip({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  const active = value !== "";
  // The chip reads "Language" until something is picked, then "English".
  const shown = options.find(([v]) => v === value)?.[1] ?? label;
  return (
    // The select is laid over the chip at full size and invisible: a native
    // select is only ever as wide as its longest option, which would make the
    // Track chip as wide as "Certification". The visible text is the span, so
    // each chip hugs what it currently says.
    <span
      className={`focus-within:outline-focus-ring relative inline-flex h-9 items-center gap-1 rounded-full border pr-3 pl-4 text-sm focus-within:outline-2 focus-within:outline-offset-2 ${
        active
          ? "border-lead-blue bg-blue-soft text-blue-ink"
          : "border-line-strong text-ink-muted"
      }`}
    >
      {shown}
      <ChevronDown aria-hidden className="size-4 shrink-0" />
      {/* The option list is painted by the browser, not by the page. Chrome
          takes its colours from the select's own background and text, and
          falls back to a white menu when the background is transparent — so
          they are set here even though the select itself is invisible. */}
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-surface-raised text-ink absolute inset-0 size-full cursor-pointer opacity-0"
      >
        <option value="" className="bg-surface-raised text-ink">
          {label}
        </option>
        {options.map(([v, text]) => (
          <option key={v} value={v} className="bg-surface-raised text-ink">
            {text}
          </option>
        ))}
      </select>
    </span>
  );
}

export function ScheduleList({
  classes,
}: {
  classes: ScheduleClass[];
  // Read on the server (it comes from PUBLIC_WEBSITE_URL) and passed down, so
  // no env reaches the browser.
}) {
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const options = filterOptions(classes);
  const shown = filterClasses(classes, filters);
  const set = (k: keyof Filters) => (v: string) =>
    setFilters((f) => ({ ...f, [k]: v }));

  return (
    <>
      {/* All three are offered even when the set holds one value (§10.1), and
          every option comes from the set, so none can match nothing. The
          chips are compact enough to share one line on a phone. */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <FilterChip
          label="Language"
          value={filters.language}
          onChange={set("language")}
          options={options.languages.map((v) => [v, LANGUAGE_LABEL[v] ?? v])}
        />
        <FilterChip
          label="Track"
          value={filters.track}
          onChange={set("track")}
          options={options.tracks.map((v) => [v, trackLabel(v)])}
        />
        <FilterChip
          label="City"
          value={filters.city}
          onChange={set("city")}
          options={options.cities.map((v) => [v, v])}
        />
      </div>

      {shown.length === 0 ? (
        // Distinct from the empty-schedule state: classes exist, these filters
        // just match none of them (§10.1).
        <p className="text-ink-muted text-sm">
          No class matches these filters.{" "}
          <button
            type="button"
            onClick={() => setFilters(NO_FILTERS)}
            className="text-ink underline underline-offset-4"
          >
            Clear filters
          </button>
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((c) => (
            <ClassCard key={c.id} cls={c} />
          ))}
        </div>
      )}
    </>
  );
}
