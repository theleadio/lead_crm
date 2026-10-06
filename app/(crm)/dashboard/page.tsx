import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteClass, permissionFor } from "@/lib/auth/permissions";
import { formatDate } from "@/lib/format/date";
import {
  myOpenDeals,
  myTasks,
  needsAttention,
  upcomingClasses,
} from "@/lib/home/service";
import { ClassesPanel } from "./classes-panel";
import { DealsPanel } from "./deals-panel";
import { NeedsAttentionPanel } from "./needs-attention-panel";
import { PanelError } from "./panel-kit";
import { TasksPanel } from "./tasks-panel";

const DAY = 24 * 60 * 60 * 1000;

// Spec §4: greet on the viewer's clock, not the server's.
function greeting(now: Date): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: "Asia/Kuala_Lumpur",
    }).format(now),
  );
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function weekday(now: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(now);
}

// Each panel loads on its own: one failing query leaves the rest of Home
// usable (§13), and the reason is logged rather than swallowed.
async function panel<T>(name: string, load: () => Promise<T>) {
  try {
    return { ok: true as const, data: await load() };
  } catch (err) {
    console.error(`[home] ${name} panel failed`, err);
    return { ok: false as const };
  }
}

// Spec §9.0 Home: a work page, not analytics — no charts, no custom
// metrics, no writes. Panels a role cannot act on are absent, not empty
// (§6); the services re-check every permission the page checks here.
export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const canReadDeals = permissionFor(user, "deal", "read").allowed;
  const canReadClasses = permissionFor(user, "class", "read").allowed;
  const peopleWrite = permissionFor(user, "person", "write");
  // The panel has a row per item, each with its own permission (§9.0), so it
  // loads for any role that can act on at least one of them.
  const canReviewPeople = peopleWrite.allowed && !peopleWrite.assignedOnly;
  const canAttend = canReviewPeople || canWriteClass(user);

  const [tasks, deals, classes, attention] = await Promise.all([
    panel("tasks", () => myTasks(user)),
    canReadDeals ? panel("deals", () => myOpenDeals(user)) : null,
    canReadClasses ? panel("classes", () => upcomingClasses(user)) : null,
    canAttend ? panel("needs attention", () => needsAttention(user)) : null,
  ]);

  const now = new Date();
  const dueLine = tasks.ok
    ? `${tasks.data.todayCount} ${tasks.data.todayCount === 1 ? "task" : "tasks"} due today, ${tasks.data.overdueCount} overdue`
    : "task counts unavailable";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[28px] leading-tight font-bold">
            {greeting(now)}, {user.fullName.split(" ")[0]}
          </h1>
          <p className="text-ink-muted text-sm">
            {weekday(now)}, {formatDate(now)} · {dueLine}
          </p>
        </div>
        {canReadDeals && (
          <Link
            href="/deals"
            className="bg-primary focus-visible:outline-focus-ring rounded-full px-4.5 py-2.5 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Open deals board
          </Link>
        )}
      </header>

      {deals &&
        (deals.ok ? (
          <DealsPanel totals={deals.data} />
        ) : (
          <PanelError what="your open deals" />
        ))}

      <div className="flex flex-col gap-4 lg:flex-row">
        {tasks.ok ? (
          <TasksPanel data={tasks.data} />
        ) : (
          <div className="min-w-0 flex-1">
            <PanelError what="your tasks" />
          </div>
        )}
        {attention &&
          (attention.ok ? (
            <NeedsAttentionPanel data={attention.data} />
          ) : (
            <div className="w-full lg:w-100">
              <PanelError what="the needs-attention queue" />
            </div>
          ))}
      </div>

      {classes &&
        (classes.ok ? (
          <ClassesPanel
            classes={classes.data}
            windowLabel={`${formatDate(now)} – ${formatDate(new Date(now.getTime() + 14 * DAY))}`}
          />
        ) : (
          <PanelError what="upcoming classes" />
        ))}
    </div>
  );
}
