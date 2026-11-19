import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink, DetailHeader, Panel, Row } from "@/components/detail-kit";
import { clientIp, writeAudit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth/current-user";
import { formatDateTime } from "@/lib/format/date";
import { formatMoneyMyr } from "@/lib/format/money";
import { getPaymentForMatch } from "@/lib/payments/match";
import { canRecordPayment } from "@/lib/payments/service";
import { MatchForm } from "./match-form";

// Spec §11.3 payment match. Server-rendered: the page checks §6 payment write
// itself (hiding the link is not the boundary), then shows the payment as
// Stripe sent it and the webhook's notes on why it didn't match. The form
// picks a person and a class; POST /api/payments/:id/match does the rest.

const METHOD: Record<string, string> = {
  stripe_card: "Card (Stripe)",
  stripe_fpx: "FPX online banking (Stripe)",
};

export default async function PaymentMatchPage(
  props: PageProps<"/payments/[id]/match">,
) {
  const user = await getCurrentUser();
  if (!user) notFound();
  if (!canRecordPayment(user)) {
    await writeAudit({
      userId: user.id,
      action: "permission_denied",
      entity: "payment",
      entityId: null,
      before: null,
      after: { route: "/payments/[id]/match", method: "GET" },
      ip: clientIp(null),
    }).catch((err) => console.error("permission_denied audit failed", err));
    notFound();
  }

  const { id } = await props.params;
  const payment = await getPaymentForMatch(id, user);
  if (!payment) notFound();

  const refunded = payment.status === "refunded";
  const open = payment.matchStatus === "unmatched" && !refunded;

  return (
    <div className="space-y-6">
      <BackLink href="/tasks" label="Tasks" />
      <DetailHeader
        title="Match payment"
        meta={
          <span>
            {formatMoneyMyr(payment.amountMyr)} paid
            {payment.paidAt ? ` on ${formatDateTime(payment.paidAt)}` : ""}
          </span>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="The payment">
          <Row>
            <span className="text-ink-muted">Amount</span>
            <span>{formatMoneyMyr(payment.amountMyr)}</span>
          </Row>
          {Number(payment.refundedMyr) > 0 && (
            <Row>
              <span className="text-ink-muted">Refunded</span>
              <span>{formatMoneyMyr(payment.refundedMyr)}</span>
            </Row>
          )}
          <Row>
            <span className="text-ink-muted">Paid by</span>
            <span>{METHOD[payment.method] ?? "Recorded by hand"}</span>
          </Row>
          <Row>
            <span className="text-ink-muted">Paid at</span>
            <span>
              {payment.paidAt ? formatDateTime(payment.paidAt) : "Not set"}
            </span>
          </Row>
          <Row>
            <span className="text-ink-muted">Stripe checkout</span>
            <span className="font-mono text-xs break-all">
              {payment.checkoutSessionId ?? "Not set"}
            </span>
          </Row>
        </Panel>

        <Panel title="Why it wasn't matched">
          {payment.taskNotes ? (
            <p className="text-sm whitespace-pre-wrap">{payment.taskNotes}</p>
          ) : (
            <p className="text-ink-muted text-sm">No notes were left.</p>
          )}
        </Panel>
      </div>

      {payment.matched ? (
        <Panel title="Matched">
          <p className="text-sm">
            Matched to{" "}
            <Link
              href={`/people/${payment.matched.personId}`}
              className="text-blue-ink hover:underline"
            >
              {payment.matched.personName}
            </Link>{" "}
            in{" "}
            <Link
              href={`/enrolments/${payment.matched.enrolmentId}`}
              className="text-blue-ink hover:underline"
            >
              {payment.matched.classCode}
            </Link>
            {payment.matched.by ? ` by ${payment.matched.by}` : ""}
            {payment.matched.at
              ? ` on ${formatDateTime(payment.matched.at)}`
              : ""}
            .
          </p>
        </Panel>
      ) : refunded ? (
        <Panel title="Refunded">
          <p className="text-sm">
            This payment was refunded in full in Stripe, so there&apos;s nothing
            to match.
          </p>
        </Panel>
      ) : open ? (
        <MatchForm paymentId={payment.id} amountMyr={payment.amountMyr} />
      ) : (
        <Panel title="Not matchable">
          <p className="text-sm">
            This isn&apos;t a Stripe payment waiting to be matched.
          </p>
        </Panel>
      )}
    </div>
  );
}
