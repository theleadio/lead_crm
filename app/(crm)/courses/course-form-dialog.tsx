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
import { COURSE_TRACKS } from "@/lib/validation/course";
import type { CourseListItem } from "@/lib/courses/service";

export type CourseFormValues = {
  code: string;
  nameEn: string;
  nameZh: string;
  track: string;
  durationDays: string;
  listPriceMyr: string;
  hrdcClaimable: boolean;
  isActive: boolean;
};

export const EMPTY_COURSE: CourseFormValues = {
  code: "",
  nameEn: "",
  nameZh: "",
  track: "certification",
  durationDays: "1",
  listPriceMyr: "",
  hrdcClaimable: false,
  isActive: true,
};

export function valuesFrom(course: CourseListItem): CourseFormValues {
  return {
    code: course.code,
    nameEn: course.nameEn,
    nameZh: course.nameZh ?? "",
    track: course.track,
    durationDays: String(course.durationDays),
    listPriceMyr: course.listPriceMyr ?? "",
    hrdcClaimable: course.hrdcClaimable,
    isActive: course.isActive,
  };
}

// Spec §9.7: one modal form for Add and Edit — code, names EN/ZH, track,
// duration, list price, HRDC claimable, active.
export function CourseFormDialog({
  open,
  onOpenChange,
  courseId,
  version,
  initial,
  onSaved,
  onStale,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Set when editing. A create has no id and no version.
  courseId?: string;
  // The loaded row version, sent as If-Match when editing (§7 v1.7).
  version?: number;
  initial: CourseFormValues;
  onSaved: (course: { id: string; nameEn: string; created: boolean }) => void;
  onStale: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Mounted only while open, so it starts from `initial` every time. */}
        <CourseForm
          courseId={courseId}
          version={version}
          initial={initial}
          onClose={() => onOpenChange(false)}
          onSaved={onSaved}
          onStale={onStale}
        />
      </DialogContent>
    </Dialog>
  );
}

function CourseForm({
  courseId,
  version,
  initial,
  onClose,
  onSaved,
  onStale,
}: {
  courseId?: string;
  version?: number;
  initial: CourseFormValues;
  onClose: () => void;
  onSaved: (course: { id: string; nameEn: string; created: boolean }) => void;
  onStale: () => void;
}) {
  const [form, setForm] = useState<CourseFormValues>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const set = <K extends keyof CourseFormValues>(
    key: K,
    value: CourseFormValues[K],
  ) => setForm((f) => ({ ...f, [key]: value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setStale(false);
    setFieldErrors({});
    const body = {
      ...form,
      // The API takes a whole number of days and a price string (§4).
      durationDays: Number(form.durationDays),
      listPriceMyr: form.listPriceMyr.trim() || null,
      nameZh: form.nameZh.trim(),
    };
    try {
      const res = await fetch(
        courseId ? `/api/courses/${courseId}` : "/api/courses",
        {
          method: courseId ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
            // §7 (v1.7): only an edit carries a version; a create has none.
            ...(courseId && version !== undefined
              ? { "If-Match": String(version) }
              : {}),
          },
          body: JSON.stringify(body),
        },
      );
      const payload = await res.json();
      if (!res.ok) {
        // Spec §9 cross-screen: never lose typed input on a failed save.
        setError(payload.error?.message ?? "Couldn't save this course.");
        setFieldErrors(payload.error?.fields ?? {});
        // §13 stale edit: offer a reload, keep what was typed.
        setStale(payload.error?.code === "stale_edit");
        return;
      }
      onSaved({
        id: payload.id,
        nameEn: form.nameEn.trim(),
        created: !courseId,
      });
      onClose();
    } catch {
      setError(
        "Couldn't save — check your connection. Your changes are still here.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <DialogHeader>
        <DialogTitle>{courseId ? "Edit course" : "Add course"}</DialogTitle>
        <DialogDescription>
          Code and English name are required. Retiring a course keeps it on
          existing deals and classes.
        </DialogDescription>
      </DialogHeader>

      {error && (
        <div
          role="alert"
          className="bg-danger-soft text-danger space-y-2 rounded-md p-3 text-sm"
        >
          <p>{error}</p>
          {stale && (
            <Button type="button" variant="outline" onClick={onStale}>
              Reload this course
            </Button>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Course code" required error={fieldErrors.code}>
          {(id) => (
            <Input
              id={id}
              value={form.code}
              onChange={(e) => set("code", e.target.value)}
              autoFocus
            />
          )}
        </Field>
        <Field label="Track" required error={fieldErrors.track}>
          {(id) => (
            <select
              id={id}
              value={form.track}
              onChange={(e) => set("track", e.target.value)}
              className="border-line-strong bg-surface-sunken text-ink focus-visible:outline-focus-ring h-9 w-full rounded-sm border px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              {COURSE_TRACKS.map((t) => (
                <option key={t} value={t}>
                  {t.replace("_", " ")}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <p className="text-ink-muted text-xs">
        The website registration forms match on this code, so changing it stops
        new leads matching the course.
      </p>

      <Field label="English name" required error={fieldErrors.nameEn}>
        {(id) => (
          <Input
            id={id}
            value={form.nameEn}
            onChange={(e) => set("nameEn", e.target.value)}
          />
        )}
      </Field>
      <Field label="Chinese name" error={fieldErrors.nameZh}>
        {(id) => (
          <Input
            id={id}
            value={form.nameZh}
            onChange={(e) => set("nameZh", e.target.value)}
          />
        )}
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Duration (days)"
          required
          error={fieldErrors.durationDays}
        >
          {(id) => (
            <Input
              id={id}
              type="number"
              min={1}
              step={1}
              value={form.durationDays}
              onChange={(e) => set("durationDays", e.target.value)}
            />
          )}
        </Field>
        <Field label="List price (MYR)" error={fieldErrors.listPriceMyr}>
          {(id) => (
            <Input
              id={id}
              inputMode="decimal"
              placeholder="e.g. 3200.00"
              value={form.listPriceMyr}
              onChange={(e) => set("listPriceMyr", e.target.value)}
            />
          )}
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.hrdcClaimable}
          onChange={(e) => set("hrdcClaimable", e.target.checked)}
        />
        HRDC claimable
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.isActive}
          onChange={(e) => set("isActive", e.target.checked)}
        />
        Active — offered on new deals and classes
      </label>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : courseId ? "Save changes" : "Add course"}
        </Button>
      </DialogFooter>
    </form>
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
  const id = `course-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-ink text-sm font-medium">
        {label}
        {required && <span className="text-danger"> *</span>}
      </label>
      {children(id)}
      {error && (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
