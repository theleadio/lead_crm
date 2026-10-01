"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CompanyListItem } from "@/lib/companies/types";
import type { ListResponse } from "@/lib/people/types";
import {
  CompanyFormDialog,
  EMPTY_COMPANY,
} from "../../companies/company-form-dialog";

type Current = { id: string; name: string } | null;

// Spec §9.2 company field: a picker, not free text. Choosing a company
// attaches it with POST /api/companies/:id/members and replaceCurrent, so
// the old membership ends and the new one starts in one transaction. It
// saves on its own (not with the Save button), so unsaved form fields are
// never touched. "Create company" opens the 9.4 Add company dialog with the
// typed name prefilled. If the person has no company but typed one on a
// public form, "From form: <text>" offers a Link button that searches it.
export function CompanyPicker({
  personId,
  jobTitle,
  current,
  givenName,
  canWrite,
  onChanged,
}: {
  personId: string;
  jobTitle: string;
  current: Current;
  givenName: string | null;
  canWrite: boolean;
  onChanged: (message: string) => void;
}) {
  const [company, setCompany] = useState(current);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CompanyListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const t = setTimeout(() => {
      const params = new URLSearchParams({ limit: "8" });
      if (q.trim()) params.set("q", q.trim());
      fetch(`/api/companies?${params}`, { signal: controller.signal })
        .then(async (res) => {
          const body = await res.json();
          if (!res.ok) throw new Error(body.error?.message);
          setResults((body as ListResponse<CompanyListItem>).data);
        })
        .catch((err: Error) => {
          if (err.name !== "AbortError")
            setError(err.message || "Couldn't load companies.");
        });
    }, 300);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [open, q]);

  async function attach(id: string, name: string) {
    setError(null);
    const res = await fetch(`/api/companies/${id}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        personId,
        jobTitle: jobTitle.trim() || undefined,
        replaceCurrent: true,
      }),
    });
    if (!res.ok) {
      setError(
        (await res.json()).error?.message ?? "Couldn't change the company.",
      );
      return;
    }
    setCompany({ id, name });
    setOpen(false);
    setQ("");
    onChanged(`Company is now ${name}.`);
  }

  function openPicker(search: string) {
    setQ(search);
    setOpen(true);
  }

  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {company ? (
          <Link
            id="company"
            href={`/companies/${company.id}`}
            className="text-blue-ink underline"
          >
            {company.name}
          </Link>
        ) : (
          <span id="company" className="text-ink-muted">
            None
          </span>
        )}
        {canWrite && !open && (
          <Button
            type="button"
            variant="outline"
            onClick={() => openPicker("")}
          >
            {company ? "Switch company" : "Choose company"}
          </Button>
        )}
      </div>

      {canWrite && !company && givenName && !open && (
        <p className="text-ink-muted flex flex-wrap items-center gap-2">
          From form: {givenName}
          <Button
            type="button"
            variant="link"
            onClick={() => openPicker(givenName)}
          >
            Link
          </Button>
        </p>
      )}

      {open && (
        <div className="border-line space-y-2 rounded-md border p-3">
          <Input
            type="search"
            autoFocus
            aria-label="Search companies"
            placeholder="Search by company name…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {error && (
            <p role="alert" className="text-danger">
              {error}
            </p>
          )}
          {results && results.length === 0 && (
            <p className="text-ink-muted">No companies match.</p>
          )}
          <ul>
            {results?.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => attach(c.id, c.legalName)}
                  className="hover:bg-surface-sunken focus-visible:outline-focus-ring w-full rounded-sm px-2 py-1.5 text-left focus-visible:outline-2"
                >
                  {c.legalName}
                  {c.industry && (
                    <span className="text-ink-muted"> · {c.industry}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreateOpen(true)}
            >
              {q.trim() ? `Create company “${q.trim()}”` : "Create company"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      <CompanyFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        initial={{ ...EMPTY_COMPANY, legalName: q.trim() }}
        onSaved={(c) => attach(c.id, c.legalName)}
      />
    </div>
  );
}
