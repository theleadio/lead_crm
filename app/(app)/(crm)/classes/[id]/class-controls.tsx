"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

// §9.10 header controls (§12.1, v1.9): two decisions, two buttons, two
// routes. Whether a class takes bookings and whether the website lists it are
// separate — a corporate class is open for booking and never shown. Status is
// never computed here: the badge beside these buttons is the stored value, and
// the database may answer `open` with few_seats or full (006).
export function ClassControls({
  id,
  status,
  isPublic,
  version,
}: {
  id: string;
  status: string;
  isPublic: boolean;
  version: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A cancelled or completed class is a person's call to change, and Cancel
  // class on the Details tab is the only route out (§12.1).
  const open = ["open", "few_seats", "full"].includes(status);
  if (!open && status !== "draft") return null;

  async function post(path: "status" | "website", body: object) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/classes/${encodeURIComponent(id)}/${path}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "If-Match": String(version),
          },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        setError(payload?.error?.message ?? "Couldn't change this class.");
        return;
      }
      // The version moved, so the whole screen reloads rather than this
      // component patching its own copy of it (§7 If-Match).
      router.refresh();
    } catch {
      setError("Couldn't save — check your connection.");
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
              onClick={() => post("website", { isPublic: !isPublic })}
            >
              {isPublic ? "Hide from website" : "Show on website"}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => post("status", { status: "draft" })}
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
      {error && (
        <span role="alert" className="text-danger text-right text-xs">
          {error}
        </span>
      )}
    </span>
  );
}
