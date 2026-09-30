// API shapes for spec §9.5 Deals board (GET /api/deals, POST
// /api/deals/:id/stage). Stage lists mirror the deal CHECK constraint in
// migration 001 (spec §5, §12.5).

import type { PageInfo } from "../people/types.ts";

export const PIPELINES = ["individual", "corporate"] as const;
export type Pipeline = (typeof PIPELINES)[number];

// In board column order.
export const STAGES = {
  individual: ["new", "engaged", "qualified", "checkout_sent", "won", "lost"],
  corporate: ["new", "discovery", "proposal_sent", "funding", "won", "lost"],
} as const;
export type Stage = (typeof STAGES)[Pipeline][number];
export const ALL_STAGES = [
  ...new Set<Stage>([...STAGES.individual, ...STAGES.corporate]),
];

export const STAGE_LABELS: Record<Stage, string> = {
  new: "New",
  engaged: "Engaged",
  qualified: "Qualified",
  checkout_sent: "Checkout sent",
  discovery: "Discovery",
  proposal_sent: "Proposal sent",
  funding: "Funding",
  won: "Won",
  lost: "Lost",
};

export const FUNDING_TYPES = ["self", "company", "hrdc", "other"] as const;
export type FundingType = (typeof FUNDING_TYPES)[number];

export type DealCard = {
  id: string;
  pipeline: Pipeline;
  stage: Stage;
  person: { id: string; fullName: string };
  course: { id: string; name: string } | null;
  // numeric(12,2) as text; never added in JS (spec §4, §12.7).
  amountMyr: string | null;
  owner: { id: string; fullName: string } | null;
  stageChangedAt: string;
  fundingType: FundingType | null;
  version: string;
};

export type StageTotal = { stage: Stage; count: number; totalMyr: string };

export type DealListQuery = {
  pipeline: Pipeline;
  stage?: Stage;
  owner?: string;
  course?: string;
  funding?: FundingType;
  createdFrom?: string;
  createdTo?: string;
  mine?: boolean;
  page: number;
  limit: number;
};

export type DealListResponse = {
  data: DealCard[];
  page: PageInfo;
  stageTotals: StageTotal[];
};

export type LostReasonOption = { id: string; code: string; labelEn: string };

// Spec §9.6 Deal detail (GET /api/deals/:id, §7.1: deal + stageHistory +
// tasks + linked enquiry). Money stays a string end to end (§12.7).

export type Ref = { id: string; name: string };

export type StageHistoryEntry = {
  id: string;
  fromStage: Stage | null;
  toStage: Stage;
  changedAt: string;
  changedBy: string | null;
};

export type DealTask = {
  id: string;
  type: string;
  title: string;
  dueAt: string | null;
  assignedTo: string | null;
  doneAt: string | null;
};

export type DealEnrolment = {
  id: string;
  classCode: string | null;
  status: string;
  pricePaidMyr: string | null;
};

export type LinkedEnquiry = {
  id: string;
  channel: string;
  category: string | null;
  status: string;
  firstMessageAt: string | null;
};

export type DealDetail = {
  id: string;
  pipeline: Pipeline;
  stage: Stage;
  person: Ref;
  company: Ref | null;
  course: Ref | null;
  // Class is read-only here until the 9.8 picker exists.
  class: Ref | null;
  owner: Ref | null;
  headcount: number | null;
  amountMyr: string | null;
  fundingType: FundingType | null;
  hrdcGrantRef: string | null;
  // Plain YYYY-MM-DD (§4).
  hrdcApprovalDate: string | null;
  hrdcDeadlineDate: string | null;
  lostReason: LostReasonOption | null;
  wonAt: string | null;
  lostAt: string | null;
  stageChangedAt: string;
  checkoutUrl: string | null;
  checkoutSentAt: string | null;
  createdAt: string;
  // updated_at::text with microseconds; send back as If-Match (§7).
  version: string;
  stageHistory: StageHistoryEntry[];
  tasks: DealTask[];
  enquiry: LinkedEnquiry | null;
  enrolments: DealEnrolment[];
};

// The nine fields 9.6 may write (proposal Q1). Absent means untouched;
// null means clear.
export type DealUpdate = {
  companyId?: string | null;
  courseId?: string | null;
  headcount?: number | null;
  amountMyr?: string | null;
  fundingType?: FundingType | null;
  hrdcGrantRef?: string | null;
  hrdcApprovalDate?: string | null;
  hrdcDeadlineDate?: string | null;
  ownerId?: string | null;
  lostReasonId?: string | null;
};
