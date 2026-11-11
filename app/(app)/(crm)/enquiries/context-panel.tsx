"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { DetailError, Panel, Row } from "@/components/detail-kit";
import { Button } from "@/components/ui/button";
import { enumLabel } from "@/lib/classes/types";
import { stageLabel } from "@/lib/deals/types";
import type { EnquiryRow } from "@/lib/enquiries/types";
import type { PersonDetail } from "@/lib/people/types";
import { DASH, QUEUE_COLUMNS, openDeals, queueCells } from "./queue-view";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string; retry: boolean }
  | { status: "ready"; detail: PersonDetail };

// Spec §9.13: the selected enquiry's person, beside the queue. Its own load
// and error states, so a failure here leaves the queue and its actions
// working (§13).
//
// shortcut: reads the whole §9.2 payload (GET /api/people/:id) to show five
// sections — it already applies §6 and the part_time narrowing, so no second
// copy of those rules exists. Give the panel its own narrow route if the
// panel is measurably slow to open, or a second caller wants the same subset.
export function ContextPanel({
  enquiry,
  closeHref,
}: {
  enquiry: EnquiryRow;
  closeHref: string;
}) {
  const personId = enquiry.personId;
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    // Ignore flag, not AbortController: an abort mid-read errors the response
    // body stream, and that rejection reaches no catch of ours.
    let ignore = false;
    fetch(`/api/people/${encodeURIComponent(personId)}`)
      .then(async (res) => {
        const body = await res.json();
        if (ignore) return;
        if (res.ok) setState({ status: "ready", detail: body });
        else
          setState({
            status: "error",
            message: body.error?.message ?? "Couldn't load this person.",
            // A 403 or 404 will not change on a retry.
            retry: res.status >= 500,
          });
      })
      .catch(() => {
        if (!ignore)
          setState({
            status: "error",
            message: "Couldn't load this person — check your connection.",
            retry: true,
          });
      });
    return () => {
      ignore = true;
    };
  }, [personId, reloadKey]);

  // Panel-shaped, not DetailSkeleton: that one is a full page's two columns.
  if (state.status === "loading")
    return (
      <div aria-busy="true" className="space-y-4">
        <div className="bg-surface-sunken h-6 w-40 animate-pulse rounded-sm" />
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="bg-surface-sunken h-28 animate-pulse rounded-md"
          />
        ))}
      </div>
    );
  if (state.status === "error")
    return (
      <DetailError
        backHref={closeHref}
        backLabel="Close"
        message={state.message}
        onRetry={
          state.retry
            ? () => {
                setState({ status: "loading" });
                setReloadKey((k) => k + 1);
              }
            : undefined
        }
      />
    );

  const { person, deals, enrolments } = state.detail;
  const open = deals ? openDeals(deals) : null;
  const cells = queueCells(enquiry);

  return (
    <aside aria-label={`About ${person.fullName}`} className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold">{person.fullName}</h2>
        {/* An icon, not the word "Close": that word is the enquiry's own
            action in the queue. */}
        <Link
          href={closeHref}
          aria-label="Hide this panel"
          title="Hide this panel"
          className="text-ink-muted hover:text-ink focus-visible:outline-focus-ring -m-1 rounded-sm p-1 focus-visible:outline-2"
        >
          <X className="size-4" aria-hidden />
        </Link>
      </div>
      <div className="flex flex-col gap-1">
        <Link
          href={`/enquiries/${enquiry.id}`}
          className="text-blue-ink text-sm hover:underline"
        >
          Open enquiry {enquiry.number}: history, notes and messages
        </Link>
        <Link
          href={`/people/${person.id}`}
          className="text-blue-ink text-sm hover:underline"
        >
          Open their full record
        </Link>
      </div>

      {/* The enquiry itself, so the panel reads alone when it sits below
          the queue on a narrow screen. */}
      <Panel title="Enquiry">
        {[1, 2, 3, 5, 6, 7, 8].map((i) => (
          <Row key={i}>
            <span className="text-ink-muted">{QUEUE_COLUMNS[i]}</span>
            <span>{cells[i]}</span>
          </Row>
        ))}
      </Panel>

      <Panel title="Contact">
        <Row>
          <span className="text-ink-muted">Phone</span>
          <span>{person.phone ?? DASH}</span>
        </Row>
        <Row>
          <span className="text-ink-muted">WhatsApp</span>
          <span>{person.whatsapp ?? DASH}</span>
        </Row>
        <Row>
          <span className="text-ink-muted">Email</span>
          <span className="break-all">{person.email ?? DASH}</span>
        </Row>
      </Panel>

      <Panel title="Company" empty={!person.companyId}>
        {person.companyId && (
          <Link
            href={`/companies/${person.companyId}`}
            className="text-blue-ink text-sm hover:underline"
          >
            {person.companyName}
          </Link>
        )}
      </Panel>

      {/* null: the viewer's role reads no deals or enrolments (§6), so the
          section is left out rather than shown empty. */}
      {open && (
        <Panel title="Open deals" empty={open.length === 0}>
          {open.map((d) => (
            <Row key={d.id}>
              <Link
                href={`/deals/${d.id}`}
                className="text-blue-ink hover:underline"
              >
                {d.courseName}
              </Link>
              <span>{stageLabel(d.pipeline, d.stage)}</span>
            </Row>
          ))}
        </Panel>
      )}

      {enrolments && (
        <Panel title="Enrolments" empty={enrolments.length === 0}>
          {enrolments.map((e) => (
            <Row key={e.id}>
              <Link
                href={`/enrolments/${e.id}`}
                className="text-blue-ink hover:underline"
              >
                {e.classCode}
              </Link>
              <span>{enumLabel(e.status)}</span>
            </Row>
          ))}
        </Panel>
      )}

      <ConvertControl enquiry={enquiry} />
    </aside>
  );
}

// Convert to deal waits for POST /api/enquiries/:id/convert, its own change.
// Until then the control says so and sends nothing; a converted enquiry
// links its deal instead.
export function ConvertControl({ enquiry }: { enquiry: EnquiryRow }) {
  if (enquiry.status === "converted" && enquiry.dealId)
    return (
      <Link
        href={`/deals/${enquiry.dealId}`}
        className="text-blue-ink text-sm hover:underline"
      >
        Open the deal this enquiry became
      </Link>
    );
  return (
    <div className="space-y-1">
      <Button variant="outline" disabled aria-describedby="convert-reason">
        Convert to deal
      </Button>
      <p id="convert-reason" className="text-ink-muted text-sm">
        Coming in a later release. For now, add a deal from their full record.
      </p>
    </div>
  );
}
