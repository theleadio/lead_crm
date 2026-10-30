import { TableCard } from "@/components/list-kit";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { priceTier, type FundingRow } from "@/lib/reports/funding";
import { formatMoneyMyr } from "@/lib/format/money";
import { PanelCard } from "./panel-card";

// §9.18 who pays: part-to-whole per programme, so a horizontal stacked bar —
// the names are long and the question is a share, not a magnitude.
//
// Emphasis rather than two categorical hues: HRDC is the subject, everything
// else is context, so one hue plus a gray. Identity never rests on colour —
// each segment carries its count as text, the legend is always present, and
// the figures table below says the same thing without any colour at all.

const LANGUAGE_LABEL: Record<string, string> = { en: "English", zh: "Chinese" };

function Bar({ row }: { row: FundingRow }) {
  const total = row.hrdc + row.notHrdc;
  if (total === 0) return null;
  const hrdcPercent = (row.hrdc / total) * 100;

  return (
    // A 2px surface gap between the fills, never a border drawn around them.
    <div className="bg-surface-raised flex h-5 w-full gap-0.5 overflow-hidden rounded-sm">
      {row.hrdc > 0 && (
        <div
          className="h-full rounded-sm"
          style={{
            width: `${hrdcPercent}%`,
            backgroundColor: "var(--lead-blue)",
          }}
          title={`${row.course}: ${row.hrdc} HRDC-funded of ${total}`}
        />
      )}
      {row.notHrdc > 0 && (
        <div
          className="h-full rounded-sm"
          style={{
            width: `${100 - hrdcPercent}%`,
            backgroundColor: "var(--ink-subtle)",
          }}
          title={`${row.course}: ${row.notHrdc} not HRDC-funded of ${total}`}
        />
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="text-ink-muted flex flex-wrap items-center gap-4 text-sm">
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="size-3 rounded-sm"
          style={{ backgroundColor: "var(--lead-blue)" }}
        />
        HRDC-funded
      </span>
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="size-3 rounded-sm"
          style={{ backgroundColor: "var(--ink-subtle)" }}
        />
        Not HRDC-funded
      </span>
    </div>
  );
}

export function WhoPaysPanel({
  rows,
  source = "deal",
}: {
  rows: FundingRow[];
  // Where funding was read. The CRM's own deals are the real answer; the LMS
  // is read while the import does not carry funding across, and the panel
  // says so rather than presenting a borrowed number as its own.
  source?: "deal" | "lms";
}) {
  return (
    <PanelCard
      eyebrow="CONTEXT"
      title={<>Who pays</>}
      description={
        <>
          {source === "deal"
            ? "Seat-holding enrolments (§12.1) by programme and class language. HRDC means the deal records HRDC funding; an enrolment with no deal has no recorded funding and is counted as not HRDC rather than guessed."
            : "Seats by programme and class language, counted in the LMS, which is the only place that records how each was funded — no deal in the CRM carries it yet. HRDC means the LMS says hrdc; self-funded, internal, leaders' club and refresher seats all count as not HRDC."}
        </>
      }
    >
      {rows.length === 0 ? (
        <div className="border-line bg-surface-raised rounded-md border p-5">
          <p className="text-ink-muted text-sm">
            No seats were taken in this date range.
          </p>
        </div>
      ) : (
        <>
          <Legend />
          <div className="flex flex-col gap-3">
            {rows.map((row) => (
              <div
                key={`${row.course}-${row.language}`}
                className="flex flex-col gap-1"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium">
                    {row.course}{" "}
                    <span className="text-ink-muted font-normal">
                      · {LANGUAGE_LABEL[row.language] ?? row.language} ·{" "}
                      {priceTier(row.durationDays)}
                    </span>
                  </span>
                  <span className="text-ink-muted">
                    {row.hrdc} HRDC / {row.notHrdc} not
                  </span>
                </div>
                <Bar row={row} />
              </div>
            ))}
          </div>

          <TableCard>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Programme</TableHead>
                  <TableHead>Language</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>List price</TableHead>
                  <TableHead>HRDC</TableHead>
                  <TableHead>Not HRDC</TableHead>
                  <TableHead>Seats</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={`t-${row.course}-${row.language}`}>
                    <TableCell>{row.course}</TableCell>
                    <TableCell>
                      {LANGUAGE_LABEL[row.language] ?? row.language}
                    </TableCell>
                    <TableCell>{priceTier(row.durationDays)}</TableCell>
                    <TableCell>
                      {row.listPriceMyr ? (
                        formatMoneyMyr(row.listPriceMyr)
                      ) : (
                        <span className="text-ink-muted">—</span>
                      )}
                    </TableCell>
                    <TableCell>{row.hrdc}</TableCell>
                    <TableCell>{row.notHrdc}</TableCell>
                    <TableCell>{row.hrdc + row.notHrdc}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCard>
        </>
      )}
    </PanelCard>
  );
}
