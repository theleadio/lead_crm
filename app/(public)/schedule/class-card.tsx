import { Badge } from "@/components/ui/badge";
import { formatDateRange } from "@/lib/format/date";
import { formatMoneyMyr } from "@/lib/format/money";
import type { ScheduleClass } from "@/lib/public/schedule";
import {
  LANGUAGE_LABEL,
  SEATS_LABEL,
  placeLabel,
  registerControl,
  timeLabel,
} from "./schedule-view";

// One public class (§10.1). Everything it shows comes from the §8.1 feed, so
// there is no seat count, capacity, joining link or trainer to leak here.

export function ClassCard({ cls }: { cls: ScheduleClass }) {
  const time = timeLabel(cls);
  const control = registerControl(cls);

  return (
    <article
      aria-label={cls.courseName}
      className="border-line bg-surface-raised flex flex-col gap-3 rounded-2xl border p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-ink text-lg font-semibold">{cls.courseName}</h2>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <Badge variant="outline">
            {LANGUAGE_LABEL[cls.language] ?? cls.language}
          </Badge>
          {cls.hrdcClaimable && <Badge variant="success">HRDC claimable</Badge>}
        </div>
      </div>

      <dl className="text-ink-muted grid gap-1 text-sm">
        <div className="flex gap-2">
          <dt className="sr-only">Dates</dt>
          <dd>
            {formatDateRange(cls.startDate, cls.endDate)}
            {time && <span className="text-ink-subtle"> · {time}</span>}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="sr-only">Where</dt>
          <dd>{placeLabel(cls)}</dd>
        </div>
        {cls.priceMyr && (
          <div className="flex gap-2">
            <dt className="sr-only">Price</dt>
            <dd className="text-ink font-medium">
              {formatMoneyMyr(cls.priceMyr)}
            </dd>
          </div>
        )}
      </dl>

      <div className="mt-auto flex items-center justify-between gap-3 pt-1">
        <span
          className={
            cls.seatsLabel === "full"
              ? "text-ink-subtle text-sm"
              : "text-ink-muted text-sm"
          }
        >
          {SEATS_LABEL[cls.seatsLabel] ?? cls.seatsLabel}
        </span>
        {control.href ? (
          <a
            href={control.href}
            className="bg-lead-yellow text-on-yellow focus-visible:ring-focus-ring rounded-full px-4 py-2 text-sm font-semibold focus-visible:ring-2 focus-visible:outline-none"
          >
            {control.label}
          </a>
        ) : (
          <button
            type="button"
            disabled
            aria-disabled="true"
            className="bg-surface-muted text-ink-subtle cursor-not-allowed rounded-full px-4 py-2 text-sm font-semibold"
          >
            {control.label}
          </button>
        )}
      </div>
    </article>
  );
}
