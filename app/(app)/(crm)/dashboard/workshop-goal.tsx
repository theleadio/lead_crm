"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { HomeWorkshop } from "@/lib/home/types";

// The "Set goal" control on a Free workshops card (Zixuan, 12 Nov 2026).
// Saving reloads Home, so the bar and the version come from the server again
// (§7 If-Match), rather than this control patching its own copy.
export function WorkshopGoal({ workshop: w }: { workshop: HomeWorkshop }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(w.goal ? String(w.goal) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const goal = Number(value);
    if (!Number.isInteger(goal) || goal < 1 || goal > 10000) {
      setError("Enter a whole number from 1 to 10,000.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/workshop-goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: w.title,
          language: w.language,
          date: w.date,
          goal,
          version: w.goalVersion,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        setError(payload?.error?.message ?? "Couldn't save the goal.");
        return;
      }
      setEditing(false);
      router.refresh();
    } catch {
      setError("Couldn't save — check your connection.");
    } finally {
      setBusy(false);
    }
  }

  if (!editing)
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setEditing(true)}
        className="self-start"
      >
        {w.goal ? "Edit goal" : "Set goal"}
      </Button>
    );

  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label
        className="text-ink-muted text-xs"
        htmlFor={`goal-${w.date}-${w.title}`}
      >
        Sign-up goal
      </label>
      <span className="flex flex-wrap items-center gap-2">
        <Input
          id={`goal-${w.date}-${w.title}`}
          type="number"
          inputMode="numeric"
          min={1}
          max={10000}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-28"
          autoFocus
        />
        <Button type="submit" size="sm" disabled={busy}>
          Save
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => {
            setEditing(false);
            setError(null);
          }}
        >
          Cancel
        </Button>
      </span>
      {error && (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}
    </form>
  );
}
