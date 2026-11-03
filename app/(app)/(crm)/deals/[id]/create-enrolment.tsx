"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Toast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import type { TransferTarget } from "@/lib/enrolments/types";
import { formatDateRange } from "@/lib/format/date";

// §9.6 "Create enrolment": the one path that puts a deal on an enrolment.
// The §9.10 roster's own Add control is for a walk-in and leaves `deal_id`
// null (§5), so an enrolment made there never reaches the deal's panel.
//
// The person and the course come from the deal and cannot be changed here —
// a different person or course is a different deal. All that is left to
// choose is which run of the course, so this reads the §9.8 list for the
// deal's course and adds no route of its own (the §9.11 transfer dialog
// picks a class the same way).

const STATUSES: [string, string][] = [
  ["reserved", "Reserved — holding a seat, not paid"],
  ["payment_pending", "Payment pending — invoice or transfer on its way"],
];

export function CreateEnrolment({
  dealId,
  personId,
  personName,
  courseId,
  onCreated,
}: {
  dealId: string;
  personId: string;
  personName: string;
  // Null when the deal names no course: there is nothing to pick a class
  // from, so the control says so instead of listing every class.
  courseId: string | null;
  // This screen fetches its own data, so a router refresh would not show the
  // new enrolment — the panel is filled from that fetch, not from a server
  // component.
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [classes, setClasses] = useState<TransferTarget[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [status, setStatus] = useState("reserved");
  const [payerType, setPayerType] = useState("self");
  const [loadError, setLoadError] = useState<string | null>(null);
  // §13: the screen refreshes in place, so the outcome is named here.
  const [done, setDone] = useState<string | null>(null);

  async function openDialog() {
    setOpen(true);
    setChosen(null);
    setClasses(null);
    setLoadError(null);
    if (!courseId) return;
    try {
      const res = await fetch(
        `/api/classes?when=upcoming&filter[courseId]=${encodeURIComponent(courseId)}&limit=100`,
      );
      if (!res.ok) {
        setLoadError("Couldn't load the classes for this course.");
        return;
      }
      const body = await res.json();
      setClasses(body.data as TransferTarget[]);
    } catch {
      setLoadError("Couldn't load the classes — check your connection.");
    }
  }

  async function create() {
    const res = await fetch("/api/enrolments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        personId,
        classId: chosen,
        dealId,
        status,
        payerType,
      }),
    });
    if (!res.ok)
      return (
        (await res.json().catch(() => null))?.error?.message ??
        "Couldn't create this enrolment."
      );
    const code = classes?.find((c) => c.id === chosen)?.code ?? "the class";
    setDone(`${personName} enrolled in ${code}.`);
    setOpen(false);
    onCreated();
  }

  return (
    <>
      <Button variant="outline" onClick={openDialog}>
        Create enrolment
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Enrol ${personName}`}
        body={
          <p>
            The price comes from the class, not from this deal&apos;s value. The
            enrolment is linked to this deal, so it shows in the panel below.
          </p>
        }
        confirmLabel="Create enrolment"
        canConfirm={Boolean(chosen)}
        onConfirm={create}
      >
        {!courseId && (
          <p className="text-ink-muted text-sm">
            This deal names no course yet. Set the course above, save, and the
            classes running it appear here.
          </p>
        )}
        {loadError && (
          <p role="alert" className="text-danger text-sm">
            {loadError}
          </p>
        )}
        {courseId && !loadError && classes === null && (
          <p className="text-ink-muted text-sm">Loading classes…</p>
        )}
        {classes?.length === 0 && (
          <p className="text-ink-muted text-sm">
            No upcoming class runs this course yet. Add one on the Classes
            screen.
          </p>
        )}
        {classes?.map((cls) => (
          <label
            key={cls.id}
            className="border-line flex items-center gap-3 rounded-md border p-2 text-sm"
          >
            <input
              type="radio"
              name="classId"
              value={cls.id}
              checked={chosen === cls.id}
              onChange={() => setChosen(cls.id)}
            />
            <span className="font-semibold">{cls.code}</span>
            <span className="text-ink-muted">
              {formatDateRange(cls.startDate, cls.endDate)}
            </span>
            <span className="text-ink-muted ml-auto">
              {cls.seatsAvailable} of {cls.capacity} seats
            </span>
          </label>
        ))}
        {Boolean(classes?.length) && (
          <>
            {/* §12.4 create statuses: a staff-made enrolment starts held or
                awaiting money. Confirmed comes from a recorded payment. */}
            <select
              aria-label="Status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="border-line-strong bg-surface-sunken text-ink h-9 rounded-sm border px-3 text-sm"
            >
              {STATUSES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select
              aria-label="Who is paying"
              value={payerType}
              onChange={(e) => setPayerType(e.target.value)}
              className="border-line-strong bg-surface-sunken text-ink h-9 rounded-sm border px-3 text-sm"
            >
              <option value="self">Paying for themselves</option>
              <option value="company">Their company is paying</option>
            </select>
          </>
        )}
      </ConfirmDialog>
      <Toast message={done} onDismiss={() => setDone(null)} />
    </>
  );
}
