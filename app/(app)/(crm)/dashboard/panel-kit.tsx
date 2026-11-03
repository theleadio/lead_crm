"use client";

import { useRouter } from "next/navigation";
import { RotateCw } from "lucide-react";

// Spec §13: a panel that fails says what failed and offers a retry, and the
// rest of Home keeps working. Client-side so the retry can re-run the
// server render without a full page load.
export function PanelError({ what }: { what: string }) {
  const router = useRouter();
  return (
    <div
      role="alert"
      className="border-line bg-surface-raised flex flex-wrap items-center justify-between gap-3 rounded-md border p-5 text-sm"
    >
      <p className="text-ink">Couldn&apos;t load {what}.</p>
      <button
        type="button"
        onClick={() => router.refresh()}
        className="text-blue-ink focus-visible:outline-focus-ring inline-flex items-center gap-1.5 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <RotateCw aria-hidden="true" className="size-3.5" />
        Retry
      </button>
    </div>
  );
}
