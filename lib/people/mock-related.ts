import { formatMoneyMyr } from "../format/money.ts";
import type { PersonRecord } from "./mock-data.ts";
import type {
  ConsentState,
  DealSummary,
  EnquirySummary,
  EnrolmentSummary,
  PaymentSummary,
  TimelineItem,
  Touchpoint,
} from "./types.ts";

// ponytail: fake related records per person, derived from the person so
// they stay consistent. Replaced by joins on Shawn's tables (spec §5).

const HOUR = 60 * 60 * 1000;
const shift = (iso: string, hours: number) =>
  new Date(Date.parse(iso) + hours * HOUR).toISOString();

export type MockRelated = {
  touchpoints: Touchpoint[];
  deals: (DealSummary & { ownerId: string | null })[];
  enrolments: EnrolmentSummary[];
  payments: (PaymentSummary & { dealOwnerId: string | null })[];
  enquiries: EnquirySummary[];
  consent: ConsentState[];
  timeline: (TimelineItem & {
    resource: "person" | "deal" | "task" | "payment" | "enrolment";
    recordId: string | null;
  })[];
};

export function mockRelated(p: PersonRecord): MockRelated {
  // Seeded people have ids like p-0012; people added in-app (UUIDs) get none.
  const n = /^p-\d+$/.test(p.id) ? Number(p.id.slice(2)) : 0;
  const created = p.createdAt;

  const touchpoints: Touchpoint[] =
    n === 0
      ? []
      : [
          {
            id: `${p.id}-tp1`,
            occurredAt: created,
            channel: "web_form",
            utmSource: n % 2 ? "facebook" : "google",
            utmCampaign: "agentic_202610_leads_en",
          },
          ...(n % 3 === 0
            ? [
                {
                  id: `${p.id}-tp2`,
                  occurredAt: shift(created, 30),
                  channel: "whatsapp",
                  utmSource: null,
                  utmCampaign: null,
                },
              ]
            : []),
        ];

  const deals: MockRelated["deals"] = [];
  if (p.hasOpenDeal)
    deals.push({
      id: `${p.id}-d1`,
      stage: "engaged",
      courseName: "AI Agentic Automation",
      amountMyr: "3200.00",
      owner: p.owner?.fullName ?? null,
      ownerId: p.owner?.id ?? null,
    });
  if (p.stage !== "lead")
    deals.push({
      id: `${p.id}-d2`,
      stage: "won",
      courseName: "AI Mastery",
      amountMyr: "4800.00",
      owner: p.owner?.fullName ?? null,
      ownerId: p.owner?.id ?? null,
    });

  const enrolments: EnrolmentSummary[] =
    p.stage === "lead"
      ? []
      : [
          {
            id: `${p.id}-e1`,
            classCode: "AIM-2610-EN",
            status: p.stage === "customer" ? "completed" : "confirmed",
            pricePaidMyr: p.stage === "customer" ? "4800.00" : null,
          },
        ];

  const payments: MockRelated["payments"] =
    p.stage === "customer"
      ? [
          {
            id: `${p.id}-pay1`,
            method: "stripe_card",
            amountMyr: "4800.00",
            paidAt: shift(created, 48),
            status: "succeeded",
            dealOwnerId: p.owner?.id ?? null,
          },
        ]
      : [];

  const enquiries: EnquirySummary[] =
    n % 2 === 0 && n > 0
      ? [
          {
            id: `${p.id}-q1`,
            channel: "whatsapp",
            category: "hrdc",
            status: n % 4 === 0 ? "human_resolved" : "open",
            handledBy: n % 4 === 0 ? "user" : "ai",
          },
        ]
      : [];

  const consent: ConsentState[] =
    n === 0
      ? []
      : [
          { purpose: "marketing_email", isGranted: true, recordedAt: created },
          {
            purpose: "marketing_whatsapp",
            isGranted: n % 5 !== 0,
            recordedAt: created,
          },
        ];

  const timeline: MockRelated["timeline"] = [
    ...touchpoints.map((t) => ({
      at: t.occurredAt,
      kind: "touchpoint" as const,
      text: `Came in via ${t.channel.replace("_", " ")}${t.utmSource ? ` (${t.utmSource})` : ""}`,
      resource: "person" as const,
      recordId: null,
    })),
    ...deals.map((d) => ({
      at: shift(created, 24),
      kind: "stage_change" as const,
      text: `Deal for ${d.courseName} moved to ${d.stage}`,
      resource: "deal" as const,
      recordId: d.id,
    })),
    ...enrolments.map((e) => ({
      at: shift(created, 36),
      kind: "enrolment_change" as const,
      text: `Enrolment in ${e.classCode} is ${e.status}`,
      resource: "enrolment" as const,
      recordId: e.id,
    })),
    ...payments.map((pay) => ({
      at: pay.paidAt ?? created,
      kind: "payment" as const,
      text: `Payment of ${formatMoneyMyr(pay.amountMyr)} ${pay.status}`,
      resource: "payment" as const,
      recordId: pay.id,
    })),
    ...(touchpoints.length
      ? [
          {
            at: shift(created, 2),
            kind: "task" as const,
            text: "First-contact call completed",
            resource: "task" as const,
            recordId: null,
          },
          {
            at: shift(created, 3),
            kind: "message" as const,
            text: "WhatsApp message received",
            resource: "person" as const,
            recordId: null,
          },
        ]
      : []),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  return {
    touchpoints,
    deals,
    enrolments,
    payments,
    enquiries,
    consent,
    timeline,
  };
}
