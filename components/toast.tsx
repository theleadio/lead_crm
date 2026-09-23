"use client";

import { useEffect } from "react";

// Spec §13: toasts last 5 seconds, are dismissible, and name what happened.
export function Toast({
  message,
  onDismiss,
}: {
  message: string | null;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDismiss, 5000);
    return () => clearTimeout(t);
  }, [message, onDismiss]);

  if (!message) return null;
  return (
    <div
      role="status"
      className="bg-charcoal text-on-charcoal fixed right-6 bottom-6 z-50 flex items-center gap-4 rounded-md px-4 py-3 text-sm shadow-lg"
    >
      <span>{message}</span>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="focus-visible:outline-lead-yellow rounded-sm px-1 focus-visible:outline-2"
      >
        ✕
      </button>
    </div>
  );
}
