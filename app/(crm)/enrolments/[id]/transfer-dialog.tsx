"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Toast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import type { TransferTarget } from "@/lib/enrolments/types";
import { formatDateRange } from "@/lib/format/date";

// §9.11 transfer: offered on a confirmed enrolment only (§12.4). The targets
// are the §9.8 list read — upcoming classes of the same course, with the §12.1
// seats each has left — so this dialog adds no route of its own (design 7). A
// different course is a new enrolment, not a transfer.
export function TransferDialog({
  id,
  version,
  status,
  classId,
  courseId,
}: {
  id: string;
  version: number;
  status: string;
  classId: string;
  courseId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<TransferTarget[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // §13: named here, because the screen refreshes in place (see status-control).
  const [done, setDone] = useState<string | null>(null);

  if (status !== "confirmed") return null;

  async function openDialog() {
    setOpen(true);
    setChosen(null);
    setLoadError(null);
    setTargets(null);
    try {
      const res = await fetch(
        `/api/classes?when=upcoming&filter[courseId]=${encodeURIComponent(courseId)}&limit=100`,
      );
      if (!res.ok) {
        setLoadError("Couldn't load the classes to move to.");
        return;
      }
      const body = await res.json();
      setTargets(
        (body.data as (TransferTarget & { id: string })[]).filter(
          (c) => c.id !== classId,
        ),
      );
    } catch {
      setLoadError("Couldn't load the classes — check your connection.");
    }
  }

  async function transfer() {
    const res = await fetch(
      `/api/enrolments/${encodeURIComponent(id)}/transfer`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "If-Match": String(version),
        },
        body: JSON.stringify({ toClassId: chosen }),
      },
    );
    if (!res.ok)
      return (
        (await res.json().catch(() => null))?.error?.message ??
        "Couldn't transfer this enrolment."
      );
    const body = await res.json().catch(() => null);
    setDone(`Transferred to ${body?.toClassCode ?? "the new class"}.`);
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button variant="outline" onClick={openDialog}>
        Transfer
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Transfer to another class"
        body={
          <p>
            The student keeps the price they paid. This enrolment is marked
            transferred and a confirmed one is created on the class you pick.
          </p>
        }
        confirmLabel="Transfer"
        canConfirm={Boolean(chosen)}
        onConfirm={transfer}
      >
        {loadError && (
          <p role="alert" className="text-danger text-sm">
            {loadError}
          </p>
        )}
        {!loadError && targets === null && (
          <p className="text-ink-muted text-sm">Loading classes…</p>
        )}
        {targets?.length === 0 && (
          <p className="text-ink-muted text-sm">
            No other upcoming class runs this course yet.
          </p>
        )}
        {targets?.map((target) => (
          <label
            key={target.id}
            className="border-line flex items-center gap-3 rounded-md border p-2 text-sm"
          >
            <input
              type="radio"
              name="toClassId"
              value={target.id}
              checked={chosen === target.id}
              onChange={() => setChosen(target.id)}
            />
            <span className="font-semibold">{target.code}</span>
            <span className="text-ink-muted">
              {formatDateRange(target.startDate, target.endDate)}
            </span>
            <span className="text-ink-muted ml-auto">
              {target.seatsAvailable} of {target.capacity} seats
            </span>
          </label>
        ))}
      </ConfirmDialog>
      <Toast message={done} onDismiss={() => setDone(null)} />
    </>
  );
}
