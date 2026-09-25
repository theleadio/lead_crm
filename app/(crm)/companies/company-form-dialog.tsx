"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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
import type { CompanyListItem } from "@/lib/companies/types";

export type CompanyFormValues = {
  legalName: string;
  registrationNo: string;
  industry: string;
  sizeBand: string;
  hrdcRegistered: boolean;
  billingAddress: string;
  billingEmail: string;
  ownerId: string;
};

export const EMPTY_COMPANY: CompanyFormValues = {
  legalName: "",
  registrationNo: "",
  industry: "",
  sizeBand: "",
  hrdcRegistered: false,
  billingAddress: "",
  billingEmail: "",
  ownerId: "",
};

type Owner = { id: string; fullName: string };

// Spec §9.4 (v1.5) Add company / Edit company. Before saving it shows
// "Similar companies" (same normalised name or registration no.): a warning
// with links, never a block. Used by the companies list and the 9.2 picker.
export function CompanyFormDialog({
  open,
  onOpenChange,
  companyId,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Set when editing; also excluded from the similar-companies check.
  companyId?: string;
  initial: CompanyFormValues;
  onSaved: (company: { id: string; legalName: string }) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Mounted only while open, so it starts from `initial` every time. */}
        <CompanyForm
          companyId={companyId}
          initial={initial}
          onClose={() => onOpenChange(false)}
          onSaved={onSaved}
        />
      </DialogContent>
    </Dialog>
  );
}

function CompanyForm({
  companyId,
  initial,
  onClose,
  onSaved,
}: {
  companyId?: string;
  initial: CompanyFormValues;
  onClose: () => void;
  onSaved: (company: { id: string; legalName: string }) => void;
}) {
  const [form, setForm] = useState<CompanyFormValues>(initial);
  const [owners, setOwners] = useState<Owner[]>([]);
  const [similar, setSimilar] = useState<CompanyListItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/users/options")
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((b) => setOwners(b.data))
      .catch(() => setOwners([]));
  }, []);

  useEffect(() => {
    const name = form.legalName.trim();
    const reg = form.registrationNo.trim();
    if (!name && !reg) return;
    const controller = new AbortController();
    const t = setTimeout(() => {
      const params = new URLSearchParams();
      params.set("limit", "10");
      if (name) params.set("filter[similarTo]", name);
      if (reg) params.set("filter[registrationNo]", reg);
      if (companyId) params.set("filter[excludeId]", companyId);
      fetch(`/api/companies?${params}`, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : { data: [] }))
        .then((b) => setSimilar(b.data))
        .catch(() => {});
    }, 300);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [form.legalName, form.registrationNo, companyId]);
  // Stale results are hidden, not cleared, when both fields are emptied.
  const shownSimilar =
    form.legalName.trim() || form.registrationNo.trim() ? similar : [];

  const set = <K extends keyof CompanyFormValues>(
    key: K,
    value: CompanyFormValues[K],
  ) => setForm((f) => ({ ...f, [key]: value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      const res = await fetch(
        companyId ? `/api/companies/${companyId}` : "/api/companies",
        {
          method: companyId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...form, ownerId: form.ownerId || null }),
        },
      );
      const body = await res.json();
      if (!res.ok) {
        // Spec §9 cross-screen: never lose typed input on a failed save.
        setError(body.error?.message ?? "Couldn't save this company.");
        setFieldErrors(body.error?.fields ?? {});
        return;
      }
      onSaved({ id: body.id, legalName: form.legalName.trim() });
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
    <>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <DialogHeader>
          <DialogTitle>
            {companyId ? "Edit company" : "Add company"}
          </DialogTitle>
          <DialogDescription>
            Company name is required. Similar companies are shown so you
            don&apos;t create a duplicate.
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

        <Field label="Company name" required error={fieldErrors.legalName}>
          {(id) => (
            <Input
              id={id}
              value={form.legalName}
              onChange={(e) => set("legalName", e.target.value)}
              autoFocus
            />
          )}
        </Field>
        <Field label="Registration no." error={fieldErrors.registrationNo}>
          {(id) => (
            <Input
              id={id}
              value={form.registrationNo}
              onChange={(e) => set("registrationNo", e.target.value)}
            />
          )}
        </Field>

        {shownSimilar.length > 0 && (
          <div
            role="status"
            className="border-warning bg-warning-soft text-warning rounded-md border p-3 text-sm"
          >
            <p className="font-medium">Similar companies already exist:</p>
            <ul className="mt-1 list-disc pl-5">
              {shownSimilar.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/companies/${s.id}`}
                    target="_blank"
                    className="underline"
                  >
                    {s.legalName}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-1">
              You can still save if this is a different company.
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Industry" error={fieldErrors.industry}>
            {(id) => (
              <Input
                id={id}
                value={form.industry}
                onChange={(e) => set("industry", e.target.value)}
              />
            )}
          </Field>
          <Field label="Size" error={fieldErrors.sizeBand}>
            {(id) => (
              <Input
                id={id}
                placeholder="e.g. 51-200"
                value={form.sizeBand}
                onChange={(e) => set("sizeBand", e.target.value)}
              />
            )}
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.hrdcRegistered}
            onChange={(e) => set("hrdcRegistered", e.target.checked)}
          />
          HRDC registered
        </label>
        <Field label="Billing email" error={fieldErrors.billingEmail}>
          {(id) => (
            <Input
              id={id}
              type="email"
              value={form.billingEmail}
              onChange={(e) => set("billingEmail", e.target.value)}
            />
          )}
        </Field>
        <Field label="Billing address" error={fieldErrors.billingAddress}>
          {(id) => (
            <textarea
              id={id}
              rows={2}
              value={form.billingAddress}
              onChange={(e) => set("billingAddress", e.target.value)}
              className="border-input bg-surface-raised text-ink focus-visible:outline-focus-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
            />
          )}
        </Field>
        <Field label="Owner" error={fieldErrors.ownerId}>
          {(id) => (
            <select
              id={id}
              value={form.ownerId}
              onChange={(e) => set("ownerId", e.target.value)}
              className="border-input bg-surface-raised text-ink focus-visible:outline-focus-ring h-9 w-full rounded-md border px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <option value="">Unassigned</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.fullName}
                </option>
              ))}
            </select>
          )}
        </Field>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : companyId ? "Save changes" : "Add company"}
          </Button>
        </DialogFooter>
      </form>
    </>
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
  const id = `company-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`;
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
