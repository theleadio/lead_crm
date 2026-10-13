"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { CourseListItem } from "@/lib/courses/service";
import { suggestDealValue } from "@/lib/deals/format";
import { formatMoneyMyr } from "@/lib/format/money";
import type { ListResponse, PersonListItem } from "@/lib/people/types";

// §9.5 / §9.2 "New deal". The deal opens in `new` and the stage moves only on
// the board or §9.6, so this form has no stage. Everything but the person is
// optional — a deal is often opened on a phone call, before the course or the
// value is known — and the rest is filled in on the deal itself.
//
// The courses here are the active ones (§9.5 v1.6: retired courses stay on
// the board's filter so their old deals are findable, but nobody opens a new
// deal on one).

export function NewDeal({
  pipeline,
  person,
  label = "New deal",
}: {
  pipeline: "individual" | "corporate";
  // Fixed when the dialog is opened from a person's own screen (§9.2);
  // searched for when it comes from the board.
  person?: { id: string; fullName: string };
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PersonListItem[] | null>(null);
  const [chosen, setChosen] = useState<{ id: string; fullName: string } | null>(
    person ?? null,
  );
  const [courses, setCourses] = useState<CourseListItem[]>([]);
  const [courseId, setCourseId] = useState("");
  const [amount, setAmount] = useState("");
  const [headcount, setHeadcount] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    fetch("/api/courses?active=true&limit=100")
      .then((res) => res.json())
      .then((b: ListResponse<CourseListItem>) => setCourses(b.data))
      .catch(() => setError("Couldn't load the course list."));
  }, [open]);

  // §9.1: 300ms debounce, the same as the people list search.
  useEffect(() => {
    if (!open || chosen) return;
    let ignore = false;
    const t = setTimeout(() => {
      const params = new URLSearchParams({ limit: "8" });
      if (q.trim()) params.set("q", q.trim());
      fetch(`/api/people?${params}`)
        .then(async (res) => {
          const body = await res.json();
          if (!res.ok) throw new Error(body.error?.message);
          if (!ignore) setResults((body as ListResponse<PersonListItem>).data);
        })
        .catch((err: Error) => {
          if (!ignore) setError(err.message || "Couldn't search people.");
        });
    }, 300);
    return () => {
      ignore = true;
      clearTimeout(t);
    };
  }, [open, chosen, q]);

  // §12.7: a number to start from, not the money. The same offer the §9.6
  // Value field makes.
  const suggested = amount.trim()
    ? null
    : suggestDealValue(
        courses.find((c) => c.id === courseId)?.listPriceMyr,
        headcount,
      );

  async function save() {
    if (!chosen) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pipeline,
          personId: chosen.id,
          ...(courseId && { courseId }),
          ...(amount.trim() && { amountMyr: amount.trim() }),
          ...(pipeline === "corporate" &&
            headcount.trim() && { headcount: Number(headcount) }),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error?.message ?? "Couldn't create this deal.");
        return;
      }
      // Straight to the new deal: company, funding type and the HRDC fields
      // are edited there, and a board column would hide it below the fold.
      router.push(`/deals/${body.id}`);
    } catch {
      setError("Couldn't save — check your connection.");
    } finally {
      setSaving(false);
    }
  }

  function close() {
    setOpen(false);
    setQ("");
    setResults(null);
    setChosen(person ?? null);
    setCourseId("");
    setAmount("");
    setHeadcount("");
    setError(null);
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>{label}</Button>
      <Dialog
        open={open}
        onOpenChange={(next) => (next ? setOpen(true) : close())}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              New {pipeline === "corporate" ? "corporate" : "individual"} deal
            </DialogTitle>
          </DialogHeader>

          {chosen ? (
            <p className="text-sm">
              <span className="font-semibold">{chosen.fullName}</span>{" "}
              {!person && (
                <button
                  type="button"
                  className="text-blue-ink underline"
                  onClick={() => {
                    setChosen(null);
                    setResults(null);
                  }}
                >
                  Change
                </button>
              )}
            </p>
          ) : (
            <>
              <Input
                aria-label="Search people by name, email or phone"
                placeholder="Search people…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <div className="max-h-48 space-y-1 overflow-y-auto">
                {results?.length === 0 && (
                  <p className="text-ink-muted text-sm">
                    Nobody found. Add the person on the People screen first.
                  </p>
                )}
                {results?.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className="hover:bg-surface-sunken w-full rounded-sm p-2 text-left text-sm"
                    onClick={() =>
                      setChosen({ id: r.id, fullName: r.fullName })
                    }
                  >
                    <span className="font-semibold">{r.fullName}</span>
                    <span className="text-ink-muted">
                      {" "}
                      {r.email ?? r.phone}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          <label className="text-sm">
            Course
            <select
              className="border-line-strong bg-surface-sunken text-ink focus-visible:outline-focus-ring mt-1 w-full rounded-md border p-2 focus-visible:outline-2 focus-visible:outline-offset-2"
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
            >
              <option value="">Not decided yet</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.nameEn}
                </option>
              ))}
            </select>
          </label>

          {pipeline === "corporate" && (
            <label className="text-sm">
              Headcount
              <Input
                type="number"
                min={1}
                step={1}
                value={headcount}
                onChange={(e) => setHeadcount(e.target.value)}
                placeholder="How many students"
              />
            </label>
          )}

          <label className="text-sm">
            Value (MYR)
            <Input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="4500.00"
            />
            {suggested && (
              <p className="text-ink-muted mt-1 text-xs">
                <button
                  type="button"
                  className="text-blue-ink underline"
                  onClick={() => setAmount(suggested.amount)}
                >
                  Use {formatMoneyMyr(suggested.amount)}
                </button>{" "}
                —{" "}
                {suggested.seats > 1
                  ? `list price × ${suggested.seats} seats`
                  : "the course list price, before any discount"}
              </p>
            )}
          </label>

          {error && (
            <p role="alert" className="text-danger text-sm">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button onClick={save} disabled={!chosen || saving}>
              {saving ? "Creating…" : "Create deal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
