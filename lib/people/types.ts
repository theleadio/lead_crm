// API shape for the People list (spec §7 GET /api/people, §9.1 columns).
// Mirrors spec §5 `person`; field names will be checked against Shawn's
// generated client once the schema lands.

export type Language = "en" | "zh";
export type LifecycleStage = "lead" | "student" | "customer";

export type PersonListItem = {
  id: string;
  fullName: string;
  preferredName: string | null;
  email: string | null;
  phone: string | null;
  phoneE164: string | null;
  preferredLanguage: Language;
  stage: LifecycleStage;
  owner: { id: string; fullName: string } | null;
  lastActivityAt: string | null;
  tags: string[];
  needsReview: boolean;
  needsReviewReason: string | null;
  createdAt: string;
};

export type PeopleFilters = {
  q?: string;
  stage?: LifecycleStage;
  language?: Language;
  needsReview?: boolean;
  owner?: string; // app_user id, or "unassigned"
  tags?: string[]; // person has any of these
  hasOpenDeal?: boolean;
  createdFrom?: string; // YYYY-MM-DD, Asia/Kuala_Lumpur
  createdTo?: string;
};

export type PeopleListQuery = PeopleFilters & { page: number; limit: number };

export type Option = { id: string; label: string };

export type PageInfo = { total: number; page: number; limit: number };

export type ListResponse<T> = { data: T[]; page: PageInfo };
