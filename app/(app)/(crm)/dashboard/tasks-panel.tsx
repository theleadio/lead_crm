import Link from "next/link";
import {
  CalendarClock,
  ChevronRight,
  CreditCard,
  FileDown,
  ListTodo,
  Phone,
  Send,
  Users,
  type LucideIcon,
} from "lucide-react";
import { formatOverdue, formatTime } from "@/lib/format/date";
import {
  TASK_TYPE_LABELS,
  type HomeTask,
  type HomeTasks,
} from "@/lib/home/types";

const TASK_ICONS: Record<string, LucideIcon> = {
  call: Phone,
  follow_up: Send,
  review_duplicate: Users,
  match_payment: CreditCard,
  hrdc_deadline: CalendarClock,
  export_request: FileDown,
  other: ListTodo,
};

// Spec §9.0: read-only. The ring is a status marker, not a checkbox —
// completing a task is 9.14's job, and a dead control that looks live is
// worse than none.
function TaskRow({ task }: { task: HomeTask }) {
  const Icon = TASK_ICONS[task.type] ?? ListTodo;
  const row = (
    <>
      <span
        aria-hidden="true"
        className={`size-5 shrink-0 rounded-full border-2 ${
          task.isOverdue ? "border-danger" : "border-line-strong"
        }`}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-ink truncate text-sm font-semibold">
          {task.title}
        </span>
        <span className="text-ink-muted truncate text-xs">
          {task.who ?? "—"}
        </span>
      </span>
      <span className="bg-surface-sunken text-ink-muted hidden w-33 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs md:inline-flex">
        <Icon aria-hidden="true" className="size-3" />
        <span className="truncate">
          {TASK_TYPE_LABELS[task.type] ?? TASK_TYPE_LABELS.other}
        </span>
      </span>
      <span
        className={`w-24 shrink-0 text-xs ${
          task.isOverdue ? "text-danger font-semibold" : "text-ink-muted"
        }`}
      >
        {task.isOverdue ? formatOverdue(task.dueAt) : formatTime(task.dueAt)}
      </span>
    </>
  );

  const className =
    "border-line flex items-center gap-3.5 border-b px-5 py-3.5 last:border-b-0";
  return task.href ? (
    <Link
      href={task.href}
      className={`${className} hover:bg-surface-muted focus-visible:outline-focus-ring focus-visible:outline-2 focus-visible:-outline-offset-2`}
    >
      {row}
    </Link>
  ) : (
    <div className={className}>{row}</div>
  );
}

function GroupLabel({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: "overdue" | "today";
}) {
  return (
    <div className="border-line bg-surface-muted flex items-center gap-2 border-y px-5 py-2">
      <span
        className={`text-[11px] font-bold tracking-wider ${
          tone === "overdue" ? "text-danger" : "text-ink-muted"
        }`}
      >
        {label}
      </span>
      <span className="text-ink-subtle text-[11px] font-semibold">{count}</span>
    </div>
  );
}

export function TasksPanel({ data }: { data: HomeTasks }) {
  const overdue = data.tasks.filter((t) => t.isOverdue);
  const today = data.tasks.filter((t) => !t.isOverdue);

  return (
    <section className="border-line bg-surface-raised flex min-w-0 flex-1 flex-col overflow-hidden rounded-md border">
      <header className="flex items-center justify-between gap-3 px-5 py-4.5">
        <div className="flex items-center gap-2.5">
          <h2 className="text-base font-bold">My tasks</h2>
          <span className="bg-surface-sunken text-ink-muted rounded-full px-2 py-0.5 text-xs font-semibold">
            {data.overdueCount + data.todayCount}
          </span>
        </div>
        <Link
          href="/tasks"
          className="text-blue-ink flex items-center gap-1 text-[13px] font-semibold"
        >
          All tasks
          <ChevronRight aria-hidden="true" className="size-3.5" />
        </Link>
      </header>

      {data.tasks.length === 0 ? (
        <div className="border-line text-ink-muted flex-1 border-t px-5 py-10 text-center text-sm">
          <p className="text-ink font-medium">Nothing due today.</p>
          <p className="mt-1">
            Overdue work and today&apos;s tasks show up here.{" "}
            <Link href="/tasks" className="text-blue-ink font-semibold">
              See every open task
            </Link>
            .
          </p>
        </div>
      ) : (
        <>
          {overdue.length > 0 && (
            <GroupLabel
              label="OVERDUE"
              count={data.overdueCount}
              tone="overdue"
            />
          )}
          {overdue.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
          {today.length > 0 && (
            <GroupLabel label="TODAY" count={data.todayCount} tone="today" />
          )}
          {today.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
          {data.moreCount > 0 && (
            <Link
              href="/tasks"
              className="border-line text-blue-ink border-t px-5 py-3 text-[13px] font-semibold"
            >
              {data.moreCount} more on the Tasks screen →
            </Link>
          )}
        </>
      )}
    </section>
  );
}
