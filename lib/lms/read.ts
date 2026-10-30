import postgres from "postgres";

// Read-only window onto the LMS tables (participants, enrollments, cohorts,
// courses). The LMS is a separate Supabase project from the CRM's own
// database, so this has its own connection: LMS_DATABASE_URL, ideally the
// select-only login from scripts/lms-readonly-role.sql. Reads only: the LMS
// owns these rows. `credentials` is left out on purpose, it holds logins.
// Only /lib services import this, same layering as lib/sql.ts.

const globalForLms = globalThis as unknown as { __leadLmsSql?: postgres.Sql };

function lms(): postgres.Sql {
  if (!globalForLms.__leadLmsSql) {
    const url = process.env.LMS_DATABASE_URL;
    if (!url) throw new Error("LMS_DATABASE_URL is not set");
    // Cached on globalThis so dev hot-reload doesn't open a new pool each time.
    globalForLms.__leadLmsSql = postgres(url, {
      ssl: "require",
      max: 3,
      // LMS_DATABASE_URL is on Supabase's transaction pooler (6543), which
      // hands a different backend to every statement — a prepared statement
      // is gone before it executes (Postgres 26000, FetchPreparedStatement).
      prepare: !/:6543(\/|$)/.test(url),
    });
  }
  return globalForLms.__leadLmsSql;
}

export async function closeLms(): Promise<void> {
  const sql = globalForLms.__leadLmsSql;
  globalForLms.__leadLmsSql = undefined;
  await sql?.end();
}

export type LmsEnrollment = {
  enrollmentId: string;
  enrolledAt: Date;
  fundingType: string | null;
  amountPaidCents: number | null;
  participantId: string;
  email: string | null;
  fullName: string | null;
  phone: string | null;
  company: string | null;
  cohortSlug: string | null;
  cohortStart: string | null;
  courseName: string;
  courseNameCn: string | null;
};

// Newest first. `email` matches case-insensitively; omit it for the latest
// enrolments across everyone. `limit` is clamped to 1..500.
export async function listLmsEnrollments(
  opts: { email?: string; limit?: number } = {},
): Promise<LmsEnrollment[]> {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 50), 1), 500);
  const email = opts.email?.trim().toLowerCase() || null;
  return lms()<LmsEnrollment[]>`
    select e.id as "enrollmentId", e.created_at as "enrolledAt",
           e.funding_type as "fundingType",
           e.amount_paid_cents as "amountPaidCents",
           p.id as "participantId", p.email, p.full_name as "fullName",
           p.phone, p.company,
           c.slug as "cohortSlug", c.start_date::text as "cohortStart",
           co.name as "courseName", co.name_cn as "courseNameCn"
      from public.enrollments e
      join public.participants p on p.id = e.participant_id
      join public.cohorts c on c.id = e.cohort_id
      join public.courses co on co.id = c.course_id
     where ${email}::text is null or lower(p.email) = ${email}
     order by e.created_at desc
     limit ${limit}`;
}

// Seats by course, language and how they were funded. An aggregate rather
// than a row list: the §9.18 who-pays panel counts 355 seats today and will
// count more, and `listLmsEnrollments` caps at 500 rows by design.
//
// The LMS is the only place that records funding — the CRM's `deal` table is
// where it belongs, but the import does not carry it yet.
export type LmsFundingRow = {
  courseName: string;
  courseNameCn: string | null;
  language: string | null;
  durationDays: number;
  seats: number;
  hrdc: number;
};

export async function lmsFundingByCourse(): Promise<LmsFundingRow[]> {
  return lms()<LmsFundingRow[]>`
    select co.name as "courseName", co.name_cn as "courseNameCn",
           c.language,
           (coalesce(c.end_date, c.start_date) - c.start_date + 1)::int
             as "durationDays",
           count(e.id)::int as seats,
           count(*) filter (where e.funding_type = 'hrdc')::int as hrdc
      from public.enrollments e
      join public.cohorts c on c.id = e.cohort_id
      join public.courses co on co.id = c.course_id
     group by co.name, co.name_cn, c.language,
              (coalesce(c.end_date, c.start_date) - c.start_date + 1)
    having count(e.id) > 0
     order by count(e.id) desc`;
}
