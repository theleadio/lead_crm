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

export type PeopleSort =
  "name" | "-name" | "created" | "-created" | "lastActivity" | "-lastActivity";

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
  sort?: PeopleSort;
};

export type PeopleListQuery = PeopleFilters & { page: number; limit: number };

// Spec §7.1 shapes.
export type OwnerOption = { id: string; fullName: string };
export type TagOption = { id: string; name: string };

// Spec §9.2 Person detail (GET /api/people/:id). Each related section is
// null when the viewer's role can't read that resource (§6) — the UI hides
// the panel. Timeline and consent have their own routes (§7.1, §7).
export type PersonDetail = {
  person: {
    id: string;
    fullName: string;
    preferredName: string | null;
    email: string | null;
    phone: string | null;
    whatsapp: string | null;
    preferredLanguage: Language;
    jobTitle: string | null;
    notes: string | null;
    stage: LifecycleStage;
    owner: { id: string; fullName: string } | null;
    companyId: string | null;
    companyName: string | null;
    // What the person typed on the latest public form (§9.2 "From form").
    companyNameGiven: string | null;
    needsReview: boolean;
    needsReviewReason: string | null;
    lastActivityAt: string | null;
    createdAt: string;
    // updated_at::text with microseconds; send back as If-Match (§7).
    version: string;
  };
  attribution: {
    firstTouch: Touchpoint | null;
    latestTouch: Touchpoint | null;
  };
  deals: DealSummary[] | null;
  enrolments: EnrolmentSummary[] | null;
  payments: PaymentSummary[] | null;
  enquiries: EnquirySummary[] | null;
};

export type Touchpoint = {
  id: string;
  occurredAt: string;
  channel: string;
  utmSource: string | null;
  utmCampaign: string | null;
};

export type DealSummary = {
  id: string;
  stage: string;
  courseName: string;
  amountMyr: string;
  owner: string | null;
};

export type EnrolmentSummary = {
  id: string;
  classCode: string;
  status: string;
  pricePaidMyr: string | null;
};

export type PaymentSummary = {
  id: string;
  method: string;
  amountMyr: string;
  paidAt: string | null;
  status: string;
};

export type EnquirySummary = {
  id: string;
  channel: string;
  category: string;
  status: string;
  handledBy: "ai" | "user";
};

export type ConsentState = {
  purpose: "marketing_email" | "marketing_whatsapp";
  isGranted: boolean;
  recordedAt: string;
};

export type TimelineItem = {
  at: string;
  kind:
    | "touchpoint"
    | "stage_change"
    | "task"
    | "message"
    | "payment"
    | "enrolment_change";
  text: string;
};

export type PageInfo = { total: number; page: number; limit: number };

export type ListResponse<T> = { data: T[]; page: PageInfo };
