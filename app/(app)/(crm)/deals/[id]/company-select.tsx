"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import type { CompanyListItem } from "@/lib/companies/types";
import type { ListResponse } from "@/lib/people/types";

// Spec §9.6 company field. Unlike the 9.2 picker, this one does NOT save on
// its own: a deal's company is `deal.company_id`, set by PATCH with the rest
// of the form, not a company_membership row. So it only reports the chosen
// id upward and the Save button writes it.
//
// Creating a company stays on 9.4 — a deal screen is the wrong place to
// mint one, and §12.5 only needs the deal pointed at an existing company.

export function CompanySelect({
  value,
  currentName,
  disabled,
  onChange,
}: {
  // The company id currently in the form, or "" for none.
  value: string;
  // The name of the deal's saved company, so it can be shown before any search.
  currentName: string | null;
  disabled?: boolean;
  onChange: (companyId: string, name: string | null) => void;
}) {
  const [q, setQ] = useState("");
  // Results carry the term they belong to, so "is this stale?" and "are we
  // still searching?" are read during render instead of kept in their own
  // state and written from the effect.
  const [found, setFound] = useState<{
    term: string;
    items: CompanyListItem[];
    error: string | null;
  } | null>(null);
  // The label for whatever is selected — the saved name, or the one just picked.
  const [chosenName, setChosenName] = useState(currentName);

  const term = q.trim();
  const searching = term.length >= 2;
  const results = found && found.term === term ? found : null;

  // Debounced like the 9.1 search (§9.1: 300ms).
  useEffect(() => {
    if (term.length < 2) return;
    let ignore = false;
    const timer = setTimeout(() => {
      fetch(`/api/companies?q=${encodeURIComponent(term)}&limit=10`)
        .then(async (res) => {
          const body = (await res.json()) as ListResponse<CompanyListItem> & {
            error?: { message?: string };
          };
          if (ignore) return;
          setFound({
            term,
            items: res.ok ? body.data : [],
            error: res.ok
              ? null
              : (body.error?.message ?? "Couldn't search companies."),
          });
        })
        .catch(() => {
          if (ignore) return;
          setFound({
            term,
            items: [],
            error: "Couldn't search companies — check your connection.",
          });
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      ignore = true;
    };
  }, [term]);

  function pick(company: CompanyListItem) {
    setChosenName(company.legalName);
    onChange(company.id, company.legalName);
    setQ("");
  }

  function clear() {
    setChosenName(null);
    onChange("", null);
    setQ("");
  }

  return (
    <div className="space-y-2">
      {value ? (
        <div className="border-line bg-surface flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
          <span>{chosenName ?? "Selected company"}</span>
          {!disabled && (
            <button
              type="button"
              onClick={clear}
              className="text-ink-muted shrink-0 text-xs underline"
            >
              Remove
            </button>
          )}
        </div>
      ) : (
        <p className="text-ink-muted text-sm">No company</p>
      )}

      {!disabled && (
        <>
          <Input
            id="companyId"
            type="search"
            value={q}
            placeholder={value ? "Search to replace…" : "Search companies…"}
            onChange={(e) => setQ(e.target.value)}
            aria-describedby="company-select-hint"
          />
          <p id="company-select-hint" className="text-ink-muted text-xs">
            {searching && !results
              ? "Searching…"
              : "Type at least 2 letters. Saved with the form. New companies are added on the Companies screen."}
          </p>

          {results?.error && (
            <p role="alert" className="text-danger text-xs">
              {results.error}
            </p>
          )}

          {results && !results.error && results.items.length === 0 && (
            <p className="text-ink-muted text-xs">
              No companies match “{term}”.
            </p>
          )}

          {results && results.items.length > 0 && (
            <ul className="border-line divide-line max-h-48 divide-y overflow-auto rounded-md border">
              {results.items.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => pick(c)}
                    className="hover:bg-surface-sunken focus-visible:outline-focus-ring w-full px-3 py-2 text-left text-sm focus-visible:outline-2 focus-visible:-outline-offset-2"
                  >
                    <span className="block">{c.legalName}</span>
                    {c.industry && (
                      <span className="text-ink-muted block text-xs">
                        {c.industry}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
