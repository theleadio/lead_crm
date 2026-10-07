import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { BackLink, DetailHeader, Panel, Row } from "@/components/detail-kit";
import { clientIp, writeAudit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteEnrolment, permissionFor } from "@/lib/auth/permissions";
import { enumLabel } from "@/lib/classes/types";
import { getEnrolment } from "@/lib/enrolments/service";
import {
  ENROLMENT_STATUS_BADGE,
  type EnrolmentDetail,
} from "@/lib/enrolments/types";
import { statusMoves } from "@/lib/enrolments/status-rules";
import { formatDate, formatDateRange, formatDateTime } from "@/lib/format/date";
import { CancelEnrolment } from "./cancel-enrolment";
import { StatusControl } from "./status-control";
import { TransferDialog } from "./transfer-dialog";

// Spec §9.11 Enrolment detail. Server-rendered like §9.10: the panels are
// decided here from §6, so a role without payment read never has payment rows
// in the page it is sent. Seats and class status are read, never written
// (§12.1, §12.11).

const NOT_SET = "Not set";
const value = (v: string | number | null | undefined) =>
  v === null || v === undefined || String(v).trim() === ""
    ? NOT_SET
    : String(v);

export default async function EnrolmentDetailPage(
  props: PageProps<"/enrolments/[id]">,
) {
  const user = await getCurrentUser();
  if (!user) notFound();
  // §6 enrolment row: marketing and part_time have no access at all, and the
  // denial is audit-logged like any other (§6, §13).
  if (!permissionFor(user, "enrolment", "read").allowed) {
    await writeAudit({
      userId: user.id,
      action: "permission_denied",
      entity: "enrolment",
      entityId: null,
      before: null,
      after: { route: "/enrolments/[id]", method: "GET" },
      ip: clientIp(null),
    }).catch((err) => console.error("permission_denied audit failed", err));
    notFound();
  }

  const { id } = await props.params;
  const enrolment = await getEnrolment(id, user);
  if (!enrolment) notFound();

  const canWrite = canWriteEnrolment(user);
  const moves = statusMoves(enrolment.status);

  return (
    <div className="space-y-6">
      <BackLink
        href={`/classes/${enrolment.classId}?tab=roster`}
        label="Roster"
      />
      <EnrolmentHeader enrolment={enrolment} canWrite={canWrite} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Person and class">
          <Row>
            <span className="text-ink-muted">Person</span>
            <span>
              <Link
                href={`/people/${enrolment.personId}`}
                className="text-blue-ink underline"
              >
                {enrolment.personName}
              </Link>
            </span>
          </Row>
          <Row>
            <span className="text-ink-muted">Booked by</span>
            <span>
              {enrolment.bookerPersonId ? (
                <Link
                  href={`/people/${enrolment.bookerPersonId}`}
                  className="text-blue-ink underline"
                >
                  {enrolment.bookerName}
                </Link>
              ) : (
                NOT_SET
              )}
            </span>
          </Row>
          <Row>
            <span className="text-ink-muted">Class</span>
            <span>
              <Link
                href={`/classes/${enrolment.classId}`}
                className="text-blue-ink underline"
              >
                {enrolment.classCode}
              </Link>
            </span>
          </Row>
          <Row>
            <span className="text-ink-muted">Course</span>
            <span>{enrolment.courseName}</span>
          </Row>
          <Row>
            <span className="text-ink-muted">Dates</span>
            <span>
              {formatDateRange(
                enrolment.classStartDate,
                enrolment.classEndDate,
              )}
            </span>
          </Row>
          <Row>
            <span className="text-ink-muted">Seats in this class</span>
            <span>
              {enrolment.seatsAvailable} of {enrolment.capacity} available
            </span>
          </Row>
          <Row>
            <span className="text-ink-muted">Enrolled on</span>
            <span>{formatDate(enrolment.createdAt)}</span>
          </Row>
        </Panel>

        <Panel title="Place and money">
          <Row>
            <span className="text-ink-muted">Status</span>
            <span>{enumLabel(enrolment.status)}</span>
          </Row>
          <Row>
            <span className="text-ink-muted">Who is paying</span>
            <span>{enumLabel(enrolment.payerType)}</span>
          </Row>
          <Row>
            <span className="text-ink-muted">Price paid (MYR)</span>
            {/* §12.7: the snapshot taken at purchase, not the class's price. */}
            <span>{value(enrolment.pricePaidMyr)}</span>
          </Row>
          <Row>
            <span className="text-ink-muted">Onboarding step</span>
            <span>{enrolment.onboardingStep}</span>
          </Row>
          <Row>
            <span className="text-ink-muted">Certificate number</span>
            <span>{value(enrolment.certificateNo)}</span>
          </Row>
          {enrolment.status === "reserved" && (
            <Row>
              <span className="text-ink-muted">Seat held until</span>
              <span>
                {enrolment.seatReservedUntil
                  ? formatDateTime(enrolment.seatReservedUntil)
                  : NOT_SET}
              </span>
            </Row>
          )}
          {enrolment.status === "cancelled" && (
            <Row>
              <span className="text-ink-muted">Cancelled because</span>
              <span>{value(enrolment.cancelledReason)}</span>
            </Row>
          )}
          {enrolment.completedAt && (
            <Row>
              <span className="text-ink-muted">Completed on</span>
              <span>{formatDate(enrolment.completedAt)}</span>
            </Row>
          )}
          {enrolment.transferredToEnrolmentId && (
            <Row>
              <span className="text-ink-muted">Transferred to</span>
              <span>
                <Link
                  href={`/enrolments/${enrolment.transferredToEnrolmentId}`}
                  className="text-blue-ink underline"
                >
                  {enrolment.transferredToClassCode}
                </Link>
              </span>
            </Row>
          )}
        </Panel>

        {/* §6 payment row: absent, not empty, for a role without access. */}
        {enrolment.payments && (
          <Panel title="Payments" empty={!enrolment.payments.length}>
            {enrolment.payments.map((payment) => (
              <Row key={payment.id}>
                <span className="text-ink-muted">
                  {enumLabel(payment.method)}
                </span>
                <span>{payment.amountMyr}</span>
                <span>{enumLabel(payment.status)}</span>
                <span>
                  {payment.paidAt ? formatDate(payment.paidAt) : NOT_SET}
                </span>
              </Row>
            ))}
          </Panel>
        )}

        {canWrite && (
          <Panel title="Change this enrolment">
            <p className="text-ink-muted mb-3 text-sm">
              Only the statuses §12.4 allows from {enumLabel(enrolment.status)}{" "}
              are offered. Refunds are handled in Stripe, not here.
            </p>
            <div className="flex flex-wrap items-start gap-2">
              <StatusControl
                id={enrolment.id}
                version={enrolment.version}
                // Cancelling needs a reason, so it has its own dialog.
                moves={moves.filter((s) => s !== "cancelled")}
              />
              <TransferDialog
                id={enrolment.id}
                version={enrolment.version}
                status={enrolment.status}
                classId={enrolment.classId}
                courseId={enrolment.classCourseId}
              />
              {moves.includes("cancelled") && (
                <CancelEnrolment
                  id={enrolment.id}
                  version={enrolment.version}
                  personName={enrolment.personName}
                  classCode={enrolment.classCode}
                  hasPayments={Boolean(enrolment.payments?.length)}
                />
              )}
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}

// §9.11 header: who, where, and the stored status — nothing recomputed here.
function EnrolmentHeader({
  enrolment,
  canWrite,
}: {
  enrolment: EnrolmentDetail;
  canWrite: boolean;
}) {
  return (
    <DetailHeader
      title={
        <span className="flex flex-wrap items-center gap-3">
          {enrolment.personName}
          <Badge
            variant={ENROLMENT_STATUS_BADGE[enrolment.status] ?? "secondary"}
          >
            {enumLabel(enrolment.status)}
          </Badge>
        </span>
      }
      meta={
        <>
          <span>{enrolment.classCode}</span>
          <span>{enrolment.courseName}</span>
          <span>
            {formatDateRange(enrolment.classStartDate, enrolment.classEndDate)}
          </span>
          {!canWrite && <span>Read-only</span>}
        </>
      }
    />
  );
}
