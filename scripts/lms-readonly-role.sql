-- Read-only Postgres login for code that only reads LMS data (lib/lms/read.ts).
-- NOT a migration and not run by any script: Shawn runs it once in the Supabase
-- SQL editor, after replacing the password with a generated one.
--
-- Then point DATABASE_URL at this role for anything that must not write:
--   postgresql://crm_lms_ro.<project-ref>:<password>@<pooler-host>:6543/postgres
-- (percent-encode special characters in the password, "#" -> %23).
--
-- credentials is left out on purpose: it holds participant logins.

create role crm_lms_ro login password 'REPLACE-WITH-A-GENERATED-PASSWORD';

grant usage on schema public to crm_lms_ro;
grant select on public.participants, public.enrollments,
                public.cohorts, public.courses to crm_lms_ro;
