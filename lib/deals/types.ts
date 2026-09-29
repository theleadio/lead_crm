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
