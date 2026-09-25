// API shapes for spec §9.4 Companies (GET /api/companies, GET /api/companies/:id).

export type CompanyListItem = {
  id: string;
  legalName: string;
  industry: string | null;
  sizeBand: string | null;
  hrdcRegistered: boolean;
  peopleCount: number;
  openDeals: number;
};

export type CompanyListQuery = {
  q?: string;
  hrdcRegistered?: boolean;
  hasOpenDeal?: boolean;
  similarTo?: string;
  registrationNo?: string;
  excludeId?: string;
  sort?: "name" | "-name";
  page: number;
  limit: number;
};

// Each related section is null when the viewer's role can't read that
// resource (§6) — the UI hides the panel.
export type CompanyDetail = {
  company: {
    id: string;
    legalName: string;
    registrationNo: string | null;
    industry: string | null;
    sizeBand: string | null;
    hrdcRegistered: boolean;
    billingAddress: string | null;
    billingEmail: string | null;
    owner: { id: string; fullName: string } | null;
    updatedAt: string;
  };
  members: {
    membershipId: string;
    startDate: string | null;
    personId: string;
    fullName: string;
    jobTitle: string | null;
    isHrContact: boolean;
    isBillingContact: boolean;
  }[];
  pastMembers: {
    membershipId: string;
    personId: string;
    fullName: string;
    jobTitle: string | null;
    startDate: string | null;
    endDate: string;
  }[];
  deals:
    | {
        id: string;
        stage: string;
        courseName: string | null;
        amountMyr: string;
        owner: string | null;
      }[]
    | null;
  enrolments:
    | {
        id: string;
        personName: string;
        classCode: string;
        status: string;
        pricePaidMyr: string | null;
      }[]
    | null;
  // Net of refunds; null for roles that can't read payments (§6).
  totalRevenueMyr: string | null;
};
