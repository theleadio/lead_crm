"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { EyeOff, Globe, MapPin, Monitor } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CLASS_STATUSES,
  classStatusBadge,
  seatBarColor,
  type ClassListItem,
} from "@/lib/classes/types";
import { formatDateRange } from "@/lib/format/date";
import type { ListResponse } from "@/lib/people/types";

const LIMIT = 25;
// Class (code over course), dates, format (language over mode), venue, seats,
// status (status over website). No actions column: the row opens the class,
// and Edit lives on the class page.
const COLUMNS = 6;

type CourseOption = { id: string; nameEn: string; isActive: boolean };

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; result: ListResponse<ClassListItem> };

const MODE_LABELS: Record<string, string> = {
  in_person: "In person",
  online: "Online",
  hybrid: "Hybrid",
};

// Spec §9.8: Operations' home screen. Upcoming classes by default, a toggle
// for past ones, and no write control — 9.9 creates and edits a class, 9.10
// opens one.
export function ClassesList({
  initial,
  initialPendingNotice,
  courses,
  canWrite,
}: {
  initial: ListResponse<ClassListItem> | null;
  // §9.0 links here with the notice filter already on, so the control has to
  // open set — otherwise the screen shows filtered rows under "all".
  initialPendingNotice: boolean;
  courses: CourseOption[];
  // §6 course/class row: super_admin and operations. Hiding the controls is
  // UX — the write routes keep their own checks.
  canWrite: boolean;
}) {
  const [when, setWhen] = useState<"upcoming" | "past">("upcoming");
  const [courseId, setCourseId] = useState("");
  const [status, setStatus] = useState("");
  const [language, setLanguage] = useState("");
  const [pendingNotice, setPendingNotice] = useState(
    initialPendingNotice ? "true" : "",
  );
  const [sort, setSort] = useState("");
  const [page, setPage] = useState(1);
  const [state, setState] = useState<State>(
    initial ? { status: "ready", result: initial } : { status: "loading" },
  );

  const [reloadKey, setReloadKey] = useState(0);
  // True until we fetch once. Without it, going back to the server's query
  // (clearing every filter) skips the fetch and leaves the old rows up.
  const showingInitial = useRef(true);
  const filtered = !!courseId || !!status || !!language || !!pendingNotice;

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
    // Same query the server already rendered into `initial`.
    if (
      initial &&
      showingInitial.current &&
      reloadKey === 0 &&
      when === "upcoming" &&
      !courseId &&
      !status &&
      !language &&
      pendingNotice === (initialPendingNotice ? "true" : "") &&
      !sort &&
      page === 1
    )
      return;
    showingInitial.current = false;
    // React's ignore flag, not AbortController: aborting mid-read errors the
    // response body stream, and that rejection reaches no catch of ours.
    let ignore = false;
    const params = new URLSearchParams({
      when,
      page: String(page),
      limit: String(LIMIT),
    });
    if (sort) params.set("sort", sort);
    if (courseId) params.set("filter[courseId]", courseId);
    if (status) params.set("filter[status]", status);
    if (language) params.set("filter[language]", language);
    if (pendingNotice) params.set("filter[pendingNotice]", pendingNotice);
    fetch(`/api/classes?${params}`)
      .then(async (res) => {
        const body = await res.json();
        if (ignore) return;
        if (!res.ok)
          setState({
            status: "error",
            message: body.error?.message ?? "Couldn't load classes.",
          });
        else setState({ status: "ready", result: body });
      })
      .catch(() => {
        if (!ignore)
          setState({
            status: "error",
            message: "Couldn't load classes — check your connection.",
          });
      });
    return () => {
      ignore = true;
    };
  }, [
    initial,
    initialPendingNotice,
    when,
    courseId,
    status,
    language,
    pendingNotice,
    sort,
    page,
    reloadKey,
  ]);

  const rows = state.status === "ready" ? state.result.data : [];
  const onSort = (s: string) => {
    setSort(s);
    setPage(1);
  };
  const clearFilters = () => {
    setCourseId("");
    setStatus("");
    setLanguage("");
    setPendingNotice("");
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <ListHeader title="Classes">
        {canWrite && (
          <Button asChild>
            <Link href="/classes/new">Add class</Link>
          </Button>
        )}
      </ListHeader>

      {/* design.pen "Tab Row": a pill group, active tab filled. Two views of
          one schedule, so tabs rather than another filter select (§9.8). */}
      <div
        role="tablist"
        aria-label="Which classes"
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
            {w === "upcoming" ? "Upcoming" : "Past"}
          </button>
        ))}
      </div>

      <FilterRow>
        <FilterSelect
          label="Course"
          value={courseId}
          onChange={(v) => {
            setCourseId(v);
            setPage(1);
          }}
          // Retired courses stay in the list, marked: their classes still
          // need finding (§9.5 v1.6).
          options={courses.map((c) => [
            c.id,
            c.isActive ? c.nameEn : `${c.nameEn} (inactive)`,
          ])}
        />
        <FilterSelect
          label="Status"
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          options={CLASS_STATUSES.map((s) => [s, classStatusBadge(s).label])}
        />
        <FilterSelect
          label="Language"
          value={language}
          onChange={(v) => {
            setLanguage(v);
            setPage(1);
          }}
          options={[
            ["en", "English"],
            ["zh", "中文"],
          ]}
        />
        <FilterSelect
          label="Notice"
          value={pendingNotice}
          onChange={(v) => {
            setPendingNotice(v);
            setPage(1);
          }}
          options={[["true", "Waiting on approval"]]}
        />
        {filtered && (
          <Button variant="ghost" onClick={clearFilters}>
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
              1280px with the sidebar open; Class takes what is left, never
              under 180px (the min-width): narrower, the table scrolls. */}
          <Table className="min-w-[836px] table-fixed">
            <TableHeader>
              <TableRow>
                <ClassHead sort={sort} onSort={onSort} />
                <SortableHead
                  label="Dates"
                  column="start"
                  sort={sort}
                  onSort={onSort}
                  className="w-36"
                />
                <TableHead className="w-28">Format</TableHead>
                <TableHead className="w-36">City / venue</TableHead>
                <TableHead className="w-32">Seats sold</TableHead>
                <TableHead className="w-32">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {state.status === "loading" ? (
                <SkeletonRows columns={COLUMNS} />
              ) : rows.length === 0 ? (
                <EmptyRow columns={COLUMNS}>
                  {filtered ? (
                    <>
                      No classes match these filters.{" "}
                      <Button variant="link" onClick={clearFilters}>
                        Clear filters
                      </Button>
                    </>
                  ) : when === "past" ? (
                    <>
                      No class has finished yet.{" "}
                      <Button
                        variant="link"
                        onClick={() => setWhen("upcoming")}
                      >
                        Show upcoming classes
                      </Button>
                    </>
                  ) : (
                    <>
                      No class is scheduled. This screen lists the scheduled
                      runs of a course — each one takes enrolments and appears
                      on the website when it is public.{" "}
                      {canWrite && (
                        <Link
                          href="/classes/new"
                          className="text-blue-ink font-semibold"
                        >
                          Add a class
                        </Link>
                      )}
                    </>
                  )}
                </EmptyRow>
              ) : (
                rows.map((c) => <ClassRow key={c.id} cls={c} />)
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
    </div>
  );
}

function ClassRow({ cls }: { cls: ClassListItem }) {
  const router = useRouter();
  const href = `/classes/${cls.id}`;
  const badge = classStatusBadge(cls.status);
  const sold = cls.confirmedCount + cls.reservedCount;
  const pct = Math.min(100, Math.round((sold / cls.capacity) * 100));
  const venue = [cls.venueName, cls.city].filter(Boolean).join(", ");

  return (
    // The whole row opens the class, as on People (§9): the code stays a real
    // link for keyboard and middle-click, and clicks on it aren't hijacked.
    <TableRow
      className="cursor-pointer"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a, button")) return;
        router.push(href);
      }}
    >
      <TableCell>
        {/* Opening a class is a read, so every role that sees the row gets the
            link — not only the two that see Edit (§9.10). */}
        <Link
          href={href}
          title={cls.code}
          className="hover:text-blue-ink block truncate font-semibold"
        >
          {cls.code}
        </Link>
        <span
          className="text-ink-muted block truncate text-xs"
          title={cls.courseName}
        >
          {cls.courseName}
        </span>
      </TableCell>
      <TableCell>{formatDateRange(cls.startDate, cls.endDate)}</TableCell>
      <TableCell>
        <span className="block">
          {cls.language === "zh" ? "中文" : "English"}
        </span>
        <span className="text-ink-muted flex items-center gap-1.5 text-xs">
          {cls.mode === "online" ? (
            <Monitor aria-hidden="true" className="text-ink-subtle size-3.5" />
          ) : (
            <MapPin aria-hidden="true" className="text-ink-subtle size-3.5" />
          )}
          {MODE_LABELS[cls.mode] ?? cls.mode}
        </span>
      </TableCell>
      <TableCell className="text-ink-muted truncate" title={venue || undefined}>
        {venue || "—"}
      </TableCell>
      <TableCell>
        {/* The numbers are written out beside the bar: the bar alone would
            make the colour the only signal (§9.8, §13). */}
        <span className="flex items-center gap-2.5">
          <span className="bg-surface-sunken h-1.5 flex-1 overflow-hidden rounded-full">
            <span
              className={`block h-full rounded-full ${seatBarColor(cls.status)}`}
              style={{ width: `${pct}%` }}
            />
          </span>
          <span className="w-12 text-xs font-semibold">
            {sold}/{cls.capacity}
          </span>
        </span>
      </TableCell>
      <TableCell>
        <Badge variant={badge.variant}>{badge.label}</Badge>
        <span className="text-ink-muted mt-1 flex items-center gap-1.5 text-xs">
          {cls.isPublic ? (
            <Globe aria-hidden="true" className="text-ink-subtle size-3.5" />
          ) : (
            <EyeOff aria-hidden="true" className="text-ink-subtle size-3.5" />
          )}
          {cls.isPublic ? "On website" : "Hidden"}
        </span>
      </TableCell>
    </TableRow>
  );
}

// One column, two sorts: the class code leads the cell and the course name
// sits under it, so both keep the sort they had as separate columns.
function ClassHead({
  sort,
  onSort,
}: {
  sort: string | undefined;
  onSort: (sort: string) => void;
}) {
  const stateOf = (column: string) =>
    sort === column
      ? "ascending"
      : sort === `-${column}`
        ? "descending"
        : "none";
  const code = stateOf("code");
  const course = stateOf("course");
  const button = (label: string, column: string, state: string) => (
    <button
      type="button"
      onClick={() => onSort(state === "ascending" ? `-${column}` : column)}
      aria-label={`Sort by ${label.toLowerCase()}`}
      className="focus-visible:outline-focus-ring inline-flex cursor-pointer items-center gap-1 font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      {label}
      <span aria-hidden="true" className="w-3 text-xs">
        {state === "ascending" ? "▲" : state === "descending" ? "▼" : ""}
      </span>
    </button>
  );
  return (
    <TableHead
      aria-sort={code !== "none" ? code : course !== "none" ? course : "none"}
    >
      <span className="inline-flex items-center gap-1">
        {button("Class", "code", code)}
        <span aria-hidden="true">/</span>
        {button("Course", "course", course)}
      </span>
    </TableHead>
  );
}
