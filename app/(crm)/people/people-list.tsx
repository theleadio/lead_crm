"use client";

import { useCallback, useEffect, useState } from "react";
import { Toast } from "@/components/toast";
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
  LifecycleStage,
  ListResponse,
  Option,
  PersonListItem,
} from "@/lib/people/types";
import { AddPersonDialog } from "./add-person-dialog";

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

type Filters = {
  stage: string;
  language: string;
  needsReview: string;
  owner: string;
  tags: string[];
  hasOpenDeal: string;
  createdFrom: string;
  createdTo: string;
};
const NO_FILTERS: Filters = {
  stage: "",
  language: "",
  needsReview: "",
  owner: "",
  tags: [],
  hasOpenDeal: "",
  createdFrom: "",
  createdTo: "",
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; result: ListResponse<PersonListItem> };

// Same URL shape for the list and the CSV export (spec §7 filter[...]).
function filterParams(q: string, f: Filters): URLSearchParams {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  const single = [
    "stage",
    "language",
    "needsReview",
    "owner",
    "hasOpenDeal",
    "createdFrom",
    "createdTo",
  ] as const;
  for (const key of single) if (f[key]) params.set(`filter[${key}]`, f[key]);
  for (const tag of f.tags) params.append("filter[tag]", tag);
  return params;
}

export function PeopleList({
  canWrite,
  canExport,
}: {
  canWrite: boolean;
  canExport: boolean;
}) {
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [page, setPage] = useState(1);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [owners, setOwners] = useState<Option[]>([]);
  const [tags, setTags] = useState<Option[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const dismissToast = useCallback(() => setToast(null), []);
  const reload = () => setReloadKey((k) => k + 1);

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
    const load = (url: string, set: (o: Option[]) => void) =>
      fetch(url)
        .then((r) => (r.ok ? r.json() : { data: [] }))
        .then((b) => set(b.data))
        .catch(() => set([]));
    load("/api/users/options", setOwners);
    load("/api/tags", setTags);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const params = filterParams(q, filters);
    params.set("page", String(page));
    params.set("limit", String(LIMIT));

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

  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
    setSelected(new Set());
  }

  const hasFilters =
    q !== "" ||
    Object.values(filters).some((v) =>
      Array.isArray(v) ? v.length > 0 : v !== "",
    );

  function clearFilters() {
    setSearch("");
    setQ("");
    setFilters(NO_FILTERS);
    setPage(1);
    setSelected(new Set());
  }

  const rows = state.status === "ready" ? state.result.data : [];
  const allOnPageSelected =
    rows.length > 0 && rows.every((p) => selected.has(p.id));

  function toggleAll() {
    setSelected(allOnPageSelected ? new Set() : new Set(rows.map((p) => p.id)));
  }

  function toggleOne(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const columnCount = canWrite ? 9 : 8;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">People</h1>
        <div className="flex gap-2">
          {canExport && (
            <Button variant="outline" asChild>
              <a href={`/api/people/export?${filterParams(q, filters)}`}>
                Export CSV
              </a>
            </Button>
          )}
          {canWrite && (
            <Button onClick={() => setAddOpen(true)}>Add person</Button>
          )}
        </div>
      </div>

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
          label="Owner"
          value={filters.owner}
          onChange={(v) => updateFilter("owner", v)}
          options={[
            ["unassigned", "Unassigned"],
            ...owners.map((o): [string, string] => [o.id, o.label]),
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
        <TagFilter
          options={tags}
          value={filters.tags}
          onChange={(v) => updateFilter("tags", v)}
        />
        <FilterSelect
          label="Open deal"
          value={filters.hasOpenDeal}
          onChange={(v) => updateFilter("hasOpenDeal", v)}
          options={[
            ["true", "Has open deal"],
            ["false", "No open deal"],
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
        <label className="text-ink-muted flex items-center gap-2 text-sm">
          Created
          <input
            type="date"
            aria-label="Created from"
            value={filters.createdFrom}
            onChange={(e) => updateFilter("createdFrom", e.target.value)}
            className="border-input bg-surface-raised text-ink h-9 rounded-md border px-2"
          />
          to
          <input
            type="date"
            aria-label="Created to"
            value={filters.createdTo}
            onChange={(e) => updateFilter("createdTo", e.target.value)}
            className="border-input bg-surface-raised text-ink h-9 rounded-md border px-2"
          />
        </label>
        {hasFilters && (
          <Button variant="ghost" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </div>

      {canWrite && selected.size > 0 && (
        <BulkBar
          count={selected.size}
          owners={owners}
          tags={tags}
          ids={[...selected]}
          onDone={(message) => {
            setToast(message);
            setSelected(new Set());
            reload();
          }}
        />
      )}

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
              reload();
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
                {canWrite && (
                  <TableHead className="w-8">
                    <input
                      type="checkbox"
                      aria-label="Select all people on this page"
                      checked={allOnPageSelected}
                      onChange={toggleAll}
                    />
                  </TableHead>
                )}
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
                <SkeletonRows columns={columnCount} />
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={columnCount}
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
                      <>
                        No people yet. People appear here when a lead form is
                        submitted or someone is added.{" "}
                        {canWrite && (
                          <Button
                            variant="link"
                            onClick={() => setAddOpen(true)}
                          >
                            Add a person
                          </Button>
                        )}
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((p) => (
                  <PersonRow
                    key={p.id}
                    person={p}
                    selectable={canWrite}
                    selected={selected.has(p.id)}
                    onToggle={() => toggleOne(p.id)}
                  />
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
          onPage={(p) => {
            setPage(p);
            setSelected(new Set());
          }}
        />
      )}

      {canWrite && (
        <AddPersonDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          onCreated={(person) => {
            setAddOpen(false);
            setToast(
              person.needsReview
                ? `${person.fullName} added and flagged for review: ${person.needsReviewReason}.`
                : `${person.fullName} added.`,
            );
            reload();
          }}
        />
      )}

      <Toast message={toast} onDismiss={dismissToast} />
    </div>
  );
}

function BulkBar({
  count,
  ids,
  owners,
  tags,
  onDone,
}: {
  count: number;
  ids: string[];
  owners: Option[];
  tags: Option[];
  onDone: (message: string) => void;
}) {
  const [owner, setOwner] = useState("");
  const [tag, setTag] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply(
    change:
      | { kind: "assignOwner"; ownerId: string | null }
      | { kind: "addTag"; tag: string },
    describe: (updated: number) => string,
  ) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/people/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, change }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error?.message ?? "Couldn't update these people.");
        return;
      }
      onDone(describe(body.updated));
    } catch {
      setError("Couldn't save — check your connection.");
    } finally {
      setSaving(false);
    }
  }

  const ownerName = (id: string) =>
    owners.find((o) => o.id === id)?.label ?? "nobody";

  return (
    <div className="border-line bg-blue-soft flex flex-wrap items-center gap-3 rounded-md border px-4 py-2 text-sm">
      <span className="text-blue-ink font-medium">{count} selected</span>
      <select
        aria-label="Assign owner"
        value={owner}
        onChange={(e) => setOwner(e.target.value)}
        className="border-input bg-surface-raised h-8 rounded-md border px-2"
      >
        <option value="">Assign owner…</option>
        <option value="unassigned">No owner</option>
        {owners.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <Button
        size="sm"
        variant="outline"
        disabled={!owner || saving}
        onClick={() =>
          apply(
            {
              kind: "assignOwner",
              ownerId: owner === "unassigned" ? null : owner,
            },
            (n) =>
              `${n} ${n === 1 ? "person" : "people"} assigned to ${ownerName(owner)}.`,
          )
        }
      >
        Apply
      </Button>
      <select
        aria-label="Add tag"
        value={tag}
        onChange={(e) => setTag(e.target.value)}
        className="border-input bg-surface-raised h-8 rounded-md border px-2"
      >
        <option value="">Add tag…</option>
        {tags.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
      <Button
        size="sm"
        variant="outline"
        disabled={!tag || saving}
        onClick={() =>
          apply(
            { kind: "addTag", tag },
            (n) =>
              `Tag "${tag}" added to ${n} ${n === 1 ? "person" : "people"}.`,
          )
        }
      >
        Apply
      </Button>
      {error && (
        <span role="alert" className="text-danger">
          {error}
        </span>
      )}
    </div>
  );
}

function TagFilter({
  options,
  value,
  onChange,
}: {
  options: Option[];
  value: string[];
  onChange: (value: string[]) => void;
}) {
  return (
    <details className="relative">
      <summary className="border-input bg-surface-raised text-ink flex h-9 cursor-pointer list-none items-center rounded-md border px-3 text-sm">
        {value.length ? `Tags: ${value.length} selected` : "Tags: all"}
      </summary>
      <div className="border-line bg-surface-raised absolute z-10 mt-1 w-56 space-y-1 rounded-md border p-2 shadow-md">
        {options.map((o) => (
          <label key={o.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={value.includes(o.id)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...value, o.id]
                    : value.filter((t) => t !== o.id),
                )
              }
            />
            {o.label}
          </label>
        ))}
      </div>
    </details>
  );
}

function PersonRow({
  person,
  selectable,
  selected,
  onToggle,
}: {
  person: PersonListItem;
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  // Spec §11.2: WhatsApp-only contacts may have no name — show the phone.
  const displayName = person.fullName || person.phone || "Unnamed";
  const shownTags = person.tags.slice(0, 3);
  const hiddenTags = person.tags.slice(3);

  return (
    <TableRow data-state={selected ? "selected" : undefined}>
      {selectable && (
        <TableCell>
          <input
            type="checkbox"
            aria-label={`Select ${displayName}`}
            checked={selected}
            onChange={onToggle}
          />
        </TableCell>
      )}
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

function SkeletonRows({ columns }: { columns: number }) {
  return Array.from({ length: 8 }, (_, i) => (
    <TableRow key={i}>
      {Array.from({ length: columns }, (_, j) => (
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
