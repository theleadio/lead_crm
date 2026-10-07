"use client";

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
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { enumLabel } from "@/lib/classes/types";
import {
  ENROLMENT_STATUS_BADGE,
  type EnrolmentListItem,
} from "@/lib/enrolments/types";
import { ENROLMENT_STATUSES } from "@/lib/enrolments/status-rules";
import { formatDate, formatDateRange } from "@/lib/format/date";
import type { ListResponse } from "@/lib/people/types";
import type { EnrolmentListQuery } from "@/lib/validation/enrolment-query";

const LIMIT = 25;
// Person, class, course, dates, status, seat, payer, price, enrolled.
const COLUMNS = 9;

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; result: ListResponse<EnrolmentListItem> };

// Spec §9.11 list: every enrolment across every class, the §7 conventions, and
// a row that opens the enrolment. No write lives here — Add is on the §9.10
// Roster, status and transfer are on the enrolment itself.
export function EnrolmentsList({
  initial,
  initialQuery,
  courses,
  classes,
}: {
  initial: ListResponse<EnrolmentListItem>;
  initialQuery: EnrolmentListQuery;
  courses: { id: string; nameEn: string }[];
  classes: { id: string; code: string }[];
}) {
  const [when, setWhen] = useState(initialQuery.when);
  const [search, setSearch] = useState(initialQuery.q ?? "");
  const [q, setQ] = useState(initialQuery.q ?? "");
  const [classId, setClassId] = useState(initialQuery.classId ?? "");
  const [courseId, setCourseId] = useState(initialQuery.courseId ?? "");
  const [status, setStatus] = useState(initialQuery.status ?? "");
  const [payerType, setPayerType] = useState(initialQuery.payerType ?? "");
  const [hasPrice, setHasPrice] = useState(
    initialQuery.hasPrice === undefined ? "" : String(initialQuery.hasPrice),
  );
  const [enrolledFrom, setEnrolledFrom] = useState(
    initialQuery.enrolledFrom ?? "",
  );
  const [enrolledTo, setEnrolledTo] = useState(initialQuery.enrolledTo ?? "");
  const [sort, setSort] = useState(initialQuery.sort ?? "");
  const [page, setPage] = useState(initialQuery.page);
  const [state, setState] = useState<State>({
    status: "ready",
    result: initial,
  });
  const [reloadKey, setReloadKey] = useState(0);
  // The query the server already rendered into `initial`. Only that exact
  // query skips the first client fetch — comparing the built params, not a
  // "have we fetched yet" flag, which would also swallow the first filter.
  const serverParams = useRef<string | null>(null);

  const reload = useCallback(() => {
    setState({ status: "loading" });
    setReloadKey((k) => k + 1);
  }, []);

  // Spec §9.1: debounce search 300ms.
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // Spec §11.2: lists refetch on window focus — Stripe, WATI and the workers
  // write underneath the screen.
  useEffect(() => {
    const onFocus = () => setReloadKey((k) => k + 1);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams({ when });
    if (q) params.set("q", q);
    if (classId) params.set("filter[classId]", classId);
    if (courseId) params.set("filter[courseId]", courseId);
    if (status) params.set("filter[status]", status);
    if (payerType) params.set("filter[payerType]", payerType);
    if (hasPrice) params.set("filter[hasPrice]", hasPrice);
    if (enrolledFrom) params.set("filter[enrolledFrom]", enrolledFrom);
    if (enrolledTo) params.set("filter[enrolledTo]", enrolledTo);
    if (sort) params.set("sort", sort);
    if (page > 1) params.set("page", String(page));

    // The URL carries the view, so it can be linked and a reload restores it
    // (the server reads the same params). replaceState, not router.replace: a
    // server round trip per keystroke would remount the list and drop focus.
    const url = new URL(window.location.href);
    url.search = params.toString();
    window.history.replaceState(null, "", url);

    const asked = params.toString();
    if (serverParams.current === null) serverParams.current = asked;
    if (asked === serverParams.current && reloadKey === 0) return;

    // React's ignore flag, not AbortController: aborting mid-read errors the
    // response body stream, and that rejection reaches no catch of ours.
    let ignore = false;
    params.set("limit", String(LIMIT));
    params.set("page", String(page));
    fetch(`/api/enrolments?${params}`)
      .then(async (res) => {
        const body = await res.json();
        if (ignore) return;
        if (!res.ok)
          setState({
            status: "error",
            message: body.error?.message ?? "Couldn't load enrolments.",
          });
        else setState({ status: "ready", result: body });
      })
      .catch(() => {
        if (!ignore)
          setState({
            status: "error",
            message: "Couldn't load enrolments — check your connection.",
          });
      });
    return () => {
      ignore = true;
    };
  }, [
    when,
    q,
    classId,
    courseId,
    status,
    payerType,
    hasPrice,
    enrolledFrom,
    enrolledTo,
    sort,
    page,
    reloadKey,
  ]);

  const rows = state.status === "ready" ? state.result.data : [];
  const result = state.status === "ready" ? state.result : null;
  // Every filter change starts again at page 1 and keeps the others (§7).
  const filter =
    <T,>(set: (v: T) => void) =>
    (value: T) => {
      set(value);
      setPage(1);
    };

  return (
    <div className="space-y-4">
      <ListHeader title="Enrolments" />

      {/* Two views of one register, so tabs rather than another select — the
          §9.8 Classes split, by the same Kuala Lumpur rule. */}
      <div
        role="tablist"
        aria-label="Which enrolments"
        className="border-line bg-surface-raised flex w-fit gap-1 rounded-full border p-1"
      >
        {(["upcoming", "past"] as const).map((w) => (
          <button
            key={w}
            role="tab"
            type="button"
            aria-selected={when === w}
            onClick={() => {
              if (when === w) return;
              setWhen(w);
              setPage(1);
            }}
            className={`focus-visible:outline-focus-ring rounded-full px-5 py-2 text-[13px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 ${
              when === w
                ? "bg-primary text-primary-foreground"
                : "text-ink-muted hover:text-ink"
            }`}
          >
            {w === "upcoming" ? "Classes to come" : "Classes that have run"}
          </button>
        ))}
      </div>

      <FilterRow>
        <Input
          aria-label="Search by person name, email or phone"
          placeholder="Search people…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 w-56"
        />
        <FilterSelect
          label="Class"
          value={classId}
          onChange={filter(setClassId)}
          options={classes.map((c) => [c.id, c.code])}
        />
        <FilterSelect
          label="Course"
          value={courseId}
          onChange={filter(setCourseId)}
          options={courses.map((c) => [c.id, c.nameEn])}
        />
        <FilterSelect
          label="Status"
          value={status}
          onChange={filter(setStatus)}
          options={ENROLMENT_STATUSES.map((s) => [s, enumLabel(s)])}
        />
        <FilterSelect
          label="Payer"
          value={payerType}
          onChange={filter(setPayerType)}
          options={[
            ["self", "The student"],
            ["company", "Their company"],
          ]}
        />
        {/* §5, not the payment table: whether this enrolment stores a price. */}
        <FilterSelect
          label="Price"
          value={hasPrice}
          onChange={filter(setHasPrice)}
          options={[
            ["true", "Price recorded"],
            ["false", "No price recorded"],
          ]}
        />
        <label className="text-ink-muted flex items-center gap-2 text-sm">
          Enrolled from
          <Input
            type="date"
            aria-label="Enrolled from"
            value={enrolledFrom}
            onChange={(e) => filter(setEnrolledFrom)(e.target.value)}
            className="h-9 w-40"
          />
        </label>
        <label className="text-ink-muted flex items-center gap-2 text-sm">
          to
          <Input
            type="date"
            aria-label="Enrolled to"
            value={enrolledTo}
            onChange={(e) => filter(setEnrolledTo)(e.target.value)}
            className="h-9 w-40"
          />
        </label>
      </FilterRow>

      {state.status === "error" && (
        <ListError message={state.message} onRetry={reload} />
      )}

      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead
                label="Person"
                column="person"
                sort={sort}
                onSort={(s) => {
                  setSort(s);
                  setPage(1);
                }}
              />
              <SortableHead
                label="Class"
                column="class"
                sort={sort}
                onSort={(s) => {
                  setSort(s);
                  setPage(1);
                }}
              />
              <TableHead>Course</TableHead>
              <TableHead>Dates</TableHead>
              <SortableHead
                label="Status"
                column="status"
                sort={sort}
                onSort={(s) => {
                  setSort(s);
                  setPage(1);
                }}
              />
              <TableHead>Seat</TableHead>
              <TableHead>Payer</TableHead>
              <TableHead>Price paid</TableHead>
              <SortableHead
                label="Enrolled"
                column="enrolled"
                sort={sort}
                onSort={(s) => {
                  setSort(s);
                  setPage(1);
                }}
              />
            </TableRow>
          </TableHeader>
          <TableBody>
            {state.status === "loading" && <SkeletonRows columns={COLUMNS} />}
            {state.status === "ready" && rows.length === 0 && (
              <EmptyRow columns={COLUMNS}>
                No enrolment matches these filters.
              </EmptyRow>
            )}
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-semibold">
                  {/* The row opens the enrolment (§9.11), not the person. */}
                  <Link
                    href={`/enrolments/${row.id}`}
                    className="text-blue-ink underline"
                  >
                    {row.personName}
                  </Link>
                </TableCell>
                <TableCell>
                  <Link
                    href={`/classes/${row.classId}`}
                    className="text-blue-ink underline"
                  >
                    {row.classCode}
                  </Link>
                </TableCell>
                <TableCell className="text-ink-muted">
                  {row.courseName}
                </TableCell>
                <TableCell className="text-ink-muted">
                  {formatDateRange(row.classStartDate, row.classEndDate)}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={ENROLMENT_STATUS_BADGE[row.status] ?? "secondary"}
                  >
                    {enumLabel(row.status)}
                  </Badge>
                </TableCell>
                <TableCell>
                  {/* §12.1: the same predicate the class screens count with. */}
                  <Badge variant={row.holdsSeat ? "success" : "secondary"}>
                    {row.holdsSeat ? "Holding" : "No seat"}
                  </Badge>
                </TableCell>
                <TableCell className="text-ink-muted">
                  {enumLabel(row.payerType)}
                </TableCell>
                <TableCell className="text-ink-muted">
                  {row.pricePaidMyr ?? "—"}
                </TableCell>
                <TableCell className="text-ink-muted">
                  {formatDate(row.createdAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>

      {result && (
        <Pagination
          page={result.page.page}
          limit={result.page.limit}
          total={result.page.total}
          onPage={setPage}
        />
      )}
    </div>
  );
}
