"use client";

import { useRef, useState } from "react";
import { CalendarDays, X } from "lucide-react";
import { cn } from "cn";
import { formatDate } from "@/lib/format/date";

// A date input that reads the way staff write dates: "12 Nov 2026".
// The native <input type="date"> shows the browser's locale order, which on
// an English Chrome is mm/dd/yyyy — 11/12 reads as 11 December in Malaysia.
// This keeps the native input (and its calendar, keyboard support and form
// value, always YYYY-MM-DD) underneath, invisible, and shows the date in
// the app's own format on a button that opens the calendar.
//
// Controlled (value + onChange) or uncontrolled (defaultValue + name, for a
// plain GET form); either way the native input carries `name`.
export function DateField({
  id,
  value,
  defaultValue,
  onChange,
  name,
  min,
  max,
  required,
  disabled,
  placeholder = "Pick a date",
  className,
  "aria-label": ariaLabel,
}: {
  id?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  name?: string;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [inner, setInner] = useState(defaultValue ?? "");
  const current = value ?? inner;

  function change(next: string) {
    setInner(next);
    onChange?.(next);
  }

  function open() {
    const el = input.current;
    if (!el) return;
    // showPicker is in every current browser; focus is the fallback.
    try {
      el.showPicker();
    } catch {
      el.focus();
    }
  }

  const shown = current ? formatDate(current) : "";

  return (
    <span className={cn("relative inline-flex w-full", className)}>
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={open}
        aria-label={
          ariaLabel ? `${ariaLabel}: ${shown || "not set"}` : undefined
        }
        className="border-input focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 flex h-9 w-full min-w-0 cursor-pointer items-center gap-2 rounded-sm border bg-transparent px-3 text-left text-sm transition-colors outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <CalendarDays
          aria-hidden="true"
          className="text-ink-subtle size-4 shrink-0"
        />
        <span className={shown ? "text-ink" : "text-muted-foreground"}>
          {shown || placeholder}
        </span>
      </button>
      {current && !required && !disabled && (
        <button
          type="button"
          onClick={() => change("")}
          aria-label={`Clear ${ariaLabel ?? "date"}`}
          className="text-ink-subtle hover:text-ink focus-visible:outline-focus-ring absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer rounded-sm p-0.5 focus-visible:outline-2"
        >
          <X aria-hidden="true" className="size-3.5" />
        </button>
      )}
      <input
        ref={input}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        name={name}
        value={current}
        min={min}
        max={max}
        required={required}
        disabled={disabled}
        onChange={(e) => change(e.target.value)}
        className="pointer-events-none absolute inset-0 opacity-0"
      />
    </span>
  );
}
