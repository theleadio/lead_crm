"use client";

import { DateField } from "@/components/date-field";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  EmptyRow,
  FilterRow,
  FilterSelect,
  ListError,
  ListHeader,
  SortableHead,
  Pagination,
  SkeletonRows,
  TableCard,
} from "@/components/list-kit";
import { Toast } from "@/components/toast";
import { NO_FILTERS, type Filters } from "./filters";
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
import { formatDate, formatLastActivity } from "@/lib/format/date";
import { displayName } from "@/lib/people/types";
import type {
  LifecycleStage,
  ListResponse,
  OwnerOption,
  TagOption,
  PeopleSort,
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
  initialQ,
  initialFilters = NO_FILTERS,
  initial,
  canWrite,
  canExport,
  canAdd,
}: {
  initialQ: string;
  // Filters the server already applied to `initial` — a deep link such as
  // Home's "People to review" (§9.0) opens the list on them.
  initialFilters?: Filters;
  initial: ListResponse<PersonListItem> | null;
  canWrite: boolean;
  canExport: boolean;
  canAdd: boolean;
}) {
  const [search, setSearch] = useState(initialQ);
  const [q, setQ] = useState(initialQ);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<PeopleSort | undefined>(undefined);
  const [state, setState] = useState<LoadState>(
    initial ? { status: "ready", result: initial } : { status: "loading" },
  );

  const [reloadKey, setReloadKey] = useState(0);
  // True until we fetch once. Without it, going back to the server's query
  // (clearing the search box) skips the fetch and leaves the old rows up.
  const showingInitial = useRef(true);
  const [owners, setOwners] = useState<OwnerOption[]>([]);
  const [tags, setTags] = useState<TagOption[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Bulk assign/tag is a mode, not a standing column: the checkboxes only
  // appear after "Assign owner", and while they are up a row click ticks
  // the person instead of opening them, so a near miss never navigates.
  const [selecting, setSelecting] = useState(false);
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

  // Keep ?q= in the URL so reload and sharing work. replaceState, not
  // router.replace: the page is keyed by its q, and a server round trip per
  // keystroke would remount the list and drop focus.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (q) url.searchParams.set("q", q);
    else url.searchParams.delete("q");
    window.history.replaceState(null, "", url);
  }, [q]);

  // Spec §11.2: lists refetch on window focus — records change underneath.
  useEffect(() => {
    const onFocus = () => setReloadKey((k) => k + 1);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  useEffect(() => {
    const load = <T,>(url: string, set: (o: T[]) => void) =>
      fetch(url)
        .then((r) => (r.ok ? r.json() : { data: [] }))
        .then((b) => set(b.data))
        .catch(() => set([]));
    load("/api/users/options", setOwners);
    load("/api/tags", setTags);
  }, []);

  useEffect(() => {
    // React's ignore flag, not AbortController: aborting mid-read errors the
    // response body stream, and that rejection reaches no catch of ours
    // ("Uncaught (in promise) AbortError" in dev). A late response is simply
    // dropped instead.
    // The server rendered exactly this query into `initial`; only refetch
    // once something moves off it.
    if (
      initial &&
      showingInitial.current &&
      reloadKey === 0 &&
      q === initialQ &&
      filters === initialFilters &&
      page === 1 &&
      !sort
    )
      return;
    showingInitial.current = false;
    let ignore = false;
    const params = filterParams(q, filters);
    if (sort) params.set("sort", sort);
    params.set("page", String(page));
    params.set("limit", String(LIMIT));

    fetch(`/api/people?${params}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok)
          throw new Error(body.error?.message ?? "Couldn't load people.");
        if (!ignore) setState({ status: "ready", result: body });
      })
      .catch((err: Error) => {
        if (ignore) return;
        setState({
          status: "error",
          message:
            err instanceof TypeError
              ? "Couldn't load people — check your connection."
              : err.message,
        });
      });
    return () => {
      ignore = true;
    };
  }, [initial, initialQ, initialFilters, q, filters, sort, page, reloadKey]);

  function changeSort(next: string) {
    setSort(next as PeopleSort);
    setPage(1);
    setSelected(new Set());
  }

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

  // Name (with phone and email under it), language, stage, owner, last
  // activity, created, tags (+ the select column for roles that may write).
  const columnCount = selecting ? 8 : 7;

  function stopSelecting() {
    setSelecting(false);
    setSelected(new Set());
  }

  return (
    <div className="space-y-4">
      <ListHeader title="People">
        {canExport && (
          <Button variant="outline" asChild>
            <a href={`/api/people/export?${filterParams(q, filters)}`}>
              Export CSV
            </a>
          </Button>
        )}
        {canWrite && !selecting && (
          <Button variant="outline" onClick={() => setSelecting(true)}>
            Assign owner
          </Button>
        )}
        {canAdd && <Button onClick={() => setAddOpen(true)}>Add person</Button>}
      </ListHeader>

      <FilterRow>
        <Input
          type="search"
          aria-label="Search people"
          placeholder="Search name, email or phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full sm:w-72"
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
            ...owners.map((o): [string, string] => [o.id, o.fullName]),
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
          <DateField
            aria-label="Created from"
            value={filters.createdFrom}
            onChange={(v) => updateFilter("createdFrom", v)}
            className="w-40"
          />
          to
          <DateField
            aria-label="Created to"
            value={filters.createdTo}
            onChange={(v) => updateFilter("createdTo", v)}
            className="w-40"
          />
        </label>
        {hasFilters && (
          <Button variant="ghost" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </FilterRow>

      {canWrite && selecting && (
        <BulkBar
          count={selected.size}
          owners={owners}
          tags={tags}
          ids={[...selected]}
          onDone={(message) => {
            setToast(message);
            stopSelecting();
            reload();
          }}
          onClose={stopSelecting}
        />
      )}

      {state.status === "error" ? (
        <ListError
          message={state.message}
          onRetry={() => {
            setState({ status: "loading" });
            reload();
          }}
        />
      ) : (
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                {selecting && (
                  <TableHead className="w-8">
                    <input
                      type="checkbox"
                      aria-label="Select all people on this page"
                      checked={allOnPageSelected}
                      onChange={toggleAll}
                    />
                  </TableHead>
                )}
                <SortableHead
                  label="Name"
                  column="name"
                  sort={sort}
                  onSort={changeSort}
                />
                <TableHead>Language</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Owner</TableHead>
                <SortableHead
                  label="Last activity"
                  column="lastActivity"
                  sort={sort}
                  onSort={changeSort}
                />
                <SortableHead
                  label="Created"
                  column="created"
                  sort={sort}
                  onSort={changeSort}
                />
                <TableHead>Tags</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {state.status === "loading" ? (
                <SkeletonRows columns={columnCount} />
              ) : rows.length === 0 ? (
                <EmptyRow columns={columnCount}>
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
                      {canAdd && (
                        <Button variant="link" onClick={() => setAddOpen(true)}>
                          Add a person
                        </Button>
                      )}
                    </>
                  )}
                </EmptyRow>
              ) : (
                rows.map((p) => (
                  <PersonRow
                    key={p.id}
                    person={p}
                    selectable={selecting}
                    selected={selected.has(p.id)}
                    onToggle={() => toggleOne(p.id)}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </TableCard>
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

      {canAdd && (
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
  onClose,
}: {
  count: number;
  ids: string[];
  owners: OwnerOption[];
  tags: TagOption[];
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const [owner, setOwner] = useState("");
  const [tag, setTag] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply(
    change:
      | { action: "assign_owner"; ownerId: string | null }
      | { action: "add_tag"; tagId: string },
    describe: (updated: number) => string,
  ) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/people/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personIds: ids, ...change }),
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
    owners.find((o) => o.id === id)?.fullName ?? "nobody";

  return (
    <div className="border-line bg-blue-soft flex flex-wrap items-center gap-3 rounded-md border px-4 py-2 text-sm">
      <span className="text-blue-ink font-medium">
        {count === 0
          ? "Tick the people to update"
          : `${count} ${count === 1 ? "person" : "people"} selected`}
      </span>
      <select
        aria-label="Assign owner"
        value={owner}
        onChange={(e) => setOwner(e.target.value)}
        className="border-line-strong bg-surface-sunken h-8 rounded-md border px-2"
      >
        <option value="">Assign owner…</option>
        <option value="unassigned">No owner</option>
        {owners.map((o) => (
          <option key={o.id} value={o.id}>
            {o.fullName}
          </option>
        ))}
      </select>
      <Button
        size="sm"
        variant="outline"
        disabled={!owner || !count || saving}
        onClick={() =>
          apply(
            {
              action: "assign_owner",
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
        className="border-line-strong bg-surface-sunken h-8 max-w-60 truncate rounded-md border px-2"
      >
        <option value="">Add tag…</option>
        {tags.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <Button
        size="sm"
        variant="outline"
        disabled={!tag || !count || saving}
        onClick={() =>
          apply(
            { action: "add_tag", tagId: tag },
            (n) =>
              `Tag "${tags.find((t) => t.id === tag)?.name ?? tag}" added to ${n} ${n === 1 ? "person" : "people"}.`,
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
      <Button
        size="sm"
        variant="ghost"
        className="ml-auto"
        disabled={saving}
        onClick={onClose}
      >
        Done
      </Button>
    </div>
  );
}

function TagFilter({
  options,
  value,
  onChange,
}: {
  options: TagOption[];
  value: string[];
  onChange: (value: string[]) => void;
}) {
  return (
    <details className="relative">
      <summary className="border-line-strong bg-surface-sunken text-ink flex h-9 cursor-pointer list-none items-center rounded-sm border px-3 text-sm">
        {value.length ? `Tags: ${value.length} selected` : "Tags: all"}
      </summary>
      {/* Anchored to the right edge: Tags is the last filter in the row,
          so a left-anchored panel ran past the window at 1280px. */}
      <div className="border-line bg-surface-raised absolute right-0 z-10 mt-1 w-56 space-y-1 rounded-md border p-2">
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
            {o.name}
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
  const name = displayName(person.fullName, person.phone);
  // Two tags and a count keep the column narrow enough for 1280px.
  const shownTags = person.tags.slice(0, 2);
  const hiddenTags = person.tags.slice(2);
  // Phone and email ride under the name. When the name itself fell back to
  // the phone (§11.2), the phone is not repeated.
  const contact = [person.fullName?.trim() ? person.phone : null, person.email]
    .filter(Boolean)
    .join(" · ");
  const router = useRouter();
  const href = `/people/${person.id}`;

  // Spec §9: row click opens detail. The name is a real link for keyboard
  // and middle-click; clicks on the checkbox or link aren't hijacked. While
  // selecting, the whole row ticks the person instead, and the name is plain
  // text, so nothing in the row can open the person by accident.
  return (
    <TableRow
      data-state={selected ? "selected" : undefined}
      className="cursor-pointer"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a, input, button")) return;
        if (selectable) onToggle();
        else router.push(href);
      }}
    >
      {selectable && (
        <TableCell>
          <input
            type="checkbox"
            aria-label={`Select ${name}`}
            checked={selected}
            onChange={onToggle}
            className="size-4 cursor-pointer"
          />
        </TableCell>
      )}
      {/* Same table trick as Tags: the cell owns a share of the row, so the
          contact line only shows "…" when that share is really too small. */}
      <TableCell className="w-[24%] max-w-0 font-medium">
        <span className="flex min-w-0 items-center gap-2">
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
          {selectable ? (
            <span>{name}</span>
          ) : (
            <Link href={href} className="hover:text-blue-ink truncate">
              {name}
            </Link>
          )}
        </span>
        {contact && (
          <span
            className="text-ink-muted block truncate text-xs font-normal"
            title={contact}
          >
            {contact}
          </span>
        )}
      </TableCell>
      <TableCell>{LANGUAGE_LABEL[person.preferredLanguage]}</TableCell>
      <TableCell>
        <Badge variant={STAGE_VARIANT[person.stage]} className="capitalize">
          {person.stage}
        </Badge>
      </TableCell>
      <TableCell>{person.owner?.fullName ?? "—"}</TableCell>
      <TableCell>{formatLastActivity(person.lastActivityAt)}</TableCell>
      <TableCell>{formatDate(person.createdAt)}</TableCell>
      {/* Tags get about a third of the row (a percentage width + max-width 0
          is the table trick for "fill, but never push the table wider"), so a
          tag only shows "…" when the space really runs out. */}
      <TableCell className="w-[30%] max-w-0">
        <span className="flex flex-wrap gap-1">
          {shownTags.map((tag) => (
            // A tag is a label, not a state: no status dot (dots mark
            // statuses only, 4 Nov 2026).
            <Badge
              key={tag}
              variant="outline"
              className="max-w-full before:hidden"
              title={tag}
            >
              <span className="truncate">{tag}</span>
            </Badge>
          ))}
          {hiddenTags.length > 0 && (
            <Badge
              variant="outline"
              className="before:hidden"
              title={hiddenTags.join(", ")}
            >
              +{hiddenTags.length}
            </Badge>
          )}
        </span>
      </TableCell>
    </TableRow>
  );
}
