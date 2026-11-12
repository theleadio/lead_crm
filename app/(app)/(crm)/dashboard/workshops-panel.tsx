import { kualaLumpurDay } from "@/lib/validation/report";
import { formatDate } from "@/lib/format/date";
import type { HomeWorkshop } from "@/lib/home/types";
import { daysUntil, startsLabel } from "./classes-panel";
import { WorkshopGoal } from "./workshop-goal";

// Home, 12 Nov 2026: free workshops in the next 14 days with how many people
// registered on their GHL sign-up form. Free workshops are not CRM classes yet,
// so a card has nowhere to link to.
export function WorkshopsPanel({
  workshops,
  windowLabel,
  canSetGoal,
}: {
  workshops: HomeWorkshop[];
  windowLabel: string;
  // super_admin, management, marketing and operations (canSetWorkshopGoal).
  canSetGoal: boolean;
}) {
  const today = kualaLumpurDay();

  return (
    <section className="flex flex-col gap-3.5">
      <header className="flex flex-wrap items-center gap-2.5">
        <h2 className="text-lg font-bold">Free workshops</h2>
        <span className="bg-surface-sunken text-ink-muted rounded-full px-2 py-0.5 text-xs font-semibold">
          {workshops.length}
        </span>
        <span className="text-ink-muted text-[13px]">
          Next 14 days · {windowLabel}
        </span>
      </header>

      {workshops.length === 0 ? (
        <div className="border-line bg-surface-raised text-ink-muted rounded-md border px-5 py-6 text-sm">
          <p className="text-ink font-medium">
            No free workshop in the next 14 days.
          </p>
          <p className="mt-1">
            A workshop appears here once people register on its sign-up form.
          </p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {workshops.map((w) => (
            <li key={`${w.title}|${w.language}|${w.date}`}>
              <div className="border-line bg-surface-raised flex h-full flex-col gap-4 rounded-md border p-5">
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-[13px] font-bold">
                    {w.title}
                  </span>
                  <span className="text-ink-muted text-xs">
                    {formatDate(`${w.date}T00:00:00Z`)} ·{" "}
                    {w.language === "zh" ? "中文" : "English"}
                  </span>
                </span>
                {w.goal ? (
                  <SignupBar signups={w.signups} goal={w.goal} />
                ) : (
                  <span className="flex items-end gap-1.5">
                    <span className="text-[28px] leading-none font-bold tabular-nums">
                      {w.signups}
                    </span>
                    <span className="text-ink-muted text-[13px]">
                      {w.signups === 1 ? "sign-up" : "sign-ups"}
                    </span>
                  </span>
                )}
                <span className="mt-auto flex flex-col gap-3">
                  {canSetGoal && <WorkshopGoal workshop={w} />}
                  <span className="text-ink-muted text-xs">
                    {startsLabel(daysUntil(w.date, today))}
                  </span>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Built like the class card's seats bar: the count is written out beside the
// bar, so the colour is never the only signal (§13). Past the goal the bar
// stays full while the count and the percentage keep going.
function SignupBar({ signups, goal }: { signups: number; goal: number }) {
  const share = Math.round((signups / goal) * 100);
  return (
    <span className="flex flex-col gap-2">
      <span className="flex items-end justify-between gap-2">
        <span className="flex items-end gap-1.5">
          <span className="text-[28px] leading-none font-bold tabular-nums">
            {signups}
          </span>
          <span className="text-ink-muted text-[13px]">
            / {goal} sign-up goal
          </span>
        </span>
        <span className="text-ink-muted text-[13px] tabular-nums">
          {share}%
        </span>
      </span>
      <span className="bg-surface-sunken h-2 overflow-hidden rounded-full">
        <span
          className="bg-success block h-full rounded-full"
          style={{ width: `${Math.min(100, share)}%` }}
        />
      </span>
    </span>
  );
}
