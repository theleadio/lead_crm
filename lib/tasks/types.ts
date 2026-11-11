// Spec §5 `task`, as the §9.14 Tasks screen reads and writes it.

export type TaskAbout = {
  // The person's name, or "Unnamed" (no phone fallback: see list.ts).
  label: string;
  // Course or class code, only from a record the viewer may read (design 6).
  detail: string | null;
  // The first record the viewer may open: enrolment, deal, person.
  href: string | null;
};

export type TaskRow = {
  id: string;
  // Integer row version (migration 005); every write sends it as If-Match.
  version: number;
  type: string;
  title: string;
  notes: string | null;
  about: TaskAbout | null;
  assignedUserId: string | null;
  assigneeName: string | null;
  // ISO instant, plus the same moment as a Kuala Lumpur date and HH:MM for
  // the dialog, so the browser never converts time zones (design 5).
  dueAt: string | null;
  dueDate: string | null;
  dueTime: string | null;
  // Decided by the database's clock, not the browser's.
  isOverdue: boolean;
  isDone: boolean;
};

// What a write returns; the routes map each kind to one §13 status.
export type TaskWriteResult =
  | { kind: "ok"; task: TaskRow }
  | { kind: "not_found" }
  // A part-timer handing their task to someone else (§6 "A": theirs only).
  | { kind: "forbidden" }
  | { kind: "stale" }
  | { kind: "inactive_user" }
  // 422: the due time of an hrdc_deadline task follows the deal (§12.6).
  | { kind: "due_locked" }
  // 409 other than stale: already done, already open, withdrawn, or a
  // one-open-task index holds another open task (design 4).
  | { kind: "conflict"; message: string };
