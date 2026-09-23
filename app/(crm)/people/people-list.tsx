"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatLastActivity } from "@/lib/format/date";
import type {
  ListResponse,
  LifecycleStage,
  PersonListItem,
} from "@/lib/people/types";

const LIMIT = 25;
const LANGUAGE_LABEL = { en: "English", zh: "Chinese" } as const;
const STAGE_VARIANT: Record<
  LifecycleStage,
  "outline" | "secondary" | "default"
> = {
  lead: "outline",
  student: "secondary",
  customer: "default",
};

type Filters = { stage: string; language: string; needsReview: string };
const NO_FILTERS: Filters = { stage: "", language: "", needsReview: "" };

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; result: ListResponse<PersonListItem> };

export function PeopleList() {
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [page, setPage] = useState(1);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  // Spec §9.1: debounce search 300ms.
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // Spec §11.2: lists refetch on window focus — records change underneath.
  useEffect(() => {
    const onFocus = () => setReloadKey((k) => k + 1);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      page: String(page),
      limit: String(LIMIT),
    });
    if (q) params.set("q", q);
    if (filters.stage) params.set("filter[stage]", filters.stage);
    if (filters.language) params.set("filter[language]", filters.language);
    if (filters.needsReview)
      params.set("filter[needsReview]", filters.needsReview);

    fetch(`/api/people?${params}`, { signal: controller.signal })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok)
          throw new Error(body.error?.message ?? "Couldn't load people.");
        setState({ status: "ready", result: body });
      })
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setState({
          status: "error",
          message:
            err instanceof TypeError
              ? "Couldn't load people — check your connection."
              : err.message,
        });
      });
    return () => controller.abort();
  }, [q, filters, page, reloadKey]);

  const updateFilter = useCallback((key: keyof Filters, value: string) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  }, []);

  const hasFilters = q !== "" || Object.values(filters).some((v) => v !== "");

  function clearFilters() {
    setSearch("");
    setQ("");
    setFilters(NO_FILTERS);
    setPage(1);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          type="search"
          aria-label="Search people"
          placeholder="Search name, email or phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-72"
        />
        <FilterSelect
          label="Stage"
          value={filters.stage}
          onChange={(v) => updateFilter("stage", v)}
          options={[
            ["lead", "Lead"],
            ["student", "Student"],
            ["customer", "Customer"],
          ]}
        />
        <FilterSelect
          label="Language"
          value={filters.language}
          onChange={(v) => updateFilter("language", v)}
          options={[
            ["en", "English"],
            ["zh", "Chinese"],
          ]}
        />
        <FilterSelect
          label="Needs review"
          value={filters.needsReview}
          onChange={(v) => updateFilter("needsReview", v)}
          options={[
            ["true", "Needs review"],
            ["false", "No review needed"],
          ]}
        />
        {hasFilters && (
          <Button variant="ghost" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </div>

      {state.status === "error" ? (
        <div
          role="alert"
          className="border-danger bg-danger-soft text-danger rounded-md border p-4 text-sm"
        >
          <p>{state.message}</p>
          <Button
            variant="outline"
            className="mt-3"
            onClick={() => {
              setState({ status: "loading" });
              setReloadKey((k) => k + 1);
            }}
          >
            Retry
          </Button>
        </div>
      ) : (
        <div className="border-line bg-surface-raised rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Language</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Last activity</TableHead>
                <TableHead>Tags</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {state.status === "loading" ? (
                <SkeletonRows />
              ) : state.result.data.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="text-ink-muted py-10 text-center"
                  >
                    {hasFilters ? (
                      <>
                        No people match these filters.{" "}
                        <Button variant="link" onClick={clearFilters}>
                          Clear filters
                        </Button>
                      </>
                    ) : (
                      "No people yet. People appear here when a lead form is submitted or someone is added."
                    )}
                  </TableCell>
                </TableRow>
              ) : (
                state.result.data.map((p) => (
                  <PersonRow key={p.id} person={p} />
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {state.status === "ready" && state.result.page.total > 0 && (
        <Pagination
          page={state.result.page.page}
          limit={state.result.page.limit}
          total={state.result.page.total}
          onPage={setPage}
        />
      )}
    </div>
  );
}

function PersonRow({ person }: { person: PersonListItem }) {
  // Spec §11.2: WhatsApp-only contacts may have no name — show the phone.
  const displayName = person.fullName || person.phone || "Unnamed";
  const shownTags = person.tags.slice(0, 3);
  const hiddenTags = person.tags.slice(3);

  return (
    <TableRow>
      <TableCell className="font-medium">
        <span className="inline-flex items-center gap-2">
          {person.needsReview && (
            <span
              className="bg-warning inline-block size-2 rounded-full"
              title={person.needsReviewReason ?? "Needs review"}
            >
              <span className="sr-only">
                Needs review: {person.needsReviewReason}
              </span>
            </span>
          )}
          {displayName}
        </span>
      </TableCell>
      <TableCell>{person.phone ?? "—"}</TableCell>
      <TableCell>{person.email ?? "—"}</TableCell>
      <TableCell>{LANGUAGE_LABEL[person.preferredLanguage]}</TableCell>
      <TableCell>
        <Badge variant={STAGE_VARIANT[person.stage]} className="capitalize">
          {person.stage}
        </Badge>
      </TableCell>
      <TableCell>{person.owner?.fullName ?? "—"}</TableCell>
      <TableCell>{formatLastActivity(person.lastActivityAt)}</TableCell>
      <TableCell>
        <span className="flex flex-wrap gap-1">
          {shownTags.map((tag) => (
            <Badge key={tag} variant="outline">
              {tag}
            </Badge>
          ))}
          {hiddenTags.length > 0 && (
            <Badge variant="outline" title={hiddenTags.join(", ")}>
              +{hiddenTags.length}
            </Badge>
          )}
        </span>
      </TableCell>
    </TableRow>
  );
}

function SkeletonRows() {
  return Array.from({ length: 8 }, (_, i) => (
    <TableRow key={i}>
      {Array.from({ length: 8 }, (_, j) => (
        <TableCell key={j}>
          <div className="bg-surface-sunken h-4 w-full animate-pulse rounded-sm" />
        </TableCell>
      ))}
    </TableRow>
  ));
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="border-input bg-surface-raised text-ink focus-visible:outline-focus-ring h-9 rounded-md border px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <option value="">{label}: all</option>
      {options.map(([v, text]) => (
        <option key={v} value={v}>
          {text}
        </option>
      ))}
    </select>
  );
}

function Pagination({
  page,
  limit,
  total,
  onPage,
}: {
  page: number;
  limit: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const lastPage = Math.max(1, Math.ceil(total / limit));
  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  return (
    <div className="text-ink-muted flex items-center justify-between text-sm">
      <span>
        {from}–{to} of {total}
      </span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          disabled={page >= lastPage}
          onClick={() => onPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
