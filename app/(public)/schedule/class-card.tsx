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
  // §14: the card is named by its own heading rather than a duplicate label,
  // and a disabled control says why in the same tree a screen reader walks.
  const headingId = `class-${cls.id}-name`;
  const reasonId = `class-${cls.id}-reason`;
  // The visible label is short so the control stays one line in a card this
  // narrow; the course name keeps the accessible name usable on its own, where
  // a screen reader lists the links out of context.
  const courseSuffix = <span className="sr-only"> — {cls.courseName}</span>;

  return (
    // The card is three rows of the list's own grid (row-span-3 + subgrid), so
    // the dates, the price and the control line up across every card in a row
    // however many lines a course name takes.
    <article
      aria-labelledby={headingId}
      className="border-line bg-surface-raised row-span-3 grid grid-rows-subgrid gap-3 rounded-2xl border p-5"
    >
      <div className="flex flex-col items-start gap-2">
        {/* §10.5: a Chinese class carries its own name, so the language has to
            be on the element or a screen reader reads it as English. */}
        <h2
          id={headingId}
          lang={cls.language === "zh" ? "zh" : undefined}
          className="text-ink text-lg font-semibold"
        >
          {cls.courseName}
        </h2>
        <div className="flex flex-wrap gap-1.5">
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
            className="bg-lead-yellow text-on-yellow focus-visible:ring-focus-ring shrink-0 rounded-full px-4 py-2 text-sm font-semibold whitespace-nowrap focus-visible:ring-2 focus-visible:outline-none"
          >
            {control.label}
            {courseSuffix}
          </a>
        ) : (
          <>
            <button
              type="button"
              disabled
              aria-disabled="true"
              aria-describedby={control.reason ? reasonId : undefined}
              className="bg-surface-muted text-ink-subtle shrink-0 cursor-not-allowed rounded-full px-4 py-2 text-sm font-semibold whitespace-nowrap"
            >
              {control.label}
              {courseSuffix}
            </button>
            {control.reason && (
              <span id={reasonId} className="sr-only">
                {control.reason}
              </span>
            )}
          </>
        )}
      </div>
    </article>
  );
}
