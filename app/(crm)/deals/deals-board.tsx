"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  FilterRow,
  FilterSelect,
  ListError,
  ListHeader,
} from "@/components/list-kit";
import { Toast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addMyr } from "@/lib/deals/format";
import {
  STAGE_LABELS,
  STAGES,
  type CourseOption,
  type DealCard as Deal,
  type DealListResponse,
  type Pipeline,
  type Stage,
  type StageTotal,
} from "@/lib/deals/types";
import { formatMoneyMyr } from "@/lib/format/money";
import type { OwnerOption } from "@/lib/people/types";
import { DealCard } from "./deal-card";
import { LostReasonDialog } from "./lost-reason-dialog";

export type BoardFilters = {
  pipeline: Pipeline;
  owner: string;
  course: string;
  funding: string;
  from: string;
  to: string;
  mine: boolean;
};

const PER_COLUMN = 50;
const FUNDING: [string, string][] = [
  ["self", "Self"],
  ["company", "Company"],
  ["hrdc", "HRDC"],
  ["other", "Other"],
];

type Board =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      columns: Partial<Record<Stage, Deal[]>>;
      totals: StageTotal[];
    };

async function fetchDeals(
  f: BoardFilters,
  extra: Record<string, string>,
  signal?: AbortSignal,
): Promise<DealListResponse> {
  const p = new URLSearchParams({ "filter[pipeline]": f.pipeline, ...extra });
  if (f.owner) p.set("filter[owner]", f.owner);
  if (f.course) p.set("filter[course]", f.course);
  if (f.funding) p.set("filter[funding]", f.funding);
  if (f.from) p.set("filter[createdFrom]", f.from);
  if (f.to) p.set("filter[createdTo]", f.to);
  if (f.mine) p.set("filter[mine]", "true");
  let res: Response;
  try {
    res = await fetch(`/api/deals?${p}`, { signal });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new Error("Couldn't load deals — check your connection.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? "Couldn't load deals.");
  return body;
}

const byStageAge = (a: Deal, b: Deal) =>
  a.stageChangedAt.localeCompare(b.stageChangedAt) || a.id.localeCompare(b.id);

// Puts `card` in the column of card.stage, wherever it was before, keeping
// the server's order (oldest in stage first). Used for the optimistic move,
// the revert, and the server's answer. Header totals follow the card.
function placeCard(board: Board, card: Deal): Board {
  if (board.status !== "ready") return board;
  let old: Deal | undefined;
  const columns: Partial<Record<Stage, Deal[]>> = {};
  for (const [stage, cards] of Object.entries(board.columns)) {
    old ??= cards.find((c) => c.id === card.id);
    columns[stage as Stage] = cards.filter((c) => c.id !== card.id);
  }
  columns[card.stage] = [...(columns[card.stage] ?? []), card].sort(byStageAge);
  const totals =
    old && old.stage !== card.stage
      ? board.totals.map((t) =>
          t.stage === old!.stage
            ? {
                ...t,
                count: t.count - 1,
                totalMyr: addMyr(t.totalMyr, old!.amountMyr, -1),
              }
            : t.stage === card.stage
              ? {
                  ...t,
                  count: t.count + 1,
                  totalMyr: addMyr(t.totalMyr, card.amountMyr, 1),
                }
              : t,
        )
      : board.totals;
  return { ...board, columns, totals };
}

// Spec §9.5 Deals board: one tab per pipeline, a column per stage with
// count and value from stageTotals (§7.1), drag or "Move to…" to change
// stage through POST /api/deals/:id/stage.
export function DealsBoard({
  initial,
  canWrite,
}: {
  initial: BoardFilters;
  canWrite: boolean;
}) {
  const [filters, setFilters] = useState(initial);
  const [board, setBoard] = useState<Board>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [dragging, setDragging] = useState<Deal | null>(null);
  const [dropTarget, setDropTarget] = useState<Stage | null>(null);
  const [lostFor, setLostFor] = useState<Deal | null>(null);
  const [loadingMore, setLoadingMore] = useState<Stage | null>(null);
  const [owners, setOwners] = useState<OwnerOption[]>([]);
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [toast, setToast] = useState<React.ReactNode | null>(null);
  const dismissToast = useCallback(() => setToast(null), []);
  const filtersRef = useRef(filters);
  const busyRef = useRef(busy);
  useEffect(() => {
    filtersRef.current = filters;
    busyRef.current = busy;
  });

  const stages = STAGES[filters.pipeline];

  // Filter options. A failure only leaves a select empty.
  useEffect(() => {
    const load = <T,>(url: string, set: (v: T[]) => void) =>
      fetch(url)
        .then((r) => (r.ok ? r.json() : { data: [] }))
        .then((b) => set(b.data))
        .catch(() => {});
    load("/api/users/options", setOwners);
    load("/api/courses/options", setCourses);
  }, []);

  // One request per column (design decision 2). Every response carries the
  // same stageTotals; any failure shows the error, never empty columns.
  useEffect(() => {
    const controller = new AbortController();
    const cols = STAGES[filters.pipeline];
    Promise.all(
      cols.map((stage) =>
        fetchDeals(
          filters,
          { "filter[stage]": stage, limit: String(PER_COLUMN) },
          controller.signal,
        ),
      ),
    )
      .then((results) =>
        setBoard({
          status: "ready",
          columns: Object.fromEntries(
            cols.map((stage, i) => [stage, results[i].data]),
          ),
          totals: results[0].stageTotals,
        }),
      )
      .catch((err: Error) => {
        if (!controller.signal.aborted)
          setBoard({ status: "error", message: err.message });
      });
    return () => controller.abort();
  }, [filters, reloadKey]);

  // Filters live in the URL so reload and sharing work (design decision 8).
  useEffect(() => {
    const url = new URL(window.location.href);
    const set = (k: string, v: string) =>
      v ? url.searchParams.set(k, v) : url.searchParams.delete(k);
    set("pipeline", filters.pipeline);
    set("owner", filters.owner);
    set("course", filters.course);
    set("funding", filters.funding);
    set("from", filters.from);
    set("to", filters.to);
    set("mine", filters.mine ? "1" : "0");
    window.history.replaceState(null, "", url);
  }, [filters]);

  // Spec §11.2: lists refetch on window focus — but not mid-move.
  useEffect(() => {
    const onFocus = () => {
      if (busyRef.current.size === 0) setReloadKey((k) => k + 1);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const update = (patch: Partial<BoardFilters>) => {
    setBoard({ status: "loading" });
    setFilters((f) => ({ ...f, ...patch }));
  };
  const hasFilters = Boolean(
    filters.owner ||
    filters.course ||
    filters.funding ||
    filters.from ||
    filters.to ||
    filters.mine,
  );
  const clearFilters = () =>
    update({
      owner: "",
      course: "",
      funding: "",
      from: "",
      to: "",
      mine: false,
    });

  // After each move the headers are re-read from the server; the cards are
  // left alone so nothing jumps under the cursor (design decision 4).
  const refreshTotals = () => {
    const f = filtersRef.current;
    fetchDeals(f, { limit: "1" })
      .then((r) => {
        if (filtersRef.current === f)
          setBoard((b) =>
            b.status === "ready" ? { ...b, totals: r.stageTotals } : b,
          );
      })
      .catch(() => {});
  };

  async function move(card: Deal, toStage: Stage, lostReasonId?: string) {
    if (toStage === card.stage || busyRef.current.has(card.id)) return;
    const label = STAGE_LABELS[toStage];
    setBusy((s) => new Set(s).add(card.id));
    setBoard((b) =>
      placeCard(b, {
        ...card,
        stage: toStage,
        stageChangedAt: new Date().toISOString(),
      }),
    );
    try {
      const res = await fetch(`/api/deals/${card.id}/stage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toStage, lostReasonId }),
      });
      const body = await res.json().catch(() => null);
      if (res.ok) {
        setBoard((b) => placeCard(b, body));
        setToast(`Moved ${card.person.fullName} to ${label}.`);
      } else {
        setBoard((b) => placeCard(b, card));
        const message =
          body?.error?.message ?? `Couldn't move the deal to ${label}.`;
        setToast(
          body?.error?.missing ? (
            <>
              {message}{" "}
              <Link href={`/deals/${card.id}`} className="underline">
                Open deal
              </Link>
            </>
          ) : (
            message
          ),
        );
      }
    } catch {
      setBoard((b) => placeCard(b, card));
      setToast("Couldn't move the deal — check your connection.");
    } finally {
      setBusy((s) => {
        const next = new Set(s);
        next.delete(card.id);
        return next;
      });
      refreshTotals();
    }
  }

  // Lost first asks for a reason; cancelling sends nothing.
  const requestMove = (card: Deal, toStage: Stage) => {
    if (toStage === card.stage || busyRef.current.has(card.id)) return;
    if (toStage === "lost") setLostFor(card);
    else move(card, toStage);
  };

  // ponytail: page = loaded / 50 + 1, deduped by id. Moves shift offsets, so
  // a card can be skipped until the next reload; switch to a keyset cursor
  // if columns routinely exceed 50.
  async function loadMore(stage: Stage, loaded: number) {
    setLoadingMore(stage);
    try {
      const r = await fetchDeals(filters, {
        "filter[stage]": stage,
        limit: String(PER_COLUMN),
        page: String(Math.floor(loaded / PER_COLUMN) + 1),
      });
      setBoard((b) => {
        if (b.status !== "ready") return b;
        const have = b.columns[stage] ?? [];
        const ids = new Set(have.map((c) => c.id));
        return {
          ...b,
          columns: {
            ...b.columns,
            [stage]: [...have, ...r.data.filter((c) => !ids.has(c.id))],
          },
        };
      });
    } catch (err) {
      setToast((err as Error).message);
    } finally {
      setLoadingMore(null);
    }
  }

  const ready = board.status === "ready" ? board : null;
  const allEmpty = ready?.totals.every((t) => t.count === 0);

  return (
    <div className="space-y-4">
      <ListHeader title="Deals" />

      <div
        role="tablist"
        aria-label="Pipeline"
        className="border-line flex gap-1 border-b"
      >
        {(["individual", "corporate"] as const).map((p) => (
          <button
            key={p}
            role="tab"
            type="button"
            aria-selected={filters.pipeline === p}
            onClick={() => filters.pipeline !== p && update({ pipeline: p })}
            className={`focus-visible:outline-focus-ring -mb-px border-b-2 px-4 py-2 text-sm font-medium focus-visible:outline-2 ${
              filters.pipeline === p
                ? "border-lead-yellow text-ink"
                : "text-ink-muted hover:text-ink border-transparent"
            }`}
          >
            {p === "individual" ? "Individual" : "Corporate"}
          </button>
        ))}
      </div>

      <FilterRow>
        <FilterSelect
          label="Owner"
          value={filters.owner}
          onChange={(owner) => update({ owner })}
          options={owners.map((o) => [o.id, o.fullName])}
        />
        <FilterSelect
          label="Course"
          value={filters.course}
          onChange={(course) => update({ course })}
          options={courses.map((c) => [c.id, c.name])}
        />
        <FilterSelect
          label="Funding"
          value={filters.funding}
          onChange={(funding) => update({ funding })}
          options={FUNDING}
        />
        <label className="text-ink-muted flex items-center gap-2 text-sm">
          Created
          <Input
            type="date"
            aria-label="Created from"
            value={filters.from}
            max={filters.to || undefined}
            onChange={(e) => update({ from: e.target.value })}
            className="w-40"
          />
          to
          <Input
            type="date"
            aria-label="Created to"
            value={filters.to}
            min={filters.from || undefined}
            onChange={(e) => update({ to: e.target.value })}
            className="w-40"
          />
        </label>
        <label className="text-ink flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={filters.mine}
            onChange={(e) => update({ mine: e.target.checked })}
            className="size-4"
          />
          My deals
        </label>
        {hasFilters && (
          <Button variant="ghost" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </FilterRow>

      {board.status === "error" ? (
        <ListError
          message={board.message}
          onRetry={() => {
            setBoard({ status: "loading" });
            setReloadKey((k) => k + 1);
          }}
        />
      ) : (
        <>
          {allEmpty && (
            <p className="text-ink-muted text-sm">
              {hasFilters ? (
                <>
                  No deals match these filters.{" "}
                  <Button variant="link" onClick={clearFilters}>
                    Clear filters
                  </Button>
                </>
              ) : (
                "No deals in this pipeline yet. Deals come from the website, enquiries and person records."
              )}
            </p>
          )}
          <div className="grid auto-cols-[minmax(15rem,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2">
            {stages.map((stage) => {
              const total = ready?.totals.find((t) => t.stage === stage);
              const cards = ready?.columns[stage] ?? [];
              const canDrop =
                canWrite && dragging !== null && dragging.stage !== stage;
              return (
                <section
                  key={stage}
                  aria-label={STAGE_LABELS[stage]}
                  onDragOver={(e) => {
                    if (!canDrop) return;
                    e.preventDefault();
                    setDropTarget(stage);
                  }}
                  onDragLeave={() =>
                    setDropTarget((t) => (t === stage ? null : t))
                  }
                  onDrop={(e) => {
                    e.preventDefault();
                    setDropTarget(null);
                    if (dragging) requestMove(dragging, stage);
                    setDragging(null);
                  }}
                  className={`bg-surface-sunken flex min-h-64 flex-col gap-2 rounded-md p-2 ${
                    dropTarget === stage ? "outline-lead-yellow outline-2" : ""
                  }`}
                >
                  <header className="px-1">
                    <h2 className="text-ink text-sm font-semibold">
                      {STAGE_LABELS[stage]}{" "}
                      <span className="text-ink-muted font-normal">
                        {total?.count ?? "–"}
                      </span>
                    </h2>
                    <p className="text-ink-muted text-xs">
                      {total ? formatMoneyMyr(total.totalMyr) : " "}
                    </p>
                  </header>
                  {!ready ? (
                    <ul className="space-y-2" aria-label="Loading">
                      {[0, 1, 2].map((i) => (
                        <li
                          key={i}
                          className="bg-surface-raised h-24 animate-pulse rounded-md"
                        />
                      ))}
                    </ul>
                  ) : cards.length === 0 ? (
                    <p className="text-ink-muted px-1 py-6 text-center text-xs">
                      No deals
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {cards.map((c) => (
                        <DealCard
                          key={c.id}
                          deal={c}
                          canWrite={canWrite}
                          busy={busy.has(c.id)}
                          onDragStart={() => setDragging(c)}
                          onDragEnd={() => {
                            setDragging(null);
                            setDropTarget(null);
                          }}
                          onMove={(to) => requestMove(c, to as Stage)}
                        />
                      ))}
                    </ul>
                  )}
                  {ready && total && cards.length < total.count && (
                    <div className="text-ink-muted space-y-1 px-1 text-xs">
                      <p>
                        Showing {cards.length} of {total.count}
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={loadingMore === stage}
                        onClick={() => loadMore(stage, cards.length)}
                      >
                        {loadingMore === stage ? "Loading…" : "Load more"}
                      </Button>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}

      {lostFor && (
        <LostReasonDialog
          key={lostFor.id}
          personName={lostFor.person.fullName}
          onCancel={() => setLostFor(null)}
          onConfirm={(reasonId) => {
            const card = lostFor;
            setLostFor(null);
            move(card, "lost", reasonId);
          }}
        />
      )}
      <Toast message={toast} onDismiss={dismissToast} />
    </div>
  );
}
