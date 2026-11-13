"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { versionHeaders } from "@/lib/api/version-headers";

// §9.10 header controls (§12.1, v1.9): two decisions, two buttons, two
// routes. Whether a class takes bookings and whether the website lists it are
// separate — a corporate class is open for booking and never shown. Status is
// never computed here: the badge beside these buttons is the stored value, and
// the database may answer `open` with few_seats or full (006).
//
// The two moves that change what customers see ask first: Back to draft stops
// bookings, and Show on website warns when the class would go public with
// gaps (no price, venue TBC, no joining link). Hide and Open act at once.
export function ClassControls({
  id,
  status,
  isPublic,
  version,
  websiteGaps,
}: {
  id: string;
  status: string;
  isPublic: boolean;
  version: number;
  websiteGaps: string[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<"draft" | "website" | null>(null);

  // A cancelled or completed class is a person's call to change, and Cancel
  // class on the Details tab is the only route out (§12.1).
  const open = ["open", "few_seats", "full"].includes(status);
  if (!open && status !== "draft") return null;

  // Returns an error message for the dialog, or nothing on success.
  async function post(
    path: "status" | "website",
    body: object,
  ): Promise<string | void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/classes/${encodeURIComponent(id)}/${path}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...versionHeaders(version),
          },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        const message =
          payload?.error?.message ?? "Couldn't change this class.";
        setError(message);
        return message;
      }
      setAsking(null);
      // The version moved, so the whole screen reloads rather than this
      // component patching its own copy of it (§7 If-Match).
      router.refresh();
    } catch {
      setError("Couldn't save — check your connection.");
      return "Couldn't save — check your connection.";
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <span className="flex flex-wrap items-center gap-2">
        {open ? (
          <>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                isPublic || !websiteGaps.length
                  ? post("website", { isPublic: !isPublic })
                  : setAsking("website")
              }
            >
              {isPublic ? "Hide from website" : "Show on website"}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setAsking("draft")}
            >
              Back to draft
            </Button>
          </>
        ) : (
          <Button
            disabled={busy}
            onClick={() => post("status", { status: "open" })}
          >
            Open for booking
          </Button>
        )}
      </span>
      {error && !asking && (
        <span role="alert" className="text-danger text-right text-xs">
          {error}
        </span>
      )}

      <ConfirmDialog
        open={asking === "website"}
        onOpenChange={(o) => !o && setAsking(null)}
        title="Show this class with gaps?"
        body={
          <>
            <p>Visitors would see this class as it is now:</p>
            <ul className="list-disc pl-5">
              {websiteGaps.map((gap) => (
                <li key={gap}>{gap}</li>
              ))}
            </ul>
            <p>Edit the class first, or show it anyway.</p>
          </>
        }
        confirmLabel="Show anyway"
        tone="primary"
        onConfirm={() => post("website", { isPublic: true })}
      />
      <ConfirmDialog
        open={asking === "draft"}
        onOpenChange={(o) => !o && setAsking(null)}
        title="Move this class back to draft?"
        body={
          <p>
            It stops taking bookings until you open it again. A class that
            already has bookings can&apos;t go back to draft; cancel it instead.
          </p>
        }
        confirmLabel="Back to draft"
        cancelLabel="Keep it open"
        tone="primary"
        onConfirm={() => post("status", { status: "draft" })}
      />
    </span>
  );
}
