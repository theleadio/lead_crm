"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { agingTone, daysInStage, initials } from "@/lib/deals/format";
import { STAGE_LABELS, STAGES, type DealCard as Deal } from "@/lib/deals/types";
import { formatMoneyMyr } from "@/lib/format/money";

// design.pen DealCard: the days-in-stage pill, tinted by aging tone.
const TONE = {
  none: "bg-muted text-ink-muted",
  amber: "bg-warning-soft text-warning",
  red: "bg-danger-soft text-danger",
};

// Same names the stage route's corporate_fields_missing uses (§12.5), so a
// card and a refused move say the same thing.
const FIELD_LABELS: Record<string, string> = {
  companyId: "company",
  headcount: "headcount",
  fundingType: "funding type",
};

// Spec §9.5 card: person, course, value, owner initials, days in stage.
// Write roles can drag it or use "Move to…" (the keyboard and touch path);
// both call the same onMove.
export function DealCard({
  deal,
  canWrite,
  busy,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  deal: Deal;
  canWrite: boolean;
  busy: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMove: (toStage: string) => void;
}) {
  const router = useRouter();
  const href = `/deals/${deal.id}`;
  const days = daysInStage(deal.stageChangedAt);
  const draggable = canWrite && !busy;

  return (
    <li
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", deal.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a, select")) return;
        router.push(href);
      }}
      aria-busy={busy}
      className={`border-line bg-surface-raised space-y-2.5 rounded-md border p-4 text-sm ${
        draggable ? "cursor-grab" : "cursor-pointer"
      } ${busy ? "opacity-60" : ""}`}
    >
      {/* Not draggable itself, so a drag moves the card, not the URL. */}
      <Link
        href={href}
        draggable={false}
        className="text-ink focus-visible:outline-focus-ring block font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {deal.person.fullName}
      </Link>
      <p className="text-ink-muted truncate text-xs">
        {deal.course?.name ?? "No course"}
      </p>
      {/* §12.5: this corporate deal cannot leave discovery yet. Muted, not
          amber or red — those mean stage aging, and this deal is not late. */}
      {deal.missingFields.length > 0 && (
        <p
          title={`Needs ${deal.missingFields.map((f) => FIELD_LABELS[f] ?? f).join(", ")}`}
          className="bg-surface-sunken text-ink-muted inline-block rounded-sm px-1.5 text-xs font-medium"
        >
          <span aria-hidden="true">Incomplete</span>
          <span className="sr-only">
            Incomplete — needs{" "}
            {deal.missingFields.map((f) => FIELD_LABELS[f] ?? f).join(", ")}
          </span>
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] font-bold">
          {deal.amountMyr ? formatMoneyMyr(deal.amountMyr) : "—"}
        </span>
        <span className="flex items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${TONE[agingTone(deal.stage, days)]}`}
          >
            {days} {days === 1 ? "day" : "days"}
          </span>
          {deal.owner ? (
            <span
              title={deal.owner.fullName}
              className="bg-chart-2 flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
            >
              <span aria-hidden="true">{initials(deal.owner.fullName)}</span>
              <span className="sr-only">Owner: {deal.owner.fullName}</span>
            </span>
          ) : (
            <span
              title="No owner"
              className="border-line-strong size-6 shrink-0 rounded-full border border-dashed"
            >
              <span className="sr-only">No owner</span>
            </span>
          )}
        </span>
      </div>
      {canWrite && (
        <select
          aria-label={`Move ${deal.person.fullName} to…`}
          value=""
          disabled={busy}
          onChange={(e) => e.target.value && onMove(e.target.value)}
          className="border-line-strong bg-surface-sunken text-ink-muted focus-visible:outline-focus-ring h-7 w-full rounded-sm border px-2 text-xs focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <option value="">Move to…</option>
          {STAGES[deal.pipeline]
            .filter((s) => s !== deal.stage)
            .map((s) => (
              <option key={s} value={s}>
                {STAGE_LABELS[s]}
              </option>
            ))}
        </select>
      )}
    </li>
  );
}
