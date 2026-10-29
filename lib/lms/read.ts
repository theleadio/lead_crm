import { db } from "../sql.ts";

// Read-only window onto the LMS tables (participants, enrollments, cohorts,
// courses) that live in the same Supabase database. Reads only: the LMS owns
// these rows. `credentials` is left out on purpose, it holds logins.
// Only /lib services import this, same layering as lib/sql.ts.

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
  return db()<LmsEnrollment[]>`
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
