import Link from "next/link";
import { ChevronRight, MapPin, Monitor } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { classStatusBadge, seatBarColor } from "@/lib/classes/types";
import { formatDateRange } from "@/lib/format/date";
import type { HomeClass } from "@/lib/home/types";

export function ClassesPanel({
  classes,
  windowLabel,
}: {
  classes: HomeClass[];
  windowLabel: string;
}) {
  return (
    <section className="border-line bg-surface-raised flex flex-col overflow-hidden rounded-md border">
      <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-4.5">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-base font-bold">Upcoming classes</h2>
          <p className="text-ink-muted text-xs">Next 14 days · {windowLabel}</p>
        </div>
        <Link
          href="/classes"
          className="text-blue-ink flex items-center gap-1 text-[13px] font-semibold"
        >
          All classes
          <ChevronRight aria-hidden="true" className="size-3.5" />
        </Link>
      </header>

      {classes.length === 0 ? (
        <div className="border-line text-ink-muted border-t px-5 py-10 text-center text-sm">
          <p className="text-ink font-medium">No class starts in 14 days.</p>
          <p className="mt-1">
            Scheduled classes appear here as their start date comes up.{" "}
            <Link href="/classes" className="text-blue-ink font-semibold">
              Open Classes
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left">
            <thead className="border-line bg-surface-muted border-y">
              <tr className="text-ink-subtle text-[11px] font-bold tracking-wide">
                <th className="px-5 py-2.5 font-bold">CLASS</th>
                <th className="py-2.5 pr-4 font-bold">DATES</th>
                <th className="py-2.5 pr-4 font-bold">LANGUAGE</th>
                <th className="py-2.5 pr-4 font-bold">VENUE</th>
                <th className="w-55 py-2.5 pr-4 font-bold">SEATS SOLD</th>
                <th className="w-28 py-2.5 pr-5 font-bold">STATUS</th>
              </tr>
            </thead>
            <tbody>
              {classes.map((c) => {
                const status = classStatusBadge(c.status);
                const pct = Math.min(
                  100,
                  Math.round((c.sold / c.capacity) * 100),
                );
                return (
                  <tr key={c.id} className="border-line border-b last:border-0">
                    <td className="px-5 py-3">
                      <span className="block text-[13px] font-bold">
                        {c.code}
                      </span>
                      <span className="text-ink-muted block text-xs">
                        {c.courseName}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-[13px]">
                      {formatDateRange(c.startDate, c.endDate)}
                    </td>
                    <td className="text-ink-muted py-3 pr-4 text-[13px]">
                      {c.language === "zh" ? "中文" : "English"}
                    </td>
                    <td className="text-ink-muted py-3 pr-4 text-[13px]">
                      <span className="flex items-center gap-1.5">
                        {c.mode === "online" ? (
                          <Monitor
                            aria-hidden="true"
                            className="text-ink-subtle size-3.5"
                          />
                        ) : (
                          <MapPin
                            aria-hidden="true"
                            className="text-ink-subtle size-3.5"
                          />
                        )}
                        {c.mode === "online"
                          ? "Online"
                          : [c.venue, c.city].filter(Boolean).join(", ")}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <span className="flex items-center gap-2.5">
                        <span className="bg-surface-sunken h-1.5 flex-1 overflow-hidden rounded-full">
                          <span
                            className={`block h-full rounded-full ${seatBarColor(c.status)}`}
                            style={{ width: `${pct}%` }}
                          />
                        </span>
                        <span className="w-11 text-xs font-semibold">
                          {c.sold}/{c.capacity}
                        </span>
                      </span>
                    </td>
                    <td className="py-3 pr-5">
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
