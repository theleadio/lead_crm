"use client";

import { useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { LostReasonOption } from "@/lib/deals/types";

// Spec §9.5: a move to Lost needs a reason (§12.5, active reasons only).
// Required, none preselected. Cancel or Escape sends nothing. Mount with a
// key per card so the choice resets each time.
export function LostReasonDialog({
  personName,
  onCancel,
  onConfirm,
}: {
  personName: string;
  onCancel: () => void;
  onConfirm: (lostReasonId: string) => void;
}) {
  const [reasons, setReasons] = useState<LostReasonOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reasonId, setReasonId] = useState("");

  useEffect(() => {
    fetch("/api/lost-reasons")
      .then(async (res) => {
        const body = await res.json();
        if (res.ok) setReasons(body.data);
        else setLoadError(body.error?.message ?? "Couldn't load lost reasons.");
      })
      .catch(() =>
        setLoadError("Couldn't load lost reasons — check your connection."),
      );
  }, []);

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onCancel()}
      title="Mark deal as lost"
      body={<p>Why was the deal with {personName} lost?</p>}
      confirmLabel="Mark lost"
      canConfirm={Boolean(reasonId)}
      onConfirm={async () => onConfirm(reasonId)}
    >
      {loadError ? (
        <p role="alert" className="text-danger text-sm">
          {loadError}
        </p>
      ) : (
        <select
          aria-label="Lost reason"
          required
          value={reasonId}
          disabled={!reasons}
          onChange={(e) => setReasonId(e.target.value)}
          className="border-input bg-surface-raised text-ink focus-visible:outline-focus-ring h-9 w-full rounded-md border px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <option value="">{reasons ? "Pick a reason" : "Loading…"}</option>
          {reasons?.map((r) => (
            <option key={r.id} value={r.id}>
              {r.labelEn}
            </option>
          ))}
        </select>
      )}
    </ConfirmDialog>
  );
}
