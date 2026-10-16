# LEAD CRM setup checklist: DigitalOcean (database, jobs) and Netlify (app)

Written 16 Oct 2026 for Shawn, from spec v1.21 and the code on `feat/s1-stack-on-main`. Nothing here has been run on DigitalOcean or Netlify. Items marked **UNCHECKED** are things I could not verify from the code; look them up in the provider's own documentation before relying on them.

The split (decided 13–16 Oct): the database and the two scheduled jobs run on DigitalOcean; the web app runs on Netlify; Supabase stays for staff sign-in and payment-proof files only (O49).

There are **two** DigitalOcean databases, staging and production (spec §2, Environments, v1.21). Each has its own connection string and its own pair of scheduled jobs. Staging holds seeded fake data only, never production data (PDPA). A developer's own local or dev database is never either of these; tests commit data, so two people sharing one database make both test suites flaky. Do everything in sections 1 and 2 once per database, staging first.

## 1. DigitalOcean: databases (staging, then production)

- [ ] Create a managed PostgreSQL database in the **Singapore** region (spec §14: personal data stays in Singapore unless a transfer basis is documented). Use PostgreSQL 16 or 17; the migrations were tested on 17 only, and `lib/db/README.md` records 16.
- [ ] Restrict inbound connections to the app and job hosts only (spec O47, go-live check). **UNCHECKED:** Netlify's outbound addresses are not fixed, so a trusted-sources list may not be possible for the app. Decide how the app reaches the database (a connection pooler, a fixed-IP proxy, or an open port with TLS and a strong password) and write the choice into O47.
- [ ] Require TLS. The app connects with `ssl: "require"` (`lib/sql.ts`), which encrypts but does **not** verify the server certificate. **UNCHECKED:** whether DigitalOcean's CA needs to be supplied to verify it.
- [ ] Create a database user for the app, separate from the admin user. The app needs normal read/write on the tables and `EXECUTE` on the functions; it does not need to own them.
- [ ] Apply migrations **001 to 012 in order**, with a client that uses UTF-8 (`PGCLIENTENCODING=UTF8`, because 003 has non-ASCII text). Use the admin user. Stop on the first error. 009 stops with a clear message if legacy data breaks one of its checks.
- [ ] Do **not** run the files in `lib/db/tests/` against this database. They need an empty database and roll themselves back; run them on a throwaway copy.
- [ ] Back-up setting on, and do one restore test before go-live (spec §15.2).
- [ ] Check the database's maximum connections. The app is serverless: each instance opens its own pool of 5 (`lib/sql.ts`). **UNCHECKED:** how many instances Netlify runs at once; if that can exceed the limit, add a pooler or lower `max`. Note the same-key lock in `POST /api/public/leads` holds one connection for up to 5 seconds during the CAPTCHA call, and has never been tested through a pooler.
- [ ] Staging only: seed fake data with `npm run db:seed` (`scripts/seed-dev.ts`, it reads `DATABASE_URL` from `.env.local`), run once by you from your own machine with the staging string, then remove the string from that file. Never seed production, and never load production data into staging.
- [ ] Put each connection string in the password manager and in the two places below (its own jobs and its own Netlify deploy). Never in the repo, and never give the staging or production string to a developer's local setup.

## 2. DigitalOcean: two scheduled jobs per database

Each database gets both jobs (four in total). Each job runs the repo's scripts with `DATABASE_URL` set in the job's environment. Both scripts also work with no `.env.local`.

- [ ] **Expiry sweep:** `npm run reservations:expire`, every 15 minutes. Prints `expired N`. Safe at any time; it calls the database function `expire_reservations()`.
- [ ] **Outbox drain:** `npm run events:drain`, at an interval you choose (spec leaves it open; a short interval such as every minute is typical). Prints `claimed N processed N failed N dead N`; it exits 1 if any row failed, so a failing exit is worth an alert.
- [ ] The job needs Node and the repo's dependencies installed (`npm ci`). The scripts run `.ts` files directly with `node`, which was tested on Node 24 only (no `engines` field in `package.json`). **UNCHECKED:** which DigitalOcean product runs it (a scheduled job on App Platform, a Droplet with cron, or a Function). Pick one and write it into O48.
- [ ] After the first run of each, check the result: `SELECT count(*) FROM event_outbox WHERE processed_at IS NULL AND dead_at IS NULL;` should fall to 0, and `SELECT count(*) FROM event_outbox WHERE dead_at IS NOT NULL;` should be 0 (dead rows need `retryDeadEvents()`, spec §11.4).

## 3. Netlify: the web app

- [ ] Create the site from `theleadio/lead_crm` (branch `main`, after PR #3 is merged). There is no `netlify.toml` in the repo. **UNCHECKED:** Netlify's current support for Next.js 16 (the repo uses `next@16.3.6`); read Netlify's Next.js documentation before the first deploy.
- [ ] Build command: `npm run build`. Types for `app/` are generated by `next build` / `next typegen`; a plain `tsc --noEmit` on a clean checkout reports about 40 errors until that has run.
- [ ] Two deploys, as spec §2 says: **staging** deploys automatically on every merge to `main` and uses the staging database, Stripe test mode and test values; **production** is promoted by hand by you only and uses the production database and live values. **UNCHECKED:** how Netlify models this (a second site, a branch deploy, or deploy contexts with separate environment variables) and how its manual promote works; read Netlify's documentation and write the choice into §2.
- [ ] Set environment variables per deploy (never commit them). The values differ between staging and production; the production values go only to the production deploy:

| Variable                                                           | What it is                                    | Notes                                                                                        |
| ------------------------------------------------------------------ | --------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                     | DigitalOcean connection string                | TLS required                                                                                 |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase project, staff sign-in               | Supabase stays for login (O49)                                                               |
| `SUPABASE_SERVICE_ROLE_KEY`                                        | Server key for proof-file signing             | Server only; never expose to the browser                                                     |
| `PAYMENT_PROOF_BUCKET`                                             | Private bucket name, default `payment-proofs` | Create the bucket in Supabase, private                                                       |
| `PUBLIC_API_KEY`                                                   | Key the website sends as `X-Api-Key`          | 16+ characters; shorter or unset = the API answers 503                                       |
| `PUBLIC_ALLOWED_ORIGINS`                                           | Website origins allowed by CORS               | No wildcard                                                                                  |
| `PUBLIC_WEBSITE_URL`                                               | Website base URL for `registerUrl`            |                                                                                              |
| `TURNSTILE_SECRET_KEY`                                             | Cloudflare Turnstile secret                   | Unset = every lead submission is refused (fail closed); provider is O39, due Fri 30 Oct      |
| `RATE_LIMIT_SECRET`                                                | Server-only key for the rate limiter          | 16+ characters; **different from** `PUBLIC_API_KEY`; unset = `/api/public/leads` answers 503 |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`                       | Stripe                                        | Not read by any code yet; wait for the test keys                                             |

`AUTH_SECRET` and `APP_BASE_URL` are in `.env.example` but no code reads them today. `DEV_ROLE` and `DEV_USER_ID` must stay **unset**; they are ignored in production, but keep them out anyway. Do **not** set `PUBLIC_CAPTCHA_DISABLED`.

- [ ] Give the website its `PUBLIC_API_KEY` through a separate channel from the repo and from any shared chat.
- [ ] **Client IP for the rate limiter (UNCHECKED, go-live check, O40, spec §8.2):** the app reads `x-real-ip`, then the first hop of `x-forwarded-for`. That is only safe when the proxy in front overwrites them. Look up which header Netlify sets for the real client and whether it replaces a value the visitor sent. If it doesn't, the per-IP limit can be bypassed or turned against other visitors. Test it: send a request with a forged `x-forwarded-for` and see which value the app sees.
- [ ] **Schedule cache (O38):** the schedule feed is cached 5 minutes by its `Cache-Control` header. If a class edit must show at once, find Netlify's cache-purge call. Not built.
- [ ] After the first deploy, test with the real values:
  - `GET /api/public/schedule` with the key: 200; with a wrong key: 401.
  - `POST /api/public/leads` with the key and a real Turnstile token: 201; the same body again: same ids.
  - A request from an origin not in `PUBLIC_ALLOWED_ORIGINS`: 403.
  - Sign in as a staff user and open Home, People, Classes.

## 4. Supabase (sign-in and proof files only)

- [ ] Keep the Supabase project. Create the private storage bucket named in `PAYMENT_PROOF_BUCKET`.
- [ ] Create the staff users in Supabase Auth, then link each to its row in `app_user.auth_user_id` (a plain text column; there is no foreign key to `auth.users`). Write the mapping down (O49).
- [ ] The app database is **not** on Supabase, so Supabase's Data API (PostgREST) has nothing of ours to expose. Confirm no table was created in the Supabase project's database.

## 5. Before go-live (14 Dec), from the spec

- [ ] Stripe test payment end to end (waits on the test keys; O36, O43, and the `/register` route).
- [ ] Full backup restore, concurrency test, schedule feed serving the live website (spec §15.2).
- [ ] The database accepts connections only from the app and job hosts, TLS required, nothing exposed through a REST layer (O47, Fri 27 Nov).
- [ ] Client-IP header, connection limit and TLS verification checked on the real setup (the three UNCHECKED items above).
