"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Toast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// §9.11 cancel, §9 cross-screen destructive actions: a real dialog, a required
// reason (it is what `cancelled_reason` and the §11.1 EnrolmentCancelled event
// carry), and the §13 line about refunds. Escape closes it without writing, and
// a refusal keeps the typed reason — both come from ConfirmDialog.
export function CancelEnrolment({
  id,
  version,
  personName,
  classCode,
  hasPayments,
}: {
  id: string;
  version: number;
  personName: string;
  classCode: string;
  hasPayments: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  // §13: named here, because the screen refreshes in place (see status-control).
  const [done, setDone] = useState<string | null>(null);

  async function cancel() {
    const res = await fetch(
      `/api/enrolments/${encodeURIComponent(id)}/status`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "If-Match": String(version),
        },
        body: JSON.stringify({ toStatus: "cancelled", reason }),
      },
    );
    if (!res.ok)
      return (
        (await res.json().catch(() => null))?.error?.message ??
        "Couldn't cancel this enrolment."
      );
    setDone(`Cancelled ${personName}'s place in ${classCode}.`);
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button variant="destructive" onClick={() => setOpen(true)}>
        Cancel enrolment
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Cancel ${personName}'s place?`}
        body={
          <>
            <p>
              The seat in {classCode} is freed and this enrolment reads
              cancelled.
            </p>
            <p>
              {hasPayments
                ? "This enrolment has a payment. Refunds are handled in Stripe, not here."
                : "Refunds are handled in Stripe, not here."}
            </p>
          </>
        }
        confirmLabel="Cancel enrolment"
        canConfirm={Boolean(reason.trim())}
        onConfirm={cancel}
      >
        <Input
          aria-label="Reason for cancelling"
          placeholder="Reason (required)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </ConfirmDialog>
      <Toast message={done} onDismiss={() => setDone(null)} />
    </>
  );
}
