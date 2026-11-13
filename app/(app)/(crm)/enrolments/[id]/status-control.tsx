"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Toast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { enumLabel } from "@/lib/classes/types";
import { versionHeaders } from "@/lib/api/version-headers";

// §9.11 status control, §12.4: one button per legal next status, never a
// dropdown of all eleven. The server checks §12.4 again, so a stale screen
// gets a 422 rather than an illegal move. Cancelling needs a reason and lives
// in its own dialog.
//
// Moves that are hard to take back ask first: confirming a seat with no
// payment recorded, marking a no-show, and recording a refund.
export function StatusControl({
  id,
  version,
  moves,
  paymentRecorded,
}: {
  id: string;
  version: number;
  moves: string[];
  // Whether a payment is on record for this enrolment; null when this viewer
  // may not read payments, which is treated as "not known".
  paymentRecorded: boolean | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // §13: the outcome is named where it happened. The screen refreshes in place
  // rather than navigating, so this is a toast here, not a flash for the next
  // page (components/flash-toast.tsx only fires on a path change).
  const [done, setDone] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);

  if (!moves.length) return null;

  // The question to ask before a move, or null to move at once.
  function question(status: string): { title: string; body: string } | null {
    if (status === "confirmed" && paymentRecorded !== true)
      return {
        title: "Confirm without a payment?",
        body:
          paymentRecorded === false
            ? "No payment is recorded for this enrolment. Confirming gives them a seat as if they had paid. Record the payment first if the money has arrived."
            : "You can't see this enrolment's payments. Confirm only if you know the money has arrived.",
      };
    if (status === "no_show")
      return {
        title: "Mark as a no-show?",
        body: "This records that they did not attend.",
      };
    if (status === "refunded")
      return {
        title: "Record a refund?",
        body: "This only records the refund here. The money itself is returned in Stripe.",
      };
    return null;
  }

  async function move(toStatus: string): Promise<string | void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/enrolments/${encodeURIComponent(id)}/status`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...versionHeaders(version),
          },
          body: JSON.stringify({ toStatus }),
        },
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        const message =
          payload?.error?.message ?? "Couldn't change this enrolment's status.";
        setError(message);
        return message;
      }
      setAsking(null);
      setDone(`Status changed to ${enumLabel(toStatus).toLowerCase()}.`);
      // The version moved, so the screen reloads rather than this component
      // patching its own copy of it (§7 If-Match).
      router.refresh();
    } catch {
      setError("Couldn't save — check your connection.");
      return "Couldn't save — check your connection.";
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex flex-col gap-1">
      <span className="flex flex-wrap gap-2">
        {moves.map((status) => (
          <Button
            key={status}
            variant="outline"
            disabled={busy}
            onClick={() =>
              question(status) ? setAsking(status) : move(status)
            }
          >
            Mark {enumLabel(status).toLowerCase()}
          </Button>
        ))}
      </span>
      {error && (
        <span role="alert" className="text-danger text-xs">
          {error}
        </span>
      )}
      <Toast message={done} onDismiss={() => setDone(null)} />
      {asking && question(asking) && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setAsking(null)}
          title={question(asking)!.title}
          body={<p>{question(asking)!.body}</p>}
          confirmLabel={`Mark ${enumLabel(asking).toLowerCase()}`}
          tone="primary"
          onConfirm={() => move(asking)}
        />
      )}
    </span>
  );
}
