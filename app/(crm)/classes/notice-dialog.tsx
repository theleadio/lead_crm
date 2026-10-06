"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Spec §9.9 change-notice flow. The server decides a notice is needed and
// answers 409 `notice_decision_required` with the count; this asks the one
// question and sends the same save again with the choice. Nothing is sent to
// a student from here — Operations approves the notice on the class (9.10).
export function NoticeDialog({
  recipientCount,
  saving,
  onChoose,
  onCancel,
}: {
  // null closes the dialog; a number opens it.
  recipientCount: number | null;
  saving: boolean;
  onChoose: (choice: "prepare" | "skip") => void;
  onCancel: () => void;
}) {
  const [choice, setChoice] = useState<"prepare" | "skip">("prepare");
  const students =
    recipientCount === 1 ? "1 student is" : `${recipientCount} students are`;

  return (
    <Dialog
      open={recipientCount !== null}
      onOpenChange={(open) => !open && onCancel()}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{students} enrolled</DialogTitle>
          <DialogDescription>
            They will not be told until you approve a notice. Nothing is sent
            from this screen.
          </DialogDescription>
        </DialogHeader>

        <fieldset className="space-y-2">
          <legend className="sr-only">What to do about the students</legend>
          {(
            [
              [
                "prepare",
                "Save and prepare notice",
                "Saves the change and drafts a notice for Operations to approve on the class.",
              ],
              [
                "skip",
                "Save quietly",
                "Saves the change and tells nobody. Use this for a correction the students never saw.",
              ],
            ] as const
          ).map(([value, label, hint]) => (
            <label
              key={value}
              className={`border-line flex gap-3 rounded-md border p-3 text-sm ${
                choice === value ? "border-primary bg-surface-muted" : ""
              }`}
            >
              <input
                type="radio"
                name="notice-choice"
                className="mt-0.5"
                value={value}
                checked={choice === value}
                onChange={() => setChoice(value)}
              />
              <span>
                <span className="block font-semibold">{label}</span>
                <span className="text-ink-muted block">{hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Back to the form
          </Button>
          <Button
            type="button"
            disabled={saving}
            onClick={() => onChoose(choice)}
          >
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
