"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
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
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { CategoryOption } from "@/lib/enquiries/routing";
import {
  ENQUIRY_CHANNELS,
  ENQUIRY_STATUSES,
  ENQUIRY_STATUS_BADGE,
  type EnquiryRow,
} from "@/lib/enquiries/types";
import { formatDateTime } from "@/lib/format/date";
import type { ListResponse, OwnerOption } from "@/lib/people/types";
import { versionHeaders } from "@/lib/api/version-headers";

// FilterSelect's look, for the selects it cannot be: the status filter (no
// value means open or waiting, not all) and the row actions.
const SELECT_CLASS =
  "border-line-strong bg-surface-sunken text-ink focus-visible:outline-focus-ring h-8 max-w-60 truncate rounded-sm border px-2.5 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2";
import { ContextPanel } from "./context-panel";
import {
  PAST_SLA_MARKER,
  enquiryLabel,
  isFiltered,
  mayWriteAny,
  queueCells,
  queueParams,
  rowActions,
  type QueueAccess,
  type QueueView,
} from "./queue-view";

const LIMIT = 25;

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; result: ListResponse<EnquiryRow> };

type Body =
  | { action: "assign"; assignee: string | null }
  | { action: "category"; category: string }
  | { action: "close"; status: string; note: string };

// Spec §9.13 Enquiries queue: open or waiting, oldest first; filters, sort
// and paging in the URL; three actions per row; the person beside the
// selected row. Since migration 019 it is also the ticket queue: teams,
// categories from Settings, a next-working-day deadline.
export function EnquiriesQueue({
  initial,
  initialView,
  access,
  users,
  categories,
  teams,
  canCreate,
  canEditSettings,
}: {
  initial: ListResponse<EnquiryRow>;
  initialView: QueueView;
  access: QueueAccess;
  // Active users, for the assignee filter and the assign picker. Empty for a
  // part-timer, whose queue is only ever their own.
  users: OwnerOption[];
  categories: CategoryOption[];
  teams: { id: string; name: string }[];
  canCreate: boolean;
  canEditSettings: boolean;
}) {
  const [view, setView] = useState(initialView);
  const [search, setSearch] = useState(initialView.q);
  const [state, setState] = useState<State>({
    status: "ready",
    result: initial,
  });
  const [reloadKey, setReloadKey] = useState(0);
  // A choice the server refused stays in its control until a reload (§13).
  const [drafts, setDrafts] = useState<Record<string, Partial<Body>>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [toast, setToast] = useState<React.ReactNode>(null);
  const dismissToast = useCallback(() => setToast(null), []);
  const [closing, setClosing] = useState<EnquiryRow | null>(null);
  const [closeStatus, setCloseStatus] = useState("human_resolved");
  const [closeNote, setCloseNote] = useState("");
  // The query the server already rendered into `initial`, so the first effect
  // run does not fetch it again.
  const serverParams = useRef<string | null>(null);

  const reload = useCallback(() => {
    setDrafts({});
    setToast(null);
    setState({ status: "loading" });
    setReloadKey((k) => k + 1);
  }, []);

  // Every filter or sort change starts again at page 1 and keeps the rest.
  const update = (patch: Partial<QueueView>) =>
    setView((v) => ({ ...v, page: 1, ...patch }));

  // Spec §9.1: debounce search 300ms.
  useEffect(() => {
    const t = setTimeout(() => {
      setView((v) =>
        v.q === search.trim() ? v : { ...v, q: search.trim(), page: 1 },
      );
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // Spec §11.2: lists refetch on window focus — the WATI intake writes
  // underneath the screen.
  useEffect(() => {
    const onFocus = () => setReloadKey((k) => k + 1);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const { selected, ...listView } = view;
  const listKey = queueParams({ ...listView, selected: "" }).toString();

  // The URL carries the view, selection included. replaceState, not
  // router.replace: a server round trip per keystroke would drop focus.
  useEffect(() => {
    const url = new URL(window.location.href);
    url.search = queueParams(view).toString();
    window.history.replaceState(null, "", url);
  }, [view]);

  useEffect(() => {
    if (serverParams.current === null) serverParams.current = listKey;
    if (listKey === serverParams.current && reloadKey === 0) return;

    let ignore = false;
    const params = new URLSearchParams(listKey);
    params.set("limit", String(LIMIT));
    fetch(`/api/enquiries?${params}`)
      .then(async (res) => {
        const body = await res.json();
        if (ignore) return;
        if (!res.ok)
          setState({
            status: "error",
            message: body.error?.message ?? "Couldn't load the enquiries.",
          });
        else setState({ status: "ready", result: body });
      })
      .catch(() => {
        if (!ignore)
          setState({
            status: "error",
            message: "Couldn't load the enquiries — check your connection.",
          });
      });
    return () => {
      ignore = true;
    };
  }, [listKey, reloadKey]);

  const rows = state.status === "ready" ? state.result.data : [];
  const result = state.status === "ready" ? state.result : null;
  const selectedRow = rows.find((r) => r.id === selected) ?? null;
  const showActions = mayWriteAny(access);
  const activeCategories = categories.filter((c) => c.active);

  // Under 1536px the panel sits below the table, out of sight: bring it in.
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected && window.innerWidth < 1536)
      panelRef.current?.scrollIntoView({ block: "start" });
  }, [selected]);
  // Filtered to one status, every badge would say the same word the filter
  // already says.
  const showStatus = view.status === "all";
  const columns = 8 + (showStatus ? 1 : 0) + (showActions ? 1 : 0);

  async function save(
    row: EnquiryRow,
    body: Body,
    done: (updated: EnquiryRow) => string,
  ): Promise<string | void> {
    setPending(row.id);
    setDrafts((d) => ({ ...d, [row.id]: body }));
    const res = await fetch(`/api/enquiries/${row.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...versionHeaders(row.version),
      },
      body: JSON.stringify(body),
    }).catch(() => null);
    setPending(null);

    if (!res) {
      const message =
        "Couldn't save — check your connection. Your changes are still here.";
      setToast(message);
      return message;
    }
    const data = await res.json().catch(() => null);
    if (res.ok) {
      const updated = data as EnquiryRow;
      setState((s) =>
        s.status === "ready"
          ? {
              status: "ready",
              result: {
                ...s.result,
                data: s.result.data.map((r) =>
                  r.id === updated.id ? updated : r,
                ),
              },
            }
          : s,
      );
      setDrafts((d) => {
        const next = { ...d };
        delete next[row.id];
        return next;
      });
      setToast(done(updated));
      return;
    }
    const message: string =
      data?.error?.message ?? "Couldn't save this enquiry. Try again.";
    setToast(
      res.status === 409 ? (
        <>
          {message}{" "}
          <button
            type="button"
            onClick={reload}
            className="focus-visible:outline-lead-blue rounded-sm font-semibold underline focus-visible:outline-2"
          >
            Reload
          </button>
        </>
      ) : (
        message
      ),
    );
    return message;
  }

  const nameOf = (id: string | null) =>
    id === null ? null : (users.find((u) => u.id === id)?.fullName ?? null);

  const selectHref = (id: string) =>
    `/enquiries?${queueParams({ ...view, selected: id })}`;
  const closeHref = `/enquiries?${queueParams({ ...view, selected: "" })}`;

  const sortHead = (label: string, column: string) => (
    <SortableHead
      label={label}
      column={column}
      sort={view.sort || undefined}
      onSort={(sort) => update({ sort })}
    />
  );

  return (
    <div className="space-y-4">
      <ListHeader title="Enquiries">
        {canEditSettings && (
          <Button asChild variant="outline">
            <Link href="/settings/enquiries">Teams and categories</Link>
          </Button>
        )}
        {canCreate && (
          <Button asChild>
            <Link href="/enquiries/new">New enquiry</Link>
          </Button>
        )}
      </ListHeader>

      <FilterRow>
        <Input
          aria-label="Search by person name, email or phone"
          placeholder="Search name, phone or email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 w-56"
        />
        {/* Not a FilterSelect: no status means open or waiting here, not
            all. */}
        <select
          aria-label="Status"
          value={view.status}
          onChange={(e) => update({ status: e.target.value })}
          className={SELECT_CLASS}
        >
          <option value="active">Status: {enquiryLabel("active")}</option>
          {ENQUIRY_STATUSES.map((s) => (
            <option key={s} value={s}>
              Status: {enquiryLabel(s)}
            </option>
          ))}
          <option value="all">Status: all</option>
        </select>
        <FilterSelect
          label="Category"
          value={view.category}
          onChange={(category) => update({ category })}
          options={categories.map((c) => [c.code, c.label])}
        />
        <FilterSelect
          label="Team"
          value={view.team}
          onChange={(team) => update({ team })}
          options={teams.map((t) => [t.id, t.name])}
        />
        <FilterSelect
          label="Channel"
          value={view.channel}
          onChange={(channel) => update({ channel })}
          options={ENQUIRY_CHANNELS.map((c) => [c, enquiryLabel(c)])}
        />
        {!access.assignedOnly && (
          <FilterSelect
            label="Assigned"
            value={view.assignee}
            onChange={(assignee) => update({ assignee })}
            options={[
              ["unassigned", "Nobody yet"],
              ...users.map((u): [string, string] => [u.id, u.fullName]),
            ]}
          />
        )}
        {/* A toggle, like Enrolments' "Needs action". */}
        {!access.assignedOnly && (
          <Button
            variant={view.mine ? "default" : "outline"}
            aria-pressed={view.mine}
            onClick={() => update({ mine: !view.mine })}
          >
            Only mine
          </Button>
        )}
        {access.teamIds.length > 0 && (
          <Button
            variant={view.myTeams ? "default" : "outline"}
            aria-pressed={view.myTeams}
            onClick={() => update({ myTeams: !view.myTeams })}
          >
            My teams
          </Button>
        )}
      </FilterRow>

      {state.status === "error" && (
        <ListError message={state.message} onRetry={reload} />
      )}

      {/* Beside the queue on a wide screen, below it on a narrow one, never
          over it (§9.13 spec). */}
      <div
        className={
          selected
            ? // Beside the table only from 1536px: at 1280 the table needs
              // all of its width for the actions (§14).
              "grid gap-4 2xl:grid-cols-[minmax(0,1fr)_20rem] 2xl:items-start"
            : ""
        }
      >
        <div className="min-w-0 space-y-4">
          <TableCard>
            {/* Tighter cells than other lists: nine columns share the
                width with the person panel. */}
            <Table className="[&_td]:px-2 [&_th]:px-2">
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Team</TableHead>
                  {showStatus && sortHead("Status", "status")}
                  <TableHead>Assigned</TableHead>
                  {sortHead("First message", "firstMessage")}
                  <TableHead>First response</TableHead>
                  {sortHead("Age", "age")}
                  {showActions && <TableHead>Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {state.status === "loading" && (
                  <SkeletonRows columns={columns} />
                )}
                {state.status === "ready" &&
                  rows.length === 0 &&
                  (isFiltered(view) ? (
                    <EmptyRow columns={columns}>
                      No enquiries match these filters.{" "}
                      <Button
                        variant="link"
                        onClick={() => {
                          setSearch("");
                          update({
                            q: "",
                            status: "active",
                            category: "",
                            team: "",
                            myTeams: false,
                            channel: "",
                            assignee: "",
                            mine: false,
                          });
                        }}
                      >
                        Clear filters
                      </Button>
                    </EmptyRow>
                  ) : (
                    <EmptyRow columns={columns}>
                      This is the support queue: every enquiry waiting for a
                      reply, oldest first. They arrive from WhatsApp, the help
                      form and the inbox, or are added by hand — there are none
                      open right now.
                    </EmptyRow>
                  ))}
                {rows.map((row) => {
                  const cells = queueCells(row);
                  const can = rowActions(row, access);
                  const draft = drafts[row.id] ?? {};
                  const busy = pending === row.id;
                  return (
                    // Click anywhere on the row to show the person, as every
                    // list row opens its record (LinkRow); controls in the
                    // row keep their own clicks.
                    <TableRow
                      key={row.id}
                      onClick={(e) => {
                        if (
                          (e.target as HTMLElement).closest("a, button, select")
                        )
                          return;
                        setView((v) => ({ ...v, selected: row.id }));
                      }}
                      className={`cursor-pointer ${
                        row.id === selected
                          ? "bg-blue-soft hover:bg-blue-soft"
                          : ""
                      }`}
                    >
                      {/* Past SLA is a red edge, red age and the badge, not a
                          red row: the selected row must still show. An inset
                          shadow, not a border: the 3px border version showed
                          red on every row in the app. */}
                      <TableCell
                        className={`font-semibold ${
                          row.pastSla
                            ? "shadow-[inset_3px_0_0_var(--color-destructive)]"
                            : ""
                        }`}
                      >
                        <a
                          href={selectHref(row.id)}
                          onClick={(e) => {
                            e.preventDefault();
                            setView((v) => ({ ...v, selected: row.id }));
                          }}
                          aria-current={
                            row.id === selected ? "true" : undefined
                          }
                          className="hover:text-blue-ink focus-visible:outline-focus-ring rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2"
                        >
                          {cells[0]}
                        </a>
                        {/* The reference and subject, under the name: one
                            line each, so the row stays scannable. */}
                        <div className="text-ink-muted max-w-56 truncate text-xs font-normal">
                          <Link
                            href={`/enquiries/${row.id}`}
                            className="hover:text-blue-ink focus-visible:outline-focus-ring rounded-sm focus-visible:outline-2"
                          >
                            {row.number}
                          </Link>
                          {row.subject ? ` · ${row.subject}` : ""}
                        </div>
                      </TableCell>
                      <TableCell className="text-ink-muted">
                        {cells[1]}
                      </TableCell>
                      {/* Category and Assigned are their own controls where the
                          viewer may change them: one place to read and set
                          each, and the row stays one line. */}
                      <TableCell className="text-ink-muted">
                        {can.category ? (
                          <select
                            aria-label={`Category of ${row.personName}'s enquiry`}
                            disabled={busy}
                            value={
                              draft.action === "category"
                                ? draft.category
                                : (row.category ?? "")
                            }
                            onChange={(e) =>
                              e.target.value &&
                              save(
                                row,
                                {
                                  action: "category",
                                  category: e.target.value,
                                },
                                (u) =>
                                  `Category set to ${u.categoryLabel ?? enquiryLabel(u.category ?? "")}, team ${u.teamName}.`,
                              )
                            }
                            className={`${SELECT_CLASS} w-32`}
                          >
                            <option value="" disabled>
                              Set category
                            </option>
                            {/* A switched-off category still on this row has
                                to show as chosen. */}
                            {row.category &&
                              !activeCategories.some(
                                (c) => c.code === row.category,
                              ) && (
                                <option value={row.category}>{cells[2]}</option>
                              )}
                            {activeCategories.map((c) => (
                              <option key={c.code} value={c.code}>
                                {c.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          cells[2]
                        )}
                      </TableCell>
                      <TableCell className="text-ink-muted">
                        {cells[3]}
                      </TableCell>
                      {showStatus && (
                        <TableCell>
                          <Badge variant={ENQUIRY_STATUS_BADGE[row.status]}>
                            {cells[4]}
                          </Badge>
                        </TableCell>
                      )}
                      <TableCell className="text-ink-muted">
                        {can.assign ? (
                          <select
                            aria-label={`Assign ${row.personName}'s enquiry to`}
                            disabled={busy}
                            value={
                              draft.action === "assign"
                                ? (draft.assignee ?? "")
                                : (row.assignedUserId ?? "")
                            }
                            onChange={(e) => {
                              const assignee = e.target.value || null;
                              save(row, { action: "assign", assignee }, (u) =>
                                u.assigneeName
                                  ? `Assigned to ${u.assigneeName}.`
                                  : "Now assigned to nobody.",
                              );
                            }}
                            className={`${SELECT_CLASS} w-32`}
                          >
                            <option value="">Nobody</option>
                            {/* A current assignee who is no longer
                                    active still has to show as chosen. */}
                            {row.assignedUserId &&
                              !nameOf(row.assignedUserId) && (
                                <option value={row.assignedUserId}>
                                  {row.assigneeName}
                                </option>
                              )}
                            {users.map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.fullName}
                              </option>
                            ))}
                          </select>
                        ) : (
                          cells[5]
                        )}
                      </TableCell>
                      <TableCell className="text-ink-muted whitespace-nowrap">
                        {cells[6]}
                      </TableCell>
                      <TableCell
                        className="text-ink-muted whitespace-nowrap"
                        title={
                          row.firstResponseAt
                            ? formatDateTime(row.firstResponseAt)
                            : undefined
                        }
                      >
                        {cells[7]}
                      </TableCell>
                      <TableCell
                        className={`whitespace-nowrap ${
                          row.pastSla ? "text-destructive font-semibold" : ""
                        }`}
                      >
                        {cells[8]}
                        {/* Under the age, not beside it: on one line the
                            row is wider than the 1280px table (§14). */}
                        {row.pastSla && (
                          <Badge
                            variant="destructive"
                            className="mt-1 flex w-fit"
                          >
                            {PAST_SLA_MARKER}
                          </Badge>
                        )}
                      </TableCell>
                      {showActions && (
                        <TableCell>
                          <div className="flex items-center gap-2 whitespace-nowrap">
                            {can.assign &&
                              row.assignedUserId !== access.viewerId && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={busy}
                                  onClick={() =>
                                    save(
                                      row,
                                      {
                                        action: "assign",
                                        assignee: access.viewerId,
                                      },
                                      () => "Assigned to you.",
                                    )
                                  }
                                >
                                  Assign to me
                                </Button>
                              )}
                            {can.close && (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={busy}
                                onClick={() => {
                                  const kept = drafts[row.id];
                                  if (kept?.action !== "close") {
                                    setCloseStatus("human_resolved");
                                    setCloseNote("");
                                  }
                                  setClosing(row);
                                }}
                              >
                                Close…
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableCard>

          {result && (
            <Pagination
              page={result.page.page}
              limit={result.page.limit}
              total={result.page.total}
              onPage={(page) => setView((v) => ({ ...v, page }))}
            />
          )}
        </div>

        {selectedRow && (
          <div ref={panelRef} className="scroll-mt-4">
            <ContextPanel
              key={selectedRow.id}
              enquiry={selectedRow}
              closeHref={closeHref}
              canConvert={rowActions(selectedRow, access).convert}
            />
          </div>
        )}
      </div>

      <ConfirmDialog
        open={closing !== null}
        onOpenChange={(open) => !open && setClosing(null)}
        title="Close this enquiry"
        body={
          <p>
            Closing {closing?.personName}&apos;s enquiry takes it out of the
            queue for good — there is no reopen; if they write again, that is a
            new enquiry. Say what the outcome was.
          </p>
        }
        confirmLabel="Close enquiry"
        cancelLabel="Keep open"
        // Closing is final but destroys nothing: the outcome is recorded.
        tone="primary"
        canConfirm={closeNote.trim().length > 0}
        onConfirm={async () => {
          if (!closing) return;
          const message = await save(
            closing,
            { action: "close", status: closeStatus, note: closeNote },
            (u) => `Enquiry closed as ${enquiryLabel(u.status).toLowerCase()}.`,
          );
          if (!message) {
            setClosing(null);
            // Refetch: a closed enquiry leaves the open view rather than
            // lingering there with no actions.
            setReloadKey((k) => k + 1);
          }
          return message;
        }}
      >
        <fieldset className="space-y-2 text-sm">
          <legend className="font-medium">Outcome</legend>
          {[
            ["human_resolved", "Resolved — we answered what they asked"],
            ["closed", "Closed — nothing more to do"],
          ].map(([value, label]) => (
            <label key={value} className="flex items-center gap-2">
              <input
                type="radio"
                name="close-status"
                value={value}
                checked={closeStatus === value}
                onChange={() => setCloseStatus(value)}
              />
              {label}
            </label>
          ))}
        </fieldset>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Note</span>
          <textarea
            value={closeNote}
            onChange={(e) => setCloseNote(e.target.value)}
            maxLength={2000}
            rows={3}
            className="border-line-strong bg-surface-sunken focus-visible:outline-focus-ring w-full rounded-sm border p-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
          />
        </label>
      </ConfirmDialog>

      <Toast message={toast} onDismiss={dismissToast} />
    </div>
  );
}
