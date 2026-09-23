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
import { Input } from "@/components/ui/input";
import type { PersonListItem } from "@/lib/people/types";

type Form = {
  fullName: string;
  preferredName: string;
  email: string;
  phone: string;
  preferredLanguage: "en" | "zh";
  jobTitle: string;
  notes: string;
};

const EMPTY: Form = {
  fullName: "",
  preferredName: "",
  email: "",
  phone: "",
  preferredLanguage: "en",
  jobTitle: "",
  notes: "",
};

export function AddPersonDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (person: PersonListItem) => void;
}) {
  const [form, setForm] = useState<Form>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const set = (key: keyof Form) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      const res = await fetch("/api/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok) {
        // Spec §9 cross-screen: never lose typed input on a failed save.
        setError(body.error?.message ?? "Couldn't add this person.");
        setFieldErrors(body.error?.fields ?? {});
        return;
      }
      setForm(EMPTY);
      onCreated(body);
    } catch {
      setError(
        "Couldn't save — check your connection. Your changes are still here.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>Add person</DialogTitle>
            <DialogDescription>
              Full name is required. Email and phone are checked against
              existing people.
            </DialogDescription>
          </DialogHeader>

          {error && (
            <p
              role="alert"
              className="bg-danger-soft text-danger rounded-md p-3 text-sm"
            >
              {error}
            </p>
          )}

          <Field label="Full name" required error={fieldErrors.fullName}>
            {(id) => (
              <Input
                id={id}
                value={form.fullName}
                onChange={(e) => set("fullName")(e.target.value)}
                autoFocus
              />
            )}
          </Field>
          <Field label="Preferred name" error={fieldErrors.preferredName}>
            {(id) => (
              <Input
                id={id}
                value={form.preferredName}
                onChange={(e) => set("preferredName")(e.target.value)}
              />
            )}
          </Field>
          <Field label="Email" error={fieldErrors.email}>
            {(id) => (
              <Input
                id={id}
                type="email"
                value={form.email}
                onChange={(e) => set("email")(e.target.value)}
              />
            )}
          </Field>
          <Field label="Phone" error={fieldErrors.phone}>
            {(id) => (
              <Input
                id={id}
                type="tel"
                placeholder="+60 12-345 6789"
                value={form.phone}
                onChange={(e) => set("phone")(e.target.value)}
              />
            )}
          </Field>
          <Field label="Language" error={fieldErrors.preferredLanguage}>
            {(id) => (
              <select
                id={id}
                value={form.preferredLanguage}
                onChange={(e) => set("preferredLanguage")(e.target.value)}
                className="border-input bg-surface-raised text-ink focus-visible:outline-focus-ring h-9 w-full rounded-md border px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <option value="en">English</option>
                <option value="zh">Chinese</option>
              </select>
            )}
          </Field>
          <Field label="Job title" error={fieldErrors.jobTitle}>
            {(id) => (
              <Input
                id={id}
                value={form.jobTitle}
                onChange={(e) => set("jobTitle")(e.target.value)}
              />
            )}
          </Field>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Add person"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: (id: string) => React.ReactNode;
}) {
  const id = `add-person-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-ink text-sm font-medium">
        {label}
        {required && <span className="text-danger"> *</span>}
      </label>
      {children(id)}
      {error && <p className="text-danger text-xs">{error}</p>}
    </div>
  );
}
