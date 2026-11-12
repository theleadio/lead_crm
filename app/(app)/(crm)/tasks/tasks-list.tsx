"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ListTodo } from "lucide-react";
import { LinkRow } from "@/components/link-row";
import {
  EmptyRow,
  FilterRow,
  FilterSelect,
  ListError,
  ListHeader,
  Pagination,
  SkeletonRows,
  TableCard,
} from "@/components/list-kit";
import { Toast } from "@/components/toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatOverdue, formatTime } from "@/lib/format/date";
import type { ListResponse } from "@/lib/people/types";
import { CLOSES_ELSEWHERE, TASK_TYPE_LABELS } from "@/lib/tasks/labels";
import type { TaskRow } from "@/lib/tasks/types";
import { TASKS_PAGE_SIZE } from "@/lib/validation/task";
import { TaskDialog } from "./task-dialog";
import { TASK_ICONS } from "./task-icons";

// Spec §9.14: open tasks, earliest due first, so overdue ones lead. Mine by
// default (§7 filter[mine]=true); everyone's for the roles that read every
// task. A tick closes a task in place, and the toast can undo it. A duplicate
// review or a payment match has no tick: it closes where its work is done.

const LIMIT = TASKS_PAGE_SIZE;

type View = { mine: boolean; assignee: string; type: string; page: number };

type Access = {
  viewerId: string;
  canWrite: boolean;
  canSeeEveryone: boolean;
  assignedOnly: boolean;
};

type State =
  | { status: "loading" }
  | { status: "ready"; result: ListResponse<TaskRow> }
  | { status: "error"; message: string };

function viewParams(v: View): URLSearchParams {
  const p = new URLSearchParams();
  if (!v.mine) p.set("filter[mine]", "false");
  if (!v.mine && v.assignee) p.set("filter[assignee]", v.assignee);
  if (v.type) p.set("filter[type]", v.type);
  if (v.page > 1) p.set("page", String(v.page));
  return p;
}

function DueCell({ task }: { task: TaskRow }) {
  if (!task.dueAt) return <span className="text-ink-subtle">No due date</span>;
  if (task.isOverdue)
    return (
      <span className="text-danger font-semibold">
        {formatOverdue(task.dueAt)}
      </span>
    );
  return (
    <span className="text-ink-muted">
      {formatDate(task.dueAt)}, {formatTime(task.dueAt)}
    </span>
  );
}

export function TasksList({
  initial,
  initialView,
  access,
  users,
}: {
  initial: ListResponse<TaskRow>;
  initialView: View;
  access: Access;
  users: { id: string; fullName: string }[];
}) {
  const [view, setView] = useState<View>(initialView);
  const [state, setState] = useState<State>({
    status: "ready",
    result: initial,
  });
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState<TaskRow | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [toast, setToast] = useState<React.ReactNode>(null);
  const dismissToast = useCallback(() => setToast(null), []);
  const key = viewParams(view).toString();
  const serverKey = useRef(key);
  // The view the rows on screen belong to: a reload of the same view keeps
  // them up while it fetches, so a tick doesn't blank the whole table.
  const shownKey = useRef(key);

  // The URL carries the view. replaceState, not router.replace: no server
  // round trip for a filter change.
  useEffect(() => {
    const url = new URL(window.location.href);
    url.search = key;
    window.history.replaceState(null, "", url);
  }, [key]);

  useEffect(() => {
    // The server rendered this view already; fetch only once something
    // changes. A key compare, not a first-run flag: dev re-runs effects.
    if (key === serverKey.current && reloadKey === 0) return;
    serverKey.current = "";
    let ignore = false;
    if (key !== shownKey.current) setState({ status: "loading" });
    shownKey.current = key;
    const params = new URLSearchParams(key);
    params.set("limit", String(LIMIT));
    fetch(`/api/tasks?${params}`)
      .then(async (res) => {
        const body = await res.json();
        if (ignore) return;
        if (!res.ok)
          setState({
            status: "error",
            message: body.error?.message ?? "Couldn't load the tasks.",
          });
        // The last row of a later page was ticked away: step back a page
        // rather than show an empty one.
        else if (!body.data.length && body.page.page > 1)
          setView((v) => ({ ...v, page: v.page - 1 }));
        else setState({ status: "ready", result: body });
      })
      .catch(() => {
        if (!ignore)
          setState({
            status: "error",
            message: "Couldn't load the tasks — check your connection.",
          });
      });
    return () => {
      ignore = true;
    };
  }, [key, reloadKey]);

  const reload = () => setReloadKey((k) => k + 1);
  const change = (next: Partial<View>) =>
    setView((v) => ({ ...v, page: 1, ...next }));

  async function patch(
    task: Pick<TaskRow, "id" | "version">,
    action: "complete" | "reopen",
  ): Promise<{ ok: true; task: TaskRow } | { ok: false; message: string }> {
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "If-Match": String(task.version),
      },
      body: JSON.stringify({ action }),
    }).catch(() => null);
    if (!res)
      return { ok: false, message: "Couldn't save — check your connection." };
    const data = await res.json().catch(() => null);
    if (res.ok) return { ok: true, task: data as TaskRow };
    return {
      ok: false,
      message:
        data?.error?.message ??
        (res.status === 409
          ? "This task changed since you loaded it."
          : "Couldn't save this task. Try again."),
    };
  }

  async function complete(task: TaskRow) {
    setPending(task.id);
    const result = await patch(task, "complete");
    setPending(null);
    if (!result.ok) {
      setToast(result.message);
      reload();
      return;
    }
    // Leaves the list now; Undo puts it back from the server's copy.
    setState((s) =>
      s.status === "ready"
        ? {
            status: "ready",
            result: {
              data: s.result.data.filter((r) => r.id !== task.id),
              page: { ...s.result.page, total: s.result.page.total - 1 },
            },
          }
        : s,
    );
    // Re-read the page: the server's offsets moved with the closed task, and
    // the row after it belongs on this page now.
    reload();
    setToast(
      <>
        Done: {task.title}.{" "}
        <button
          type="button"
          className="font-semibold underline"
          onClick={() => undo(result.task)}
        >
          Undo
        </button>
      </>,
    );
  }

  async function undo(done: TaskRow) {
    const result = await patch(done, "reopen");
    setToast(result.ok ? `Reopened: ${done.title}.` : result.message);
    reload();
  }

  const rows = state.status === "ready" ? state.result.data : [];
  const result = state.status === "ready" ? state.result : null;
  const everyone = access.canSeeEveryone && !view.mine;
  const filtered = !!view.type || (everyone && !!view.assignee);
  const columns = 4 + (access.canWrite ? 1 : 0) + (everyone ? 1 : 0);

  return (
    <div className="flex flex-col gap-4">
      <ListHeader title="Tasks" />

      <FilterRow>
        {access.canSeeEveryone && (
          <div
            role="group"
            aria-label="Whose tasks"
            className="border-line-strong flex overflow-hidden rounded-sm border"
          >
            {[
              [true, "My tasks"],
              [false, "Everyone"],
            ].map(([mine, label]) => (
              <button
                key={String(mine)}
                type="button"
                aria-pressed={view.mine === mine}
                onClick={() => change({ mine: mine as boolean, assignee: "" })}
                className={`focus-visible:outline-focus-ring h-8 px-3 text-[13px] focus-visible:outline-2 focus-visible:-outline-offset-2 ${
                  view.mine === mine
                    ? "bg-surface-raised text-ink font-semibold"
                    : "bg-surface-sunken text-ink-muted"
                }`}
              >
                {label as string}
              </button>
            ))}
          </div>
        )}
        {everyone && (
          <FilterSelect
            label="Assigned"
            value={view.assignee}
            onChange={(assignee) => change({ assignee })}
            options={[
              ["unassigned", "Unassigned"],
              ...users.map((u): [string, string] => [u.id, u.fullName]),
            ]}
          />
        )}
        <FilterSelect
          label="Type"
          value={view.type}
          onChange={(type) => change({ type })}
          options={Object.entries(TASK_TYPE_LABELS)}
        />
      </FilterRow>

      {state.status === "error" ? (
        <ListError message={state.message} onRetry={reload} />
      ) : result && result.page.total === 0 && !filtered ? (
        // §13 empty state: says what is true and what to do next, with no
        // table header over nothing.
        <div className="border-line bg-surface-raised text-ink-muted rounded-md border px-5 py-10 text-center text-sm">
          <ListTodo aria-hidden="true" className="mx-auto mb-2 size-5" />
          <p className="text-ink font-medium">
            {everyone ? "No open tasks for anyone." : "Nothing to do."}
          </p>
          <p className="mt-1">
            Add a task from a person, deal or enrolment, and it shows up here.
          </p>
        </div>
      ) : (
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                {access.canWrite && (
                  <TableHead className="w-12">
                    <span className="sr-only">Done</span>
                  </TableHead>
                )}
                <TableHead>Task</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>About</TableHead>
                <TableHead>Due</TableHead>
                {everyone && <TableHead>Assigned</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {state.status === "loading" ? (
                <SkeletonRows columns={columns} />
              ) : rows.length === 0 ? (
                <EmptyRow columns={columns}>
                  No open tasks match these filters.{" "}
                  <button
                    type="button"
                    className="text-blue-ink font-semibold"
                    onClick={() => change({ assignee: "", type: "" })}
                  >
                    Clear filters
                  </button>
                </EmptyRow>
              ) : (
                rows.map((task) => {
                  const Icon = TASK_ICONS[task.type] ?? ListTodo;
                  const cells = (
                    <>
                      {access.canWrite && (
                        <TableCell>
                          {CLOSES_ELSEWHERE[task.type] ? (
                            // Closes where its work is done, not with a tick
                            // (decided 12 Nov); the row still opens it.
                            <span
                              title={CLOSES_ELSEWHERE[task.type]}
                              className="border-line-strong block size-5 rounded-full border-2 border-dashed"
                            >
                              <span className="sr-only">
                                {CLOSES_ELSEWHERE[task.type]}
                              </span>
                            </span>
                          ) : (
                            <button
                              type="button"
                              disabled={pending === task.id}
                              aria-label={`Mark done: ${task.title}`}
                              onClick={() => complete(task)}
                              className={`group focus-visible:outline-focus-ring flex size-5 items-center justify-center rounded-full border-2 focus-visible:outline-2 focus-visible:outline-offset-2 ${
                                task.isOverdue
                                  ? "border-danger"
                                  : "border-line-strong"
                              } hover:border-success hover:bg-success-soft disabled:opacity-50`}
                            >
                              <Check
                                aria-hidden="true"
                                className="text-success size-3 opacity-0 group-hover:opacity-100"
                              />
                            </button>
                          )}
                        </TableCell>
                      )}
                      <TableCell className="text-ink max-w-80 truncate font-medium">
                        {access.canWrite ? (
                          <button
                            type="button"
                            className="focus-visible:outline-focus-ring max-w-full truncate text-left hover:underline focus-visible:outline-2"
                            onClick={() => setEditing(task)}
                          >
                            {task.title}
                          </button>
                        ) : (
                          task.title
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="text-ink-muted inline-flex items-center gap-1.5 text-xs">
                          <Icon aria-hidden="true" className="size-3" />
                          {TASK_TYPE_LABELS[task.type] ??
                            TASK_TYPE_LABELS.other}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-64 truncate">
                        {task.about?.href ? (
                          <Link
                            href={task.about.href}
                            className="text-blue-ink hover:underline"
                          >
                            {task.about.label}
                          </Link>
                        ) : (
                          (task.about?.label ?? "—")
                        )}
                        {task.about?.detail && (
                          <span className="text-ink-muted">
                            {" "}
                            · {task.about.detail}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        <DueCell task={task} />
                      </TableCell>
                      {everyone && (
                        <TableCell className="text-ink-muted">
                          {task.assigneeName ?? "Unassigned"}
                        </TableCell>
                      )}
                    </>
                  );
                  // Writers open the task to edit it; readers go to what
                  // it is about (§9.14 spec).
                  if (access.canWrite)
                    return (
                      <TableRow
                        key={task.id}
                        className="cursor-pointer"
                        onClick={(e) => {
                          if ((e.target as HTMLElement).closest("a, button"))
                            return;
                          setEditing(task);
                        }}
                      >
                        {cells}
                      </TableRow>
                    );
                  return task.about?.href ? (
                    <LinkRow key={task.id} href={task.about.href}>
                      {cells}
                    </LinkRow>
                  ) : (
                    <TableRow key={task.id}>{cells}</TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableCard>
      )}

      {result && (
        <Pagination
          page={view.page}
          limit={LIMIT}
          total={result.page.total}
          onPage={(page) => setView((v) => ({ ...v, page }))}
        />
      )}

      {access.canWrite && (
        <TaskDialog
          open={!!editing}
          onOpenChange={(open) => !open && setEditing(null)}
          task={editing ?? undefined}
          viewerId={access.viewerId}
          assignedOnly={access.assignedOnly}
          knownUsers={users}
          onSaved={(_task, message) => {
            setToast(message);
            reload();
          }}
        />
      )}

      <Toast message={toast} onDismiss={dismissToast} />
    </div>
  );
}
