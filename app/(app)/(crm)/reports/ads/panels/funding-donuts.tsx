import type { FundingBreakdowns, FundingSlice } from "@/lib/reports/funding";
import { PanelCard } from "./panel-card";

// §9.18: who pays, as one ring per cut — all seats, by programme length, by
// language. A ring is read as "how much of the whole", which is the only
// question here; the per-programme detail is the bar panel below.
//
// Two parts, so two fills: the brand hue for the grant and a neutral for
// everything else. Identity never rests on colour — the legend under every
// ring names both with their count and share, and the figures table in the
// panel below says the same without colour at all.
//
// Each ring sums to the same total, so the three cuts can be checked against
// each other. A cut with no seats is not drawn: an empty ring is a question,
// not an answer.

const SIZE = 132;
const STROKE = 18;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;

const HRDC_FILL = "var(--lead-blue)";
const OTHER_FILL = "var(--ink-subtle)";

function share(part: number, total: number): string {
  return total > 0 ? `${Math.round((part / total) * 100)}%` : "—";
}

function Ring({ slice }: { slice: FundingSlice }) {
  const total = slice.hrdc + slice.notHrdc;
  const hrdcLength = total > 0 ? (slice.hrdc / total) * C : 0;

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="h-33 w-33 shrink-0"
      role="img"
      aria-label={`${slice.label}: ${slice.hrdc} HRDC-funded of ${total} seats, ${share(slice.hrdc, total)}.`}
    >
      {/* The whole, then the grant drawn over it from twelve o'clock. Two
          arcs rather than four, so there is no seam to misread. */}
      <circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={R}
        fill="none"
        stroke={OTHER_FILL}
        strokeWidth={STROKE}
      />
      {slice.hrdc > 0 && (
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke={HRDC_FILL}
          strokeWidth={STROKE}
          strokeDasharray={`${hrdcLength} ${C - hrdcLength}`}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />
      )}
      {/* Only the figure sits inside the ring — a second line in there is
          wider than the hole and gets clipped. The caption goes beneath. */}
      <text
        x={SIZE / 2}
        y={SIZE / 2 + 7}
        textAnchor="middle"
        fontSize="22"
        fontWeight="600"
        fill="var(--ink)"
      >
        {slice.label}
      </text>
    </svg>
  );
}

function Card({ eyebrow, slice }: { eyebrow: string; slice: FundingSlice }) {
  const total = slice.hrdc + slice.notHrdc;
  return (
    <div className="border-line bg-surface-raised flex flex-col gap-3 rounded-md border p-4">
      <span className="text-ink-muted text-xs font-medium tracking-wide uppercase">
        {eyebrow}
      </span>
      <div className="flex flex-col items-center gap-1">
        <Ring slice={slice} />
        <span className="text-ink-muted text-xs">{slice.note}</span>
      </div>
      <div className="flex flex-col gap-1 text-sm">
        <span className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="size-3 shrink-0 rounded-sm"
            style={{ backgroundColor: HRDC_FILL }}
          />
          <span className="text-ink-muted">
            HRDC: <span className="font-semibold">{slice.hrdc}</span> (
            {share(slice.hrdc, total)})
          </span>
        </span>
        <span className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="size-3 shrink-0 rounded-sm"
            style={{ backgroundColor: OTHER_FILL }}
          />
          <span className="text-ink-muted">
            Not HRDC: <span className="font-semibold">{slice.notHrdc}</span> (
            {share(slice.notHrdc, total)})
          </span>
        </span>
      </div>
    </div>
  );
}

export function FundingDonutsPanel({
  breakdowns,
  source = "deal",
}: {
  breakdowns: FundingBreakdowns;
  source?: "deal" | "lms";
}) {
  const { all, byTier, byLanguage } = breakdowns;
  if (all.hrdc + all.notHrdc === 0) return null;

  return (
    <PanelCard
      eyebrow="CONTEXT"
      title={<>Who pays: HRDC against everyone else</>}
      description={
        <>
          The same seats cut three ways, so each ring totals the same.
          {source === "lms"
            ? " Funding is read from the LMS, the only place that records it today."
            : " Funding is what the deal records."}{" "}
          Programme length stands in for the price tier, because no price is
          recorded against a course.
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Card eyebrow="All finished programmes" slice={all} />
        {byTier.map((slice) => (
          <Card
            key={slice.key}
            eyebrow={`By length: ${slice.note}`}
            slice={slice}
          />
        ))}
        {byLanguage.map((slice) => (
          <Card
            key={slice.key}
            eyebrow={`By language: ${slice.label}`}
            slice={slice}
          />
        ))}
      </div>
    </PanelCard>
  );
}
