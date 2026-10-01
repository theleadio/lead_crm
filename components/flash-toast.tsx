"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Toast } from "@/components/toast";

const KEY = "lead.flash";

// Spec §13: name the outcome after a redirect. The message goes through
// sessionStorage, not the URL, so a person's name never lands in history or
// server logs (PDPA). Storage can be blocked; then there's simply no toast.
export function flash(message: string) {
  try {
    sessionStorage.setItem(KEY, message);
  } catch {}
}

// Mounted in the CRM layout, which survives client navigations, so it
// re-checks on every pathname change.
export function FlashToast() {
  const pathname = usePathname();
  const [message, setMessage] = useState<string | null>(null);
  const dismiss = useCallback(() => setMessage(null), []);

  useEffect(() => {
    try {
      const m = sessionStorage.getItem(KEY);
      if (!m) return;
      sessionStorage.removeItem(KEY);
      // Deferred: the lint rule forbids a synchronous setState in an effect.
      queueMicrotask(() => setMessage(m));
    } catch {}
  }, [pathname]);

  return <Toast message={message} onDismiss={dismiss} />;
}
