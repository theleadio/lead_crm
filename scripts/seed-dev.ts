// Dev seed — fake data only (spec §2: never production data outside production).
//
//   npm run db:seed            fill an empty database
//   npm run db:seed -- --reset wipe business tables first, then fill
//
// Also links every Supabase login (auth.users) to an app_user, so signing
// in works. Refuses to run with NODE_ENV=production.
import postgres from "postgres";
import { SEED_USERS } from "./seed-ids.ts";

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed a production database.");
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (run with --env-file=.env.local).");
  process.exit(1);
}
const sql = postgres(url, { ssl: "require", max: 1, onnotice: () => {} });

const NAMES = [
  "Tan Mei Ling",
  "Ali bin Hassan",
  "Lim Wei Jie",
  "Nur Aisyah binti Ahmad",
  "Wong Kar Wai",
  "Siti Nurhaliza",
  "Chong Wei Ming",
  "Rajesh Kumar",
  "Lee Hui Min",
  "Muhammad Faiz",
  "Ng Pei Shan",
  "Kavitha Raman",
  "Ooi Chee Keong",
  "Farah Nabila",
  "Goh Siew Ling",
  "Arjun Pillai",
];
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const daysAgo = (d: number) => new Date(NOW - d * DAY);

async function reset() {
  // TRUNCATE skips the append-only row triggers; keeps lost_reason and
  // app_setting (seeded by the migration).
  await sql`
    TRUNCATE audit_log, message_log, consent, task, payment, enquiry,
             deal_stage_history, enrolment, deal, class_notice, class, course,
             person_tag, tag, touchpoint, company_membership, company,
             event_outbox, integration_event, person, app_user CASCADE`;
}

async function seed() {
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM person`;
  if (n > 0) {
    console.log(`person already has ${n} rows — use --reset to reseed.`);
    return;
  }

  await sql.begin(async (tx) => {
    // Staff. Seed Admin is for tests; real logins are linked below.
    await tx`
      INSERT INTO app_user (id, email, full_name, role_code, employment_type) VALUES
        (${SEED_USERS.admin},   'seed.admin@lead.test', 'Seed Admin', 'super_admin', 'full_time'),
        (${SEED_USERS.weiPing}, 'weiping@lead.test',    'Wei Ping',   'sales',       'full_time'),
        (${SEED_USERS.daphne},  'daphne@lead.test',     'Daphne',     'marketing',   'full_time'),
        (${SEED_USERS.leeYee},  'leeyee@lead.test',     'Lee Yee',    'part_time',   'part_time')`;
    const logins = await tx`SELECT id, email FROM auth.users`;
    for (const u of logins)
      await tx`
        INSERT INTO app_user (auth_user_id, email, full_name, role_code)
        VALUES (${u.id}, ${u.email}, ${u.email.split("@")[0]}, 'super_admin')
        ON CONFLICT (auth_user_id) DO NOTHING`;

    const tags = await tx`
      INSERT INTO tag (name, is_system) VALUES
        ('[source] meta', true), ('[workshop] 25 Sep', true),
        ('vip', false), ('hrdc', false), ('corporate', false), ('follow-up', false)
      RETURNING id, name`;
    const tagId = (name: string) => tags.find((t) => t.name === name)!.id;
    const TAG_SETS = [
      [],
      ["[source] meta"],
      ["[workshop] 25 Sep", "vip"],
      ["[source] meta", "hrdc", "corporate", "follow-up"],
    ];

    const companies = await tx`
      INSERT INTO company (legal_name, industry, hrdc_registered) VALUES
        ('Acme Sdn Bhd', 'Manufacturing', true), ('Maju Holdings', 'Retail', false)
      RETURNING id`;

    const [aia, aim] = await tx`
      INSERT INTO course (code, name_en, name_zh, track, duration_days, list_price_myr, hrdc_claimable) VALUES
        ('AIA', 'AI Agentic Automation', 'AI 智能体自动化', 'certification', 2, 3200, true),
        ('AIM', 'AI Mastery', 'AI 精通', 'mastery', 3, 4800, true)
      RETURNING id`;
    const [, aimClass] = await tx`
      INSERT INTO class (course_id, code, start_date, end_date, language, mode,
                         venue_name, venue_address, city, capacity, status, is_public) VALUES
        (${aia.id}, 'AIA-2610-EN', '2026-10-06', '2026-10-07', 'en', 'in_person',
         'AI365 Hub', 'Oval Damansara', 'Kuala Lumpur', 30, 'open', true),
        (${aim.id}, 'AIM-2610-EN', '2026-10-20', '2026-10-22', 'en', 'in_person',
         'AI365 Hub', 'Oval Damansara', 'Kuala Lumpur', 25, 'open', true)
      RETURNING id`;

    const owners = [SEED_USERS.weiPing, SEED_USERS.daphne, SEED_USERS.leeYee];
    for (let i = 0; i < 60; i++) {
      const name =
        NAMES[i % NAMES.length] +
        (i >= NAMES.length ? ` ${Math.floor(i / NAMES.length) + 1}` : "");
      const local = String(120_000_000 + i * 7919).slice(0, 9);
      const email = `${name.split(" ")[0].toLowerCase()}${i}@example.com`;
      const created = daysAgo(i);
      const activity = [0, 2, 5, 12, 40, null][i % 6];
      const stage = ["lead", "lead", "student", "customer"][i % 4];
      const owner = i % 4 === 1 ? null : owners[i % owners.length];

      const [p] = await tx`
        INSERT INTO person (full_name, email, phone, phone_e164, whatsapp_e164,
                            preferred_language, owner_user_id, needs_review,
                            last_activity_at, created_at, updated_at)
        VALUES (${name}, ${email},
                ${`0${local.slice(0, 2)}-${local.slice(2, 5)} ${local.slice(5)}`},
                ${`+60${local}`}, ${`+60${local}`}, ${i % 3 === 2 ? "zh" : "en"},
                ${owner}, ${i % 11 === 3},
                ${activity === null ? null : daysAgo(activity)}, ${created}, ${created})
        RETURNING id`;

      if (i % 4 < 2)
        await tx`INSERT INTO company_membership (person_id, company_id, job_title)
                 VALUES (${p.id}, ${companies[i % 2].id}, ${i % 2 ? "Manager" : "HR Executive"})`;
      for (const t of TAG_SETS[i % TAG_SETS.length])
        await tx`INSERT INTO person_tag (person_id, tag_id) VALUES (${p.id}, ${tagId(t)})`;

      await tx`
        INSERT INTO touchpoint (person_id, occurred_at, channel, utm_source, utm_campaign, is_first_touch)
        VALUES (${p.id}, ${created}, 'web_form', ${i % 2 ? "facebook" : "google"},
                'agentic_202610_leads_en', true)`;
      if (i % 3 === 0)
        await tx`INSERT INTO touchpoint (person_id, occurred_at, channel)
                 VALUES (${p.id}, ${new Date(created.getTime() + 30 * 3600e3)}, 'whatsapp')`;

      if (i % 3 === 0) {
        const [d] = await tx`
          INSERT INTO deal (pipeline, stage, person_id, course_id, amount_myr, owner_user_id)
          VALUES ('individual', 'engaged', ${p.id}, ${aia.id}, 3200, ${owner}) RETURNING id`;
        await tx`INSERT INTO deal_stage_history (deal_id, from_stage, to_stage, changed_at)
                 VALUES (${d.id}, 'new', 'engaged', ${new Date(created.getTime() + DAY)})`;
      }

      if (stage !== "lead") {
        const won = new Date(created.getTime() + DAY);
        const [d] = await tx`
          INSERT INTO deal (pipeline, stage, person_id, course_id, class_id, amount_myr,
                            owner_user_id, won_at)
          VALUES ('individual', 'won', ${p.id}, ${aim.id}, ${aimClass.id}, 4800, ${owner}, ${won})
          RETURNING id`;
        await tx`INSERT INTO deal_stage_history (deal_id, from_stage, to_stage, changed_at)
                 VALUES (${d.id}, 'checkout_sent', 'won', ${won})`;
        const completed = stage === "customer";
        const [e] = await tx`
          INSERT INTO enrolment (person_id, class_id, deal_id, status, price_paid_myr, completed_at)
          VALUES (${p.id}, ${aimClass.id}, ${d.id}, ${completed ? "completed" : "confirmed"},
                  ${completed ? 4800 : null}, ${completed ? won : null})
          RETURNING id`;
        if (completed)
          await tx`
            INSERT INTO payment (enrolment_id, deal_id, method, status, amount_myr, paid_at)
            VALUES (${e.id}, ${d.id}, 'stripe_card', 'succeeded', 4800,
                    ${new Date(created.getTime() + 2 * DAY)})`;
      }

      // Enquiries; Lee Yee (part-time) is assigned every fifth one (§6 v1.2).
      if (i % 2 === 0 || i % 5 === 1)
        await tx`
          INSERT INTO enquiry (person_id, channel, category, status, handled_by, assigned_user_id)
          VALUES (${p.id}, 'whatsapp', 'hrdc', ${i % 4 === 0 ? "human_resolved" : "open"},
                  ${i % 4 === 0 ? "user" : "ai"}, ${i % 5 === 1 ? SEED_USERS.leeYee : null})`;

      await tx`
        INSERT INTO consent (person_id, purpose, is_granted, source, recorded_at) VALUES
          (${p.id}, 'marketing_email', true, 'web_form', ${created}),
          (${p.id}, 'marketing_whatsapp', ${i % 5 !== 0}, 'web_form', ${created})`;

      await tx`
        INSERT INTO task (type, title, person_id, assigned_user_id, done_at, done_by, created_at)
        VALUES ('call', 'First-contact call', ${p.id}, ${owner ?? SEED_USERS.weiPing},
                ${new Date(created.getTime() + 2 * 3600e3)}, ${owner ?? SEED_USERS.weiPing}, ${created})`;
      await tx`
        INSERT INTO message_log (person_id, channel, direction, status, sent_at)
        VALUES (${p.id}, 'whatsapp', 'in', 'received', ${new Date(created.getTime() + 3 * 3600e3)})`;
    }

    // Spec §4: a phone that couldn't be normalised is kept and flagged.
    await tx`
      INSERT INTO person (full_name, phone, needs_review, created_at, updated_at)
      VALUES ('Unknown Format', '12345', true, ${daysAgo(61)}, ${daysAgo(61)})`;
  });

  const [{ people }] = await sql`SELECT count(*)::int AS people FROM person`;
  const linked =
    await sql`SELECT email FROM app_user WHERE auth_user_id IS NOT NULL`;
  console.log(`Seeded ${people} people.`);
  console.log(
    `Logins linked as super_admin: ${linked.map((u) => u.email).join(", ") || "none (sign up first, then reseed)"}`,
  );
}

try {
  if (process.argv.includes("--reset")) await reset();
  await seed();
} finally {
  await sql.end();
}
