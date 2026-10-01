"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { agingTone, daysInStage, initials } from "@/lib/deals/format";
import { STAGE_LABELS, STAGES, type DealCard as Deal } from "@/lib/deals/types";
import { formatMoneyMyr } from "@/lib/format/money";

const TONE = {
  none: "text-ink-muted",
  amber: "bg-warning-soft text-warning rounded-sm px-1.5 font-medium",
  red: "bg-danger-soft text-danger rounded-sm px-1.5 font-medium",
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
      className={`border-line bg-surface-raised space-y-1 rounded-md border p-3 text-sm shadow-xs ${
        draggable ? "cursor-grab" : "cursor-pointer"
      } ${busy ? "opacity-60" : ""}`}
    >
      {/* Not draggable itself, so a drag moves the card, not the URL. */}
      <Link
        href={href}
        draggable={false}
        className="text-ink focus-visible:outline-focus-ring block font-medium hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {deal.person.fullName}
      </Link>
      <p className="text-ink-muted truncate">
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
      <div className="flex items-center justify-between gap-2 pt-1">
        <span>{deal.amountMyr ? formatMoneyMyr(deal.amountMyr) : "—"}</span>
        <span className={TONE[agingTone(deal.stage, days)]}>
          {days} {days === 1 ? "day" : "days"}
        </span>
        {deal.owner ? (
          <span
            title={deal.owner.fullName}
            className="bg-blue-soft text-blue-ink flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
          >
            <span aria-hidden="true">{initials(deal.owner.fullName)}</span>
            <span className="sr-only">Owner: {deal.owner.fullName}</span>
          </span>
        ) : (
          <span
            title="No owner"
            className="border-line-strong size-7 shrink-0 rounded-full border border-dashed"
          >
            <span className="sr-only">No owner</span>
          </span>
        )}
      </div>
      {canWrite && (
        <select
          aria-label={`Move ${deal.person.fullName} to…`}
          value=""
          disabled={busy}
          onChange={(e) => e.target.value && onMove(e.target.value)}
          className="border-input bg-surface text-ink-muted focus-visible:outline-focus-ring mt-1 h-7 w-full rounded-sm border px-2 text-xs focus-visible:outline-2 focus-visible:outline-offset-2"
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
