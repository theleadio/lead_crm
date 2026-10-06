"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ClassRecord } from "@/lib/classes/service";
import { CLASS_MODES } from "@/lib/classes/types";
import { NoticeDialog } from "./notice-dialog";

export type CourseOption = { id: string; nameEn: string; code: string };

type Values = {
  courseId: string;
  code: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  language: string;
  mode: string;
  venueName: string;
  venueAddress: string;
  city: string;
  onlineUrl: string;
  capacity: string;
  fewSeatsThreshold: string;
  priceMyr: string;
  hrdcClaimable: boolean;
};

const EMPTY: Values = {
  courseId: "",
  code: "",
  startDate: "",
  endDate: "",
  startTime: "",
  endTime: "",
  language: "en",
  mode: "in_person",
  venueName: "",
  venueAddress: "",
  city: "",
  onlineUrl: "",
  capacity: "20",
  fewSeatsThreshold: "5",
  priceMyr: "",
  hrdcClaimable: false,
};

const MODE_LABELS: Record<string, string> = {
  in_person: "In person",
  online: "Online",
  hybrid: "Hybrid — both",
};

function valuesFrom(cls: ClassRecord): Values {
  return {
    courseId: cls.courseId,
    code: cls.code,
    startDate: cls.startDate,
    endDate: cls.endDate,
    startTime: cls.startTime ?? "",
    endTime: cls.endTime ?? "",
    language: cls.language,
    mode: cls.mode,
    venueName: cls.venueName ?? "",
    venueAddress: cls.venueAddress ?? "",
    city: cls.city ?? "",
    onlineUrl: cls.onlineUrl ?? "",
    capacity: String(cls.capacity),
    fewSeatsThreshold: String(cls.fewSeatsThreshold),
    priceMyr: cls.priceMyr ?? "",
    hrdcClaimable: cls.hrdcClaimable,
  };
}

// Spec §9.9: one form for create and edit. The venue block and the joining
// link follow the mode (§5 conditional rules). `status` is not a field here —
// a new class is a draft, publishing is its own button, and §12.1 derives
// full and few_seats from the seats.
export function ClassForm({
  courses,
  existing,
}: {
  courses: CourseOption[];
  existing?: ClassRecord;
}) {
  const router = useRouter();
  const [form, setForm] = useState<Values>(
    existing ? valuesFrom(existing) : EMPTY,
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // Set when the server answers 409 notice_decision_required (§7.1).
  const [noticeFor, setNoticeFor] = useState<number | null>(null);

  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setDirty(true);
    setForm((f) => ({ ...f, [key]: value }));
  };

  // §13: never lose typed input silently.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const needsVenue = form.mode !== "online";
  const needsLink = form.mode !== "in_person";

  async function save(choice?: "prepare" | "skip") {
    setSaving(true);
    setError(null);
    setStale(false);
    setFieldErrors({});
    const body: Record<string, unknown> = {
      courseId: form.courseId,
      code: form.code,
      startDate: form.startDate,
      endDate: form.endDate,
      startTime: form.startTime || null,
      endTime: form.endTime || null,
      language: form.language,
      mode: form.mode,
      // A field the mode doesn't use is cleared, not left behind to confuse
      // the next reader (§5 allows null for both).
      venueName: needsVenue ? form.venueName : null,
      venueAddress: needsVenue ? form.venueAddress : null,
      city: needsVenue ? form.city : null,
      onlineUrl: needsLink ? form.onlineUrl : null,
      capacity: Number(form.capacity),
      fewSeatsThreshold: Number(form.fewSeatsThreshold),
      priceMyr: form.priceMyr.trim() || null,
      hrdcClaimable: form.hrdcClaimable,
    };
    if (choice) body.notice = choice;

    try {
      const res = await fetch(
        existing ? `/api/classes/${existing.id}` : "/api/classes",
        {
          method: existing ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
            // §7 (v1.7): only an edit carries a version.
            ...(existing ? { "If-Match": String(existing.version) } : {}),
          },
          body: JSON.stringify(body),
        },
      );
      const payload = await res.json();
      if (!res.ok) {
        // §7.1: not a failure to fix — the one question the save has to ask.
        if (payload.error?.code === "notice_decision_required") {
          setNoticeFor(payload.error.recipientCount ?? 0);
          return;
        }
        setError(payload.error?.message ?? "Couldn't save this class.");
        setFieldErrors(payload.error?.fields ?? {});
        setStale(payload.error?.code === "stale_edit");
        setNoticeFor(null);
        return;
      }
      setDirty(false);
      router.push("/classes");
      router.refresh();
    } catch {
      setError(
        "Couldn't save — check your connection. Your changes are still here.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">
        {existing ? `Edit ${existing.code}` : "Add class"}
      </h1>

      {error && (
        <div
          role="alert"
          className="bg-danger-soft text-danger space-y-2 rounded-md p-3 text-sm"
        >
          <p>{error}</p>
          {stale && (
            <Button
              type="button"
              variant="outline"
              onClick={() => router.refresh()}
            >
              Reload this class
            </Button>
          )}
        </div>
      )}

      <form
        noValidate
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Course" required error={fieldErrors.courseId}>
            {(id) => (
              <Select
                id={id}
                value={form.courseId}
                onChange={(v) => set("courseId", v)}
                options={[
                  ["", "Pick a course"],
                  ...courses.map(
                    (c) =>
                      [c.id, `${c.code} — ${c.nameEn}`] as [string, string],
                  ),
                ]}
              />
            )}
          </Field>
          <Field label="Class code" required error={fieldErrors.code}>
            {(id) => (
              <Input
                id={id}
                value={form.code}
                placeholder="e.g. AIA-2610-EN"
                onChange={(e) => set("code", e.target.value)}
              />
            )}
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Start date" required error={fieldErrors.startDate}>
            {(id) => (
              <Input
                id={id}
                type="date"
                value={form.startDate}
                onChange={(e) => set("startDate", e.target.value)}
              />
            )}
          </Field>
          <Field label="End date" required error={fieldErrors.endDate}>
            {(id) => (
              <Input
                id={id}
                type="date"
                value={form.endDate}
                onChange={(e) => set("endDate", e.target.value)}
              />
            )}
          </Field>
          <Field label="Start time" error={fieldErrors.startTime}>
            {(id) => (
              <Input
                id={id}
                type="time"
                value={form.startTime}
                onChange={(e) => set("startTime", e.target.value)}
              />
            )}
          </Field>
          <Field label="End time" error={fieldErrors.endTime}>
            {(id) => (
              <Input
                id={id}
                type="time"
                value={form.endTime}
                onChange={(e) => set("endTime", e.target.value)}
              />
            )}
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Language" required error={fieldErrors.language}>
            {(id) => (
              <Select
                id={id}
                value={form.language}
                onChange={(v) => set("language", v)}
                options={[
                  ["en", "English"],
                  ["zh", "中文"],
                ]}
              />
            )}
          </Field>
          <Field label="How it runs" required error={fieldErrors.mode}>
            {(id) => (
              <Select
                id={id}
                value={form.mode}
                onChange={(v) => set("mode", v)}
                options={CLASS_MODES.map(
                  (m) => [m, MODE_LABELS[m]] as [string, string],
                )}
              />
            )}
          </Field>
        </div>

        {needsVenue && (
          <div className="border-line space-y-3 rounded-md border p-3">
            <Field label="Venue name" required error={fieldErrors.venueName}>
              {(id) => (
                <Input
                  id={id}
                  value={form.venueName}
                  onChange={(e) => set("venueName", e.target.value)}
                />
              )}
            </Field>
            <Field
              label="Venue address"
              required
              error={fieldErrors.venueAddress}
            >
              {(id) => (
                <Input
                  id={id}
                  value={form.venueAddress}
                  onChange={(e) => set("venueAddress", e.target.value)}
                />
              )}
            </Field>
            <Field label="City" required error={fieldErrors.city}>
              {(id) => (
                <Input
                  id={id}
                  value={form.city}
                  onChange={(e) => set("city", e.target.value)}
                />
              )}
            </Field>
          </div>
        )}

        {needsLink && (
          <Field label="Joining link" required error={fieldErrors.onlineUrl}>
            {(id) => (
              <Input
                id={id}
                value={form.onlineUrl}
                placeholder="https://…"
                onChange={(e) => set("onlineUrl", e.target.value)}
              />
            )}
          </Field>
        )}
        {needsLink && (
          <p className="text-ink-muted text-sm">
            The joining link is never shown on the website — it goes out with
            the onboarding message.
          </p>
        )}

        <div className="grid grid-cols-3 gap-3">
          <Field label="Capacity" required error={fieldErrors.capacity}>
            {(id) => (
              <Input
                id={id}
                type="number"
                min={1}
                step={1}
                value={form.capacity}
                onChange={(e) => set("capacity", e.target.value)}
              />
            )}
          </Field>
          <Field label="Few seats below" error={fieldErrors.fewSeatsThreshold}>
            {(id) => (
              <Input
                id={id}
                type="number"
                min={0}
                step={1}
                value={form.fewSeatsThreshold}
                onChange={(e) => set("fewSeatsThreshold", e.target.value)}
              />
            )}
          </Field>
          <Field label="Price (MYR)" error={fieldErrors.priceMyr}>
            {(id) => (
              <Input
                id={id}
                inputMode="decimal"
                placeholder="Course list price"
                value={form.priceMyr}
                onChange={(e) => set("priceMyr", e.target.value)}
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

        {!existing && (
          <p className="text-ink-muted text-sm">
            A new class is saved as a draft and stays off the website until you
            publish it.
          </p>
        )}

        <div className="flex gap-2">
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : existing ? "Save changes" : "Add class"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push("/classes")}
          >
            Cancel
          </Button>
        </div>
      </form>

      <NoticeDialog
        recipientCount={noticeFor}
        saving={saving}
        onChoose={(choice) => {
          setNoticeFor(null);
          save(choice);
        }}
        onCancel={() => setNoticeFor(null)}
      />
    </div>
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
  const id = `class-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`;
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

function Select({
  id,
  value,
  onChange,
  options,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="border-line-strong bg-surface-sunken text-ink focus-visible:outline-focus-ring h-9 w-full rounded-sm border px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      {options.map(([v, text]) => (
        <option key={v} value={v}>
          {text}
        </option>
      ))}
    </select>
  );
}
