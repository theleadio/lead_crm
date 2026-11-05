"use client";

import { LinkRow } from "@/components/link-row";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  EmptyRow,
  FilterRow,
  FilterSelect,
  ListError,
  ListHeader,
  Pagination,
  SkeletonRows,
  SortableHead,
  TableCard,
} from "@/components/list-kit";
import { Toast } from "@/components/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CourseFormDialog, EMPTY_COURSE } from "./course-form-dialog";
import type { CourseListItem } from "@/lib/courses/service";
import { formatMoneyMyr } from "@/lib/format/money";
import type { ListResponse } from "@/lib/people/types";

const LIMIT = 25;
// Code, name (English over Chinese), track (over duration), list price (over
// HRDC), status. No edit column: the row opens the course's page, and Edit
// lives there, as on every other record.
const COLUMNS = 5;

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; result: ListResponse<CourseListItem> };

// Spec §9.7 Courses: plain table + modal form. Active and retired together by
// default, because a retired course still has deals and classes on it (§9.5).
export function CoursesList({
  initial,
  canWrite,
}: {
  initial: ListResponse<CourseListItem> | null;
  canWrite: boolean;
}) {
  const [active, setActive] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("name");
  const [state, setState] = useState<State>(
    initial ? { status: "ready", result: initial } : { status: "loading" },
  );

  const [reloadKey, setReloadKey] = useState(0);
  // True until we fetch once. Without it, going back to the server's query
  // (clearing the filter) skips the fetch and leaves the old rows up.
  const showingInitial = useRef(true);
  const [addOpen, setAddOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const dismissToast = useCallback(() => setToast(null), []);

  const reload = useCallback(() => {
    setState({ status: "loading" });
    setReloadKey((k) => k + 1);
  }, []);

  // Spec §11.2: lists refetch on window focus — Stripe, WATI and the workers
  // write underneath the screen. No blanking: the rows stay up until the new
  // ones arrive.
  useEffect(() => {
    const onFocus = () => setReloadKey((k) => k + 1);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  useEffect(() => {
    // React's ignore flag, not AbortController: aborting mid-read errors the
    // response body stream, and that rejection reaches no catch of ours
    // ("Uncaught (in promise) AbortError" in dev). A late response is simply
    // dropped instead.
    // Same query the server already rendered into `initial`.
    if (
      initial &&
      showingInitial.current &&
      reloadKey === 0 &&
      !active &&
      sort === "name" &&
      page === 1
    )
      return;
    showingInitial.current = false;
    let ignore = false;
    const params = new URLSearchParams({
      page: String(page),
      limit: String(LIMIT),
      sort,
    });
    if (active) params.set("active", active);
    fetch(`/api/courses?${params}`)
      .then(async (res) => {
        const body = await res.json();
        if (ignore) return;
        if (!res.ok)
          setState({
            status: "error",
            message: body.error?.message ?? "Couldn't load courses.",
          });
        else setState({ status: "ready", result: body });
      })
      .catch(() => {
        if (!ignore)
          setState({
            status: "error",
            message: "Couldn't load courses — check your connection.",
          });
      });
    return () => {
      ignore = true;
    };
  }, [initial, active, sort, page, reloadKey]);

  const rows = state.status === "ready" ? state.result.data : [];
  const onSort = (s: string) => {
    setSort(s);
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <ListHeader title="Courses">
        {canWrite && (
          <Button onClick={() => setAddOpen(true)}>Add course</Button>
        )}
      </ListHeader>

      <FilterRow>
        <FilterSelect
          label="Status"
          value={active}
          onChange={(v) => {
            setActive(v);
            setPage(1);
          }}
          options={[
            ["true", "Active only"],
            ["false", "Retired only"],
          ]}
        />
        {active && (
          <Button
            variant="ghost"
            onClick={() => {
              setActive("");
              setPage(1);
            }}
          >
            Clear filters
          </Button>
        )}
      </FilterRow>

      {state.status === "error" ? (
        <ListError message={state.message} onRetry={reload} />
      ) : (
        <TableCard>
          {/* table-fixed with a width per column: on auto layout the widest
              cell sets each width, so every filter reshuffled the table.
              Related facts share a column on two lines, so the table fits
              1280px with the sidebar open. Shares, not pixels, so spare width on a
              wide screen spreads across every column instead of all landing
              in Name; under the min-width the table scrolls. */}
          <Table className="min-w-[796px] table-fixed">
            <TableHeader>
              <TableRow>
                <SortableHead
                  label="Code"
                  column="code"
                  sort={sort}
                  onSort={onSort}
                  className="w-[26%]"
                />
                <SortableHead
                  label="Name"
                  column="name"
                  sort={sort}
                  onSort={onSort}
                  className="w-[34%]"
                />
                <TableHead className="w-[14%]">Track</TableHead>
                <TableHead className="w-[14%]">List price</TableHead>
                <TableHead className="w-[12%]">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {state.status === "loading" ? (
                <SkeletonRows columns={COLUMNS} />
              ) : rows.length === 0 ? (
                <EmptyRow columns={COLUMNS}>
                  {active ? (
                    <>
                      No {active === "true" ? "active" : "retired"} courses.{" "}
                      <Button variant="link" onClick={() => setActive("")}>
                        Show all courses
                      </Button>
                    </>
                  ) : (
                    <>
                      No courses yet. Deals and classes pick from this list.{" "}
                      {canWrite && (
                        <Button variant="link" onClick={() => setAddOpen(true)}>
                          Add a course
                        </Button>
                      )}
                    </>
                  )}
                </EmptyRow>
              ) : (
                rows.map((c) => <CourseRow key={c.id} course={c} />)
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
          onPage={setPage}
        />
      )}

      {canWrite && (
        <>
          <CourseFormDialog
            open={addOpen}
            onOpenChange={setAddOpen}
            initial={EMPTY_COURSE}
            onSaved={(c) => {
              setToast(`Added ${c.nameEn}.`);
              reload();
            }}
            onStale={reload}
          />
        </>
      )}
      <Toast message={toast} onDismiss={dismissToast} />
    </div>
  );
}

// Every list row opens its record: the course's own page, where its classes
// and Edit live. A retired course is marked so it is not mistaken for one on
// sale.
function CourseRow({ course: c }: { course: CourseListItem }) {
  const href = `/courses/${c.id}`;
  return (
    <LinkRow href={href} className={c.isActive ? undefined : "text-ink-muted"}>
      {/* Codes are long hyphenated slugs: they wrap at the hyphens rather
          than hide their endings, which is where codes differ. */}
      <TableCell className="font-medium break-words whitespace-normal">
        {c.code}
      </TableCell>
      <TableCell>
        <Link
          href={href}
          title={c.nameEn}
          className="hover:text-blue-ink block truncate font-semibold"
        >
          {c.nameEn}
        </Link>
        <span
          lang="zh-Hans"
          className="text-ink-muted block truncate text-xs"
          title={c.nameZh ?? undefined}
        >
          {c.nameZh ?? "No Chinese name"}
        </span>
      </TableCell>
      <TableCell>
        <span className="block truncate" title={c.track}>
          {c.track}
        </span>
        <span className="text-ink-muted block text-xs">
          {c.durationDays} {c.durationDays === 1 ? "day" : "days"}
        </span>
      </TableCell>
      <TableCell>
        <span className="block">
          {c.listPriceMyr === null ? "—" : formatMoneyMyr(c.listPriceMyr)}
        </span>
        <span
          className={`block text-xs ${c.hrdcClaimable ? "text-blue-ink" : "text-ink-muted"}`}
        >
          {c.hrdcClaimable ? "HRDC claimable" : "Not HRDC"}
        </span>
      </TableCell>
      <TableCell>
        {c.isActive ? (
          <Badge variant="outline">Active</Badge>
        ) : (
          <Badge variant="secondary">Retired</Badge>
        )}
      </TableCell>
    </LinkRow>
  );
}
