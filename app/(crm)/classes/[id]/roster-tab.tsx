import Link from "next/link";
import { EmptyRow, TableCard } from "@/components/list-kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { enumLabel, type RosterRow } from "@/lib/classes/types";
import { formatDate, formatDateTime } from "@/lib/format/date";

// §9.10 Roster: who is in the class, read-only. Adding an enrolment, changing
// a status and transferring are §9.11's, so they are not here. No phone and
// no email — the roster says who is coming, not how to reach them.

export function RosterTab({
  classId,
  rows,
  canExport,
}: {
  classId: string;
  rows: RosterRow[];
  // §6 export row: super_admin full, operations "class lists".
  canExport: boolean;
}) {
  return (
    <div
      role="tabpanel"
      id="panel-roster"
      aria-labelledby="tab-roster"
      className="space-y-4"
    >
      <div className="flex items-center justify-between gap-4">
        <p className="text-ink-muted text-sm">
          {rows.length} {rows.length === 1 ? "enrolment" : "enrolments"}, every
          status included.
        </p>
        {canExport && (
          <Button asChild variant="outline">
            {/* A download, not a navigation: the route answers with a CSV. */}
            <Link
              href={`/api/classes/${classId}/roster/export`}
              prefetch={false}
            >
              Export CSV
            </Link>
          </Button>
        )}
      </div>

      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Seat</TableHead>
              <TableHead>Payer</TableHead>
              <TableHead>Booked by</TableHead>
              <TableHead>Price paid</TableHead>
              <TableHead>Reserved until</TableHead>
              <TableHead>Enrolled</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <EmptyRow columns={8}>
                Nobody is enrolled in this class yet.
              </EmptyRow>
            )}
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-semibold">
                  <Link
                    href={`/people/${row.personId}`}
                    className="text-blue-ink underline"
                  >
                    {row.personName}
                  </Link>
                </TableCell>
                <TableCell>{enumLabel(row.status)}</TableCell>
                <TableCell>
                  {/* §12.1: whether this row is holding a seat, decided by the
                      same predicate as the header's counts. */}
                  <Badge variant={row.holdsSeat ? "success" : "secondary"}>
                    {row.holdsSeat ? "Holding" : "No seat"}
                  </Badge>
                </TableCell>
                <TableCell className="text-ink-muted">
                  {enumLabel(row.payerType)}
                </TableCell>
                <TableCell className="text-ink-muted">
                  {row.bookerName ?? "—"}
                </TableCell>
                <TableCell className="text-ink-muted">
                  {row.pricePaidMyr ?? "—"}
                </TableCell>
                <TableCell className="text-ink-muted">
                  {row.seatReservedUntil
                    ? formatDateTime(row.seatReservedUntil)
                    : "—"}
                </TableCell>
                <TableCell className="text-ink-muted">
                  {formatDate(row.createdAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>
    </div>
  );
}
