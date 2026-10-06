"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Spec §9 cross-screen + §13: destructive actions confirm in a real dialog
// (focus trap, Escape cancels and returns focus — Radix does both). `body`
// says what happens and to how many records; `children` hold the reason and
// typed-name inputs, whose state lives in the caller so a failed action keeps
// what was typed. `onConfirm` returns an error message, or nothing on success.
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  children,
  confirmLabel,
  canConfirm = true,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: React.ReactNode;
  children?: React.ReactNode;
  confirmLabel: string;
  canConfirm?: boolean;
  onConfirm: () => Promise<string | void>;
}) {
  // The trigger is the caller's own button, not a DialogTrigger, so Radix has
  // nothing to hand focus back to and Escape dropped it on <body>. Remember
  // what was focused when the dialog opened and put it back (§9 cross-screen:
  // Escape closes and returns focus).
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) opener.current = document.activeElement as HTMLElement | null;
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onCloseAutoFocus={(event) => {
          if (!opener.current?.isConnected) return;
          event.preventDefault();
          opener.current.focus();
        }}
      >
        <Body
          title={title}
          body={body}
          confirmLabel={confirmLabel}
          canConfirm={canConfirm}
          onConfirm={onConfirm}
          onCancel={() => onOpenChange(false)}
        >
          {children}
        </Body>
      </DialogContent>
    </Dialog>
  );
}

// Mounted only while the dialog is open, so saving/error reset on each open.
function Body({
  title,
  body,
  children,
  confirmLabel,
  canConfirm,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: React.ReactNode;
  children?: React.ReactNode;
  confirmLabel: string;
  canConfirm: boolean;
  onConfirm: () => Promise<string | void>;
  onCancel: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setSaving(true);
    setError(null);
    const message = await onConfirm().catch(
      () => "Couldn't reach the server. Check your connection and try again.",
    );
    // On success the caller navigates away; stay disabled so it can't double-submit.
    if (message) {
      setError(message);
      setSaving(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription asChild>
          <div className="space-y-2">{body}</div>
        </DialogDescription>
      </DialogHeader>
      {children && <div className="space-y-2">{children}</div>}
      {error && (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          disabled={!canConfirm || saving}
          onClick={confirm}
        >
          {saving ? "Saving…" : confirmLabel}
        </Button>
      </DialogFooter>
    </>
  );
}
