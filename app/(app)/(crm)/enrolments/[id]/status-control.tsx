"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Toast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { enumLabel } from "@/lib/classes/types";

// §9.11 status control, §12.4: one button per legal next status, never a
// dropdown of all eleven. The server checks §12.4 again, so a stale screen
// gets a 422 rather than an illegal move. Cancelling needs a reason and lives
// in its own dialog.
export function StatusControl({
  id,
  version,
  moves,
}: {
  id: string;
  version: number;
  moves: string[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // §13: the outcome is named where it happened. The screen refreshes in place
  // rather than navigating, so this is a toast here, not a flash for the next
  // page (components/flash-toast.tsx only fires on a path change).
  const [done, setDone] = useState<string | null>(null);

  if (!moves.length) return null;

  async function move(toStatus: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/enrolments/${encodeURIComponent(id)}/status`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "If-Match": String(version),
          },
          body: JSON.stringify({ toStatus }),
        },
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        setError(
          payload?.error?.message ?? "Couldn't change this enrolment's status.",
        );
        return;
      }
      setDone(`Status changed to ${enumLabel(toStatus).toLowerCase()}.`);
      // The version moved, so the screen reloads rather than this component
      // patching its own copy of it (§7 If-Match).
      router.refresh();
    } catch {
      setError("Couldn't save — check your connection.");
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
            onClick={() => move(status)}
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
    </span>
  );
}
