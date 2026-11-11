"use client";

import { useCallback, useEffect, useState } from "react";
import { DateField } from "@/components/date-field";
import { Toast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CREATABLE_TYPES, TASK_TYPE_LABELS } from "@/lib/tasks/labels";
import type { TaskRow } from "@/lib/tasks/types";

// Spec §9.14: one dialog creates a task from a person, deal or enrolment and
// edits one from the Tasks list (design 9). Type and links are fixed once the
// task exists; an hrdc_deadline task's due time follows the deal (§12.6).

export type TaskLink =
  { personId: string } | { dealId: string } | { enrolmentId: string };

type Option = { id: string; fullName: string };

const SELECT =
  "border-line-strong bg-surface-sunken text-ink focus-visible:outline-focus-ring mt-1 w-full rounded-md border p-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2";

type Form = {
  type: string;
  title: string;
  dueDate: string;
  dueTime: string;
  assignee: string;
  notes: string;
};

function initialForm(task: TaskRow | undefined, viewerId: string): Form {
  return {
    type: task?.type ?? "follow_up",
    title: task?.title ?? "",
    dueDate: task?.dueDate ?? "",
    dueTime: task?.dueTime ?? "",
    assignee: task ? (task.assignedUserId ?? "") : viewerId,
    notes: task?.notes ?? "",
  };
}

type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Edit when given, create otherwise (then `link` names the record).
  task?: TaskRow;
  link?: TaskLink;
  viewerId: string;
  // A part-timer's tasks are always their own: no assignee picker (§6 "A").
  assignedOnly: boolean;
  onSaved: (task: TaskRow, message: string) => void;
  // The assignee options, when the screen already has them (the Tasks list);
  // otherwise the dialog fetches them once it opens.
  knownUsers?: Option[];
};

// A fresh form each time the dialog opens, for this task: the key remounts it.
export function TaskDialog(props: DialogProps) {
  return (
    <TaskDialogForm
      key={props.open ? (props.task?.id ?? "new") : "closed"}
      {...props}
    />
  );
}

function TaskDialogForm({
  open,
  onOpenChange,
  task,
  link,
  viewerId,
  assignedOnly,
  onSaved,
  knownUsers,
}: DialogProps) {
  const [form, setForm] = useState<Form>(() => initialForm(task, viewerId));
  const [users, setUsers] = useState<Option[] | null>(knownUsers ?? null);
  const [saving, setSaving] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const dueLocked = task?.type === "hrdc_deadline";

  useEffect(() => {
    if (!open || assignedOnly || users) return;
    fetch("/api/users/options")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((body: { data: Option[] }) => setUsers(body.data))
      .catch(() => setUsers([]));
  }, [open, assignedOnly, users]);

  const set = (key: keyof Form) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Edit sends only what changed, so the audit row names only that (design 8).
  function body(): Record<string, unknown> {
    // No date means no time either: the time box is disabled then, and a
    // left-over time would be refused against a field nobody can edit.
    const due = {
      dueDate: form.dueDate || null,
      dueTime: (form.dueDate && form.dueTime) || null,
    };
    if (!task)
      return {
        ...link,
        type: form.type,
        title: form.title,
        ...due,
        assignee: assignedOnly ? null : form.assignee || null,
        notes: form.notes,
      };
    const changes: Record<string, unknown> = { action: "edit" };
    if (form.title !== task.title) changes.title = form.title;
    if (form.notes !== (task.notes ?? "")) changes.notes = form.notes;
    if (!assignedOnly && form.assignee !== (task.assignedUserId ?? ""))
      changes.assignee = form.assignee || null;
    if (
      !dueLocked &&
      (form.dueDate !== (task.dueDate ?? "") ||
        form.dueTime !== (task.dueTime ?? ""))
    )
      Object.assign(changes, due);
    return changes;
  }

  async function save() {
    setSaving(true);
    setFields({});
    setError(null);
    const res = await fetch(task ? `/api/tasks/${task.id}` : "/api/tasks", {
      method: task ? "PATCH" : "POST",
      headers: {
        "Content-Type": "application/json",
        ...(task ? { "If-Match": String(task.version) } : {}),
      },
      body: JSON.stringify(body()),
    }).catch(() => null);
    setSaving(false);
    if (!res) {
      setError(
        "Couldn't save — check your connection. Your text is still here.",
      );
      return;
    }
    const data = await res.json().catch(() => null);
    if (res.ok) {
      onSaved(data as TaskRow, task ? "Task saved." : "Task added.");
      onOpenChange(false);
      return;
    }
    // Typed values stay; the server's field messages go beside their fields.
    setFields(data?.error?.fields ?? {});
    setError(data?.error?.message ?? "Couldn't save this task. Try again.");
  }

  const fieldError = (name: string) =>
    fields[name] ? (
      <span role="alert" className="text-danger mt-1 block text-xs">
        {fields[name]}
      </span>
    ) : null;

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{task ? "Edit task" : "Add task"}</DialogTitle>
          {task?.about && (
            <DialogDescription>
              About {task.about.label}
              {task.about.detail ? ` · ${task.about.detail}` : ""}
            </DialogDescription>
          )}
        </DialogHeader>

        <label className="text-sm">
          Type
          {task &&
          !(CREATABLE_TYPES as readonly string[]).includes(task.type) ? (
            <span className="text-ink mt-1 block">
              {TASK_TYPE_LABELS[task.type] ?? TASK_TYPE_LABELS.other}
            </span>
          ) : (
            <select
              className={SELECT}
              value={form.type}
              disabled={!!task}
              onChange={(e) => set("type")(e.target.value)}
            >
              {CREATABLE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TASK_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          )}
          {fieldError("type")}
        </label>

        <label className="text-sm">
          What needs doing
          <Input
            className="mt-1"
            value={form.title}
            maxLength={200}
            placeholder="e.g. Call back about the HRDC form"
            onChange={(e) => set("title")(e.target.value)}
          />
          {fieldError("title")}
        </label>

        {dueLocked ? (
          <p className="text-ink-muted text-sm">
            Due on the deal&apos;s HRDC deadline. Change the deadline on the
            deal to move it.
          </p>
        ) : (
          <div className="grid grid-cols-[1fr_8rem] gap-3">
            <label className="text-sm">
              Due date (optional)
              <DateField
                className="mt-1"
                value={form.dueDate}
                aria-label="Due date"
                onChange={set("dueDate")}
              />
              {fieldError("dueDate")}
            </label>
            <label className="text-sm">
              Time
              <Input
                className="mt-1"
                type="time"
                value={form.dueTime}
                disabled={!form.dueDate}
                onChange={(e) => set("dueTime")(e.target.value)}
              />
              {fieldError("dueTime")}
            </label>
            <p className="text-ink-muted col-span-2 -mt-1 text-xs">
              No time means 7pm, the end of the working day (Kuala Lumpur).
            </p>
          </div>
        )}

        {!assignedOnly && (
          <label className="text-sm">
            Assigned to
            <select
              className={SELECT}
              value={form.assignee}
              onChange={(e) => set("assignee")(e.target.value)}
            >
              <option value="">Unassigned</option>
              {/* Until the list arrives, keep the current choice selectable. */}
              {!users?.some((u) => u.id === form.assignee) && form.assignee && (
                <option value={form.assignee}>
                  {form.assignee === viewerId
                    ? "Me"
                    : (task?.assigneeName ?? "Current assignee")}
                </option>
              )}
              {users?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.id === viewerId ? `${u.fullName} (me)` : u.fullName}
                </option>
              ))}
            </select>
            {fieldError("assignee")}
          </label>
        )}

        <label className="text-sm">
          Notes (optional)
          <textarea
            className={SELECT}
            rows={3}
            maxLength={2000}
            value={form.notes}
            onChange={(e) => set("notes")(e.target.value)}
          />
          {fieldError("notes")}
        </label>

        {error && (
          <p role="alert" className="text-danger text-sm">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button disabled={saving || !form.title.trim()} onClick={save}>
            {saving ? "Saving…" : task ? "Save" : "Add task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// The "Add task" control on person, deal and enrolment detail (§9.14 "create
// task from any person/deal/enrolment screen"). The caller decides whether
// the viewer may write tasks. A screen that reloads itself after the save
// passes `onAdded` and shows the message in its own toast: the reload
// unmounts this control, and a toast kept here would go with it.
export function AddTask({
  link,
  viewerId,
  assignedOnly,
  onAdded,
}: {
  link: TaskLink;
  viewerId: string;
  assignedOnly: boolean;
  onAdded?: (message: React.ReactNode) => void;
}) {
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<React.ReactNode>(null);
  const dismiss = useCallback(() => setToast(null), []);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Add task
      </Button>
      <TaskDialog
        open={open}
        onOpenChange={setOpen}
        link={link}
        viewerId={viewerId}
        assignedOnly={assignedOnly}
        onSaved={(task) => {
          const message = (
            <>
              Task added: {task.title}.{" "}
              <a href="/tasks" className="underline">
                Open Tasks
              </a>
            </>
          );
          if (onAdded) onAdded(message);
          else setToast(message);
        }}
      />
      <Toast message={toast} onDismiss={dismiss} />
    </>
  );
}
