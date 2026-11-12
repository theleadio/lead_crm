import type { Pipeline, Stage } from "../deals/types.ts";

// Shapes for the §9.0 Home panels. Read-only: nothing on Home writes, so
// there is no `version` on any of these (§7 concurrency).

export type HomeTask = {
  id: string;
  type: string;
  title: string;
  // Second line: who or what the task hangs off, "—" when it hangs off nothing.
  who: string | null;
  // Where the row goes; null when the task has no record to open.
  href: string | null;
  dueAt: string;
  isOverdue: boolean;
};

export type HomeTasks = {
  // At most ten (§9.0 panel), oldest overdue first.
  tasks: HomeTask[];
  // How many more are overdue or due today beyond the ten shown.
  moreCount: number;
  overdueCount: number;
  todayCount: number;
};

export type HomeStageTotal = {
  stage: Stage;
  count: number;
  // numeric(12,2) as text, summed by the database (§4, §12.7).
  totalMyr: string;
};

export type HomePipelineTotals = {
  pipeline: Pipeline;
  // Open stages only: won and lost are not open work (§9.0).
  stages: HomeStageTotal[];
  openCount: number;
  openTotalMyr: string;
};

export type HomeClass = {
  id: string;
  code: string;
  courseName: string;
  startDate: string;
  endDate: string;
  language: "en" | "zh";
  mode: "in_person" | "online" | "hybrid";
  venue: string | null;
  city: string | null;
  status: string;
  capacity: number;
  // Seats taken per §12.1.
  sold: number;
  // WhatsApp opt-ins from the Meta campaigns linked to this class (migration
  // 023): distinct live people, all time. null when this viewer may not see
  // lead counts (canSeeLeadCounts).
  optins: { linkedCampaigns: number; people: number } | null;
};

// One count per item, and null for an item this role cannot act on (§9.0:
// "each shown only to roles that can act on it"). Operations approves notices
// but only reads people; sales is the other way round.
export type HomeNeedsAttention = {
  // People flagged by the §12.2 duplicate rules, still live.
  needsReview: number | null;
  // Change notices waiting for approval on 9.10 (§5 `class_notice`).
  pendingNotices: number | null;
};
