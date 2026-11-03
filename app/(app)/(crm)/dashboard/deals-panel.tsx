"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { STAGE_LABELS, type Pipeline } from "@/lib/deals/types";
import { formatMoneyMyr } from "@/lib/format/money";
import type { HomePipelineTotals } from "@/lib/home/types";

// Stage dots, in board order (§9.5). Colours come from the design's series
// palette rather than meaning anything on their own.
const DOTS = ["bg-chart-1", "bg-chart-2", "bg-success", "bg-lead-yellow"];

const TABS: { pipeline: Pipeline; label: string }[] = [
  { pipeline: "individual", label: "Individual" },
  { pipeline: "corporate", label: "Corporate" },
];

export function DealsPanel({ totals }: { totals: HomePipelineTotals[] }) {
  const [pipeline, setPipeline] = useState<Pipeline>("individual");
  const shown = totals.find((t) => t.pipeline === pipeline) ?? totals[0];

  return (
    <section className="flex flex-col gap-3.5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h2 className="text-lg font-bold">My open deals</h2>
          <span className="bg-surface-sunken text-ink-muted rounded-full px-2 py-0.5 text-xs font-semibold">
            {shown.openCount}
          </span>
        </div>
        <div
          role="tablist"
          aria-label="Pipeline"
          className="border-line bg-surface-raised flex gap-1 rounded-full border p-1"
        >
          {TABS.map((tab) => (
            <button
              key={tab.pipeline}
              type="button"
              role="tab"
              aria-selected={pipeline === tab.pipeline}
              onClick={() => setPipeline(tab.pipeline)}
              className={`focus-visible:outline-focus-ring rounded-full px-5 py-2 text-[13px] font-semibold focus-visible:outline-2 ${
                pipeline === tab.pipeline
                  ? "bg-primary text-white"
                  : "text-ink-muted"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      <div className="flex flex-col gap-4 lg:flex-row">
        <Link
          href={`/deals?pipeline=${shown.pipeline}&mine=1`}
          className="focus-visible:outline-focus-ring flex w-full shrink-0 flex-col justify-between gap-3 rounded-md bg-[linear-gradient(135deg,#6C85F5_0%,#4F6BED_55%,#3A4FC9_100%)] p-5 focus-visible:outline-2 focus-visible:outline-offset-2 lg:w-75"
        >
          <span className="flex items-center justify-between gap-2">
            <span className="text-[13px] text-[#DCE3FF]">
              Open pipeline ·{" "}
              {shown.pipeline === "individual" ? "Individual" : "Corporate"}
            </span>
            <span
              aria-hidden="true"
              className="text-primary flex size-7 items-center justify-center rounded-full bg-white"
            >
              <ArrowUpRight className="size-3.5" />
            </span>
          </span>
          <span className="text-[28px] leading-none font-bold text-white">
            {formatMoneyMyr(shown.openTotalMyr)}
          </span>
          <span className="bg-lead-yellow text-on-yellow w-fit rounded-full px-2 py-[3px] text-[11px] font-bold">
            {shown.openCount} open {shown.openCount === 1 ? "deal" : "deals"}
          </span>
        </Link>

        <div className="border-line bg-surface-raised flex min-w-0 flex-1 flex-col overflow-hidden rounded-md border sm:flex-row">
          {shown.stages.map((stage, i) => (
            <div
              key={stage.stage}
              className="border-line flex flex-1 flex-col justify-between gap-2.5 border-b p-5 last:border-b-0 sm:border-r sm:border-b-0 sm:last:border-r-0"
            >
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={`size-2 rounded-full ${DOTS[i % DOTS.length]}`}
                />
                <span className="text-ink-muted text-[13px]">
                  {STAGE_LABELS[stage.stage]}
                </span>
              </span>
              <span className="flex items-end gap-1.5">
                <span className="text-[28px] leading-none font-bold">
                  {stage.count}
                </span>
                <span className="text-ink-subtle text-[13px]">
                  {stage.count === 1 ? "deal" : "deals"}
                </span>
              </span>
              <span className="text-sm font-semibold">
                {formatMoneyMyr(stage.totalMyr)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
