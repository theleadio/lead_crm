"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { flash } from "@/components/flash-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// §9.10 Cancel class, §9 cross-screen destructive actions: a real dialog that
// names how many students are affected, a required reason, and the §13 line
// about refunds. The server counts the seats again inside the transaction, so
// the number here is wording, never what gets written (design 11).
export function CancelClass({
  id,
  code,
  version,
  seatHolders,
  alreadyCancelled,
}: {
  id: string;
  code: string;
  version: number;
  seatHolders: number;
  alreadyCancelled: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  async function cancel() {
    const res = await fetch(`/api/classes/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "If-Match": String(version),
      },
      body: JSON.stringify({ reason }),
    });
    if (!res.ok)
      return (
        (await res.json().catch(() => null))?.error?.message ??
        "Couldn't cancel this class."
      );
    const body = await res.json().catch(() => null);
    const count = body?.enrolmentCount ?? 0;
    flash(
      `Cancelled ${code}. ${count} ${count === 1 ? "enrolment" : "enrolments"} cancelled.`,
    );
    router.push("/classes");
  }

  if (alreadyCancelled)
    return (
      <p className="text-ink-muted text-sm">
        This class is already cancelled. Its students have been told once.
      </p>
    );

  const students =
    seatHolders === 1 ? "1 student is" : `${seatHolders} students are`;

  return (
    <>
      <Button variant="destructive" onClick={() => setOpen(true)}>
        Cancel class
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Cancel ${code}?`}
        body={
          <>
            <p>
              {students} holding a seat. Their enrolments are cancelled and they
              are told the class is off.
            </p>
            <p>
              Refunds are handled in Stripe, not here. Nothing is refunded by
              cancelling.
            </p>
          </>
        }
        confirmLabel="Cancel class"
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
    </>
  );
}
