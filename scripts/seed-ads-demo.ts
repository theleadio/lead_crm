// Demo data for the §9.18 ads report — fake data only (spec §2: never
// production data outside production).
//
//   node --env-file=.env.local scripts/seed-ads-demo.ts
//   node --env-file=.env.local scripts/seed-ads-demo.ts --clean
//
// Shapes of the real LEAD programme mix: eight courses at two price tiers,
// eleven class runs across September and October 2026 in both languages, and
// the HRDC share each one actually had. It exists so the report's panels show
// a real distribution rather than two points.
//
// Everything it writes is tagged with the DEMO_DOMAIN email and the course
// codes below, so --clean removes exactly this and nothing else. It adds to
// whatever is already there; it never truncates.
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
const sql = postgres(url, {
  ssl: url.includes("sslmode=disable") ? false : "require",
  max: 1,
  onnotice: () => {},
});

const DEMO_DOMAIN = "ads-demo.test";

// Every demo row in `meta_ad_insight` carries this account id, so --clean
// removes exactly the fake spend and never a real pull's rows.
const DEMO_AD_ACCOUNT = "act_adsdemo";

// What a signup cost, per course, in whole ringgit. The spread is the point:
// the efficiency map is only worth drawing if some campaigns sit well above
// the RM 200 guide and some well below it.
const COST_PER_SIGNUP: Record<string, number> = {
  "ADSD-LTF": 38,
  "ADSD-CLAUDE": 72,
  "ADSD-FULLST": 96,
  "ADSD-DATASC": 118,
  "ADSD-AIENG": 134,
  "ADSD-AGENTS": 165,
  "ADSD-AIAUTO": 305,
  "ADSD-VIBE": 430,
};
const DEFAULT_COST_PER_SIGNUP = 120;

// Meta runs the ads before the class, not after it.
const AD_WINDOW_DAYS = 14;

// Prices come out of the reference dashboard as revenue / orders: about
// RM 734 for a one-day programme and RM 3,420-3,456 for a two-day one. That
// gap is the whole point of the price-against-HRDC-share panel.
const COURSES = [
  ["ADSD-AIAUTO", "AI Automation", "AI 自动化", "certification", 2, "3456.00"],
  [
    "ADSD-CLAUDE",
    "Claude AI Mastery",
    "Claude AI 精通",
    "mastery",
    1,
    "734.00",
  ],
  [
    "ADSD-FULLST",
    "AI Full-Stack",
    "AI 全栈开发",
    "certification",
    2,
    "3420.00",
  ],
  ["ADSD-DATASC", "Data Science", "数据科学", "certification", 2, "3456.00"],
  ["ADSD-AIENG", "AI Engineering", "AI 工程", "certification", 2, "3432.00"],
  ["ADSD-VIBE", "Vibe Coding", "氛围编程", "workshop", 1, "734.00"],
  [
    "ADSD-AGENTS",
    "AI Agents Foundation",
    "AI 智能体基础",
    "certification",
    2,
    "2916.00",
  ],
  // Conference tickets are not sold through Stripe, so it has no list price —
  // which is why the reference page shows it with no revenue and no ROAS.
  ["ADSD-LTF", "LTF Conference", "LTF 大会", "conference", 1, null],
] as const;

// One row per class run: the signups and the HRDC share the reference reports.
// `campaign` is the utm_campaign the leads for that run carried.
const RUNS = [
  // code suffix, course, lang, start, end, city, signups, hrdc, campaign
  [
    "LTF-0909-CN",
    "ADSD-LTF",
    "zh",
    "2026-09-09",
    "2026-09-09",
    "Kuala Lumpur",
    46,
    15,
    "ltf_202609_leads_cn",
  ],
  [
    "LTF-0910-EN",
    "ADSD-LTF",
    "en",
    "2026-09-10",
    "2026-09-10",
    "Kuala Lumpur",
    45,
    15,
    "ltf_202609_leads_en",
  ],
  [
    "AIAUTO-0914-EN",
    "ADSD-AIAUTO",
    "en",
    "2026-09-14",
    "2026-09-15",
    "Kuala Lumpur",
    31,
    22,
    "aiauto_202609_leads_en",
  ],
  [
    "AIAUTO-0919-CN",
    "ADSD-AIAUTO",
    "zh",
    "2026-09-19",
    "2026-09-20",
    "Kuala Lumpur",
    30,
    21,
    "aiauto_202609_leads_cn",
  ],
  [
    "CLAUDE-0918-CN",
    "ADSD-CLAUDE",
    "zh",
    "2026-09-18",
    "2026-09-18",
    "Kuala Lumpur",
    40,
    25,
    "claude_202609_leads_cn",
  ],
  [
    "FULLST-0926-EN",
    "ADSD-FULLST",
    "en",
    "2026-09-26",
    "2026-09-27",
    "Kuala Lumpur",
    29,
    15,
    "fullstack_202609_leads_en",
  ],
  [
    "CLAUDE-1005-EN",
    "ADSD-CLAUDE",
    "en",
    "2026-10-05",
    "2026-10-05",
    "Kuala Lumpur",
    35,
    12,
    "claude_202610_leads_en",
  ],
  [
    "AIAUTO-1006-EN",
    "ADSD-AIAUTO",
    "en",
    "2026-10-06",
    "2026-10-07",
    "Kuala Lumpur",
    30,
    22,
    "aiauto_202610_leads_en",
  ],
  [
    "DATASC-1014-EN",
    "ADSD-DATASC",
    "en",
    "2026-10-14",
    "2026-10-15",
    "Kuala Lumpur",
    18,
    12,
    "datasci_202610_leads_en",
  ],
  [
    "AIENG-1017-EN",
    "ADSD-AIENG",
    "en",
    "2026-10-17",
    "2026-10-18",
    "Kuala Lumpur",
    27,
    16,
    "aieng_202610_leads_en",
  ],
  [
    "VIBE-1023-CN",
    "ADSD-VIBE",
    "zh",
    "2026-10-23",
    "2026-10-23",
    "Johor Bahru",
    45,
    12,
    "vibe_202610_leads_cn",
  ],
  [
    "VIBE-1025-CN",
    "ADSD-VIBE",
    "zh",
    "2026-10-25",
    "2026-10-25",
    "Kuala Lumpur",
    20,
    8,
    "vibe_202610_leads_cn",
  ],
  [
    "AGENTS-1027-EN",
    "ADSD-AGENTS",
    "en",
    "2026-10-27",
    "2026-10-28",
    "Kuala Lumpur",
    29,
    16,
    "agents_202610_leads_en",
  ],
] as const;

const SURNAMES = [
  "Tan",
  "Lim",
  "Wong",
  "Ng",
  "Ooi",
  "Goh",
  "Chong",
  "Lee",
  "Yeoh",
  "Teoh",
];
const GIVEN_ZH = [
  "Mei Ling",
  "Wei Jie",
  "Hui Min",
  "Pei Shan",
  "Chee Keong",
  "Siew Ling",
  "Kar Wai",
  "Wei Ming",
];
const GIVEN_EN = [
  "Aisyah",
  "Faiz",
  "Rajesh",
  "Kavitha",
  "Farah",
  "Arjun",
  "Hassan",
  "Nabila",
];

// The channel mix the §8.2 intake actually writes, so the source table has
// something to break down. Meta Lead Ads and click-to-WhatsApp dominate.
const CHANNELS = [
  "lead_form",
  "ctwa",
  "lead_form",
  "web_form",
  "ctwa",
] as const;
const SOURCES = [
  "facebook",
  "instagram",
  "facebook",
  "facebook",
  "instagram",
] as const;

const DAY = 24 * 60 * 60 * 1000;

// Migration 014 is Shawn's and may not be applied to this database yet. The
// rest of the demo data is still worth seeding without it, so its absence is
// reported rather than thrown.
async function hasAdInsights(tx: postgres.TransactionSql): Promise<boolean> {
  const [row] = await tx<{ present: boolean }[]>`
    SELECT to_regclass('public.meta_ad_insight') IS NOT NULL AS present`;
  return row?.present ?? false;
}

// Splits whole cents across weighted buckets so the parts add up to the total
// exactly — the largest remainders take the leftover cents. Money is never
// divided in floating point (§12.7).
function allocate(totalCents: number, weights: number[]): number[] {
  const sum = weights.reduce((n, w) => n + w, 0);
  const exact = weights.map((w) => (totalCents * w) / sum);
  const parts = exact.map(Math.floor);
  let left = totalCents - parts.reduce((n, p) => n + p, 0);
  const order = exact
    .map((e, i) => ({ i, fraction: e - Math.floor(e) }))
    .sort((a, b) => b.fraction - a.fraction);
  for (const { i } of order) {
    if (left <= 0) break;
    parts[i] += 1;
    left -= 1;
  }
  return parts;
}

function money(cents: number): string {
  return (cents / 100).toFixed(2);
}

// One row per ad per day, the shape Meta's insights edge reports and
// migration 014 stores. Two ads per campaign, spend rising towards the class
// date, and a cost per signup that varies by course rather than by chance —
// the panels are only worth looking at if the campaigns differ.
function adInsightRows() {
  const rows = [];
  for (const run of RUNS) {
    const [, course, language, start, , , signups, , campaign] = run;
    const classStart = Date.parse(`${start}T00:00:00Z`);
    const perSignup = COST_PER_SIGNUP[course] ?? DEFAULT_COST_PER_SIGNUP;
    const totalCents = signups * perSignup * 100;

    // Later days carry more of the budget, which is how these campaigns were
    // actually run: spend climbs as the class fills.
    const dayWeights = Array.from(
      { length: AD_WINDOW_DAYS },
      (_, d) => 10 + d * 2,
    );
    const perDay = allocate(totalCents, dayWeights);

    for (let d = 0; d < AD_WINDOW_DAYS; d += 1) {
      const day = new Date(classStart - (AD_WINDOW_DAYS - d) * DAY)
        .toISOString()
        .slice(0, 10);
      // The carousel takes the larger share; the video is the cheaper test.
      const [carousel, video] = allocate(perDay[d], [3, 2]);
      const ads: [string, number][] = [
        [`${campaign}__carousel`, carousel],
        [`${campaign}__video`, video],
      ];

      for (const [adId, cents] of ads) {
        // About RM 1.20 a click and one click in fifty-five impressions —
        // ordinary numbers for these campaigns, so the ranked ad tables and
        // the click-through rates read as plausible.
        const clicks = Math.max(1, Math.round(cents / 120));
        rows.push({
          ad_id: adId,
          day,
          account_id: DEMO_AD_ACCOUNT,
          campaign_id: `${campaign}__id`,
          campaign_name: campaign,
          adset_id: `${campaign}__adset`,
          adset_name: `${campaign} · ${language === "zh" ? "CN" : "EN"}`,
          ad_name: adId.endsWith("carousel")
            ? `${campaign} — carousel`
            : `${campaign} — video`,
          currency: "MYR",
          spend: money(cents),
          impressions: clicks * 55,
          clicks,
          // Meta's own names, so the report's bucketing is exercised rather
          // than bypassed: the carousel sells, the video opens a chat.
          objective: adId.endsWith("carousel")
            ? "OUTCOME_SALES"
            : "OUTCOME_ENGAGEMENT",
          // Link clicks are a share of every click, the way the live account
          // reports them — never equal to the click count.
          inline_link_clicks: Math.max(1, Math.round(clicks * 0.45)),
          messages: adId.endsWith("video") ? Math.round(clicks * 0.08) : 0,
          checkouts: adId.endsWith("carousel") ? Math.round(clicks * 0.05) : 0,
          url_tags:
            "utm_source=fb_ad&utm_medium={{adset.name}}" +
            `&utm_campaign=${campaign}&utm_content={{ad.name}}`,
          // Meta counts a lead when the form is submitted, which is always
          // more than the seats that were finally taken.
          leads: Math.max(1, Math.round((clicks * signups) / 160)),
        });
      }
    }
  }
  return rows;
}

async function clean(): Promise<void> {
  await sql.begin(async (tx) => {
    const people = tx`
      SELECT id FROM person WHERE email LIKE ${"%@" + DEMO_DOMAIN}`;
    await tx`DELETE FROM payment WHERE enrolment_id IN
             (SELECT id FROM enrolment WHERE person_id IN (${people}))`;
    await tx`DELETE FROM enrolment_status_history WHERE enrolment_id IN
             (SELECT id FROM enrolment WHERE person_id IN (${people}))`;
    await tx`DELETE FROM enrolment WHERE person_id IN (${people})`;
    await tx`DELETE FROM deal_stage_history WHERE deal_id IN
             (SELECT id FROM deal WHERE person_id IN (${people}))`;
    await tx`DELETE FROM deal WHERE person_id IN (${people})`;
    // touchpoint is append-only behind forbid_change(), which blocks UPDATE
    // and DELETE. The trigger has to be stepped over for demo rows, and only
    // for these: a real touchpoint is never deleted (§5).
    await tx`ALTER TABLE touchpoint DISABLE TRIGGER touchpoint_append_only`;
    await tx`DELETE FROM touchpoint WHERE person_id IN (${people})`;
    await tx`ALTER TABLE touchpoint ENABLE TRIGGER touchpoint_append_only`;
    await tx`UPDATE person SET first_touchpoint_id = NULL
             WHERE email LIKE ${"%@" + DEMO_DOMAIN}`;
    await tx`DELETE FROM person WHERE email LIKE ${"%@" + DEMO_DOMAIN}`;
    // Class codes are the run suffixes (LTF-0909-CN, …); only course.code
    // carries the ADSD- tag. Matching class.code deleted nothing, and the
    // course delete then failed on the class foreign key, so --clean removed
    // nothing at all and a re-seed hit the unique course code.
    await tx`DELETE FROM class WHERE course_id IN
             (SELECT id FROM course WHERE code LIKE 'ADSD-%')`;
    await tx`DELETE FROM course WHERE code LIKE 'ADSD-%'`;
    // Migration 014 may not be applied yet, and a missing table is not a
    // failed clean — there is nothing of ours in it.
    if (await hasAdInsights(tx))
      await tx`DELETE FROM meta_ad_insight WHERE account_id = ${DEMO_AD_ACCOUNT}`;
  });
  console.log("Removed the ads demo data.");
}

async function seed(): Promise<void> {
  await sql.begin(async (tx) => {
    const courseId = new Map<string, string>();
    for (const [code, nameEn, nameZh, track, days, price] of COURSES) {
      const [row] = await tx`
        INSERT INTO course (code, name_en, name_zh, track, duration_days,
                            list_price_myr, hrdc_claimable, is_active)
        VALUES (${code}, ${nameEn}, ${nameZh}, ${track}, ${days}, ${price},
                ${price !== null}, true)
        RETURNING id`;
      courseId.set(code, row.id);
    }

    let people = 0;
    let enrolments = 0;
    let touchpoints = 0;

    for (const [
      suffix,
      course,
      language,
      startDate,
      endDate,
      city,
      signups,
      hrdc,
      campaign,
    ] of RUNS) {
      const [cls] = await tx`
        INSERT INTO class (course_id, code, start_date, end_date, language,
                           mode, venue_name, venue_address, city, capacity,
                           price_myr, status, is_public, hrdc_claimable)
        VALUES (${courseId.get(course)!}, ${suffix}, ${startDate}, ${endDate},
                ${language}, 'in_person', 'AI365 Hub', 'Oval Damansara',
                ${city},
                ${signups + 10},
                ${COURSES.find((c) => c[0] === course)![5]},
                'open', true, true)
        RETURNING id`;

      // The class has run, so its seats are settled: every signup is a
      // confirmed or completed enrolment, never a live reservation.
      const classStart = Date.parse(`${startDate}T01:00:00Z`);
      const past = classStart < Date.now();

      for (let i = 0; i < signups; i += 1) {
        const given = (language === "zh" ? GIVEN_ZH : GIVEN_EN)[
          i % GIVEN_EN.length
        ];
        const name = `${SURNAMES[i % SURNAMES.length]} ${given}`;
        const tag = `${suffix.toLowerCase()}-${i}`;
        // Leads arrive across the four weeks before the class.
        const lead = new Date(classStart - (28 - (i % 28)) * DAY);
        const sold = new Date(lead.getTime() + 2 * DAY);

        const [p] = await tx`
          INSERT INTO person (full_name, email, phone, phone_e164,
                              whatsapp_e164, preferred_language,
                              owner_user_id, last_activity_at,
                              created_at, updated_at)
          VALUES (${name}, ${`${tag}@${DEMO_DOMAIN}`},
                  NULL, NULL, NULL, ${language},
                  ${[SEED_USERS.weiPing, SEED_USERS.daphne][i % 2]},
                  ${sold}, ${lead}, ${lead})
          RETURNING id`;
        people += 1;

        // One Meta first touch per person, carrying the run's campaign, so
        // the campaign and source tables have a real distribution.
        const [tp] = await tx`
          INSERT INTO touchpoint (person_id, occurred_at, channel, utm_source,
                                  utm_medium, utm_campaign, fbclid,
                                  is_first_touch, created_at)
          VALUES (${p.id}, ${lead}, ${CHANNELS[i % CHANNELS.length]},
                  ${SOURCES[i % SOURCES.length]}, 'paid_social', ${campaign},
                  ${i % 3 === 0 ? `fb.1.${tag}` : null}, true, ${lead})
          RETURNING id`;
        await tx`UPDATE person SET first_touchpoint_id = ${tp.id}
                 WHERE id = ${p.id}`;
        touchpoints += 1;

        // Every third lead comes back on a later touch, so the first-touch
        // and later-touch columns differ.
        if (i % 3 === 1) {
          await tx`
            INSERT INTO touchpoint (person_id, occurred_at, channel,
                                    utm_source, utm_campaign, is_first_touch,
                                    created_at)
            VALUES (${p.id}, ${new Date(lead.getTime() + DAY)}, 'ctwa',
                    ${SOURCES[i % SOURCES.length]}, ${campaign}, false,
                    ${new Date(lead.getTime() + DAY)})`;
          touchpoints += 1;
        }

        // The HRDC share the reference reports: the first `hrdc` signups of
        // each run are grant-funded, the rest pay for themselves.
        const funding = i < hrdc ? "hrdc" : "self";
        const price = COURSES.find((c) => c[0] === course)![5];
        const [d] = await tx`
          INSERT INTO deal (pipeline, stage, person_id, course_id, class_id,
                            amount_myr, funding_type, owner_user_id, won_at,
                            created_at, updated_at)
          VALUES ('individual', 'won', ${p.id}, ${courseId.get(course)!},
                  ${cls.id}, ${price}, ${funding},
                  ${[SEED_USERS.weiPing, SEED_USERS.daphne][i % 2]},
                  ${sold}, ${lead}, ${sold})
          RETURNING id`;
        await tx`
          INSERT INTO deal_stage_history (deal_id, from_stage, to_stage,
                                          changed_at, changed_by, created_by)
          VALUES (${d.id}, 'checkout_sent', 'won', ${sold},
                  ${SEED_USERS.admin}, ${SEED_USERS.admin})`;

        const [e] = await tx`
          INSERT INTO enrolment (person_id, class_id, deal_id, status,
                                 price_paid_myr, completed_at, created_at,
                                 updated_at)
          VALUES (${p.id}, ${cls.id}, ${d.id},
                  ${past ? "completed" : "confirmed"},
                  ${funding === "hrdc" ? null : price},
                  ${past ? new Date(classStart + DAY) : null},
                  ${sold}, ${sold})
          RETURNING id`;
        enrolments += 1;

        // A grant seat is paid by HRDC, not through Stripe — which is why a
        // programme with many of them looks worse on revenue than it is. A
        // manual method needs a reference and a proof key (§9.12), and the
        // proof key is unique (migration 008), so it carries the row's tag.
        if (price !== null)
          await tx`
            INSERT INTO payment (enrolment_id, deal_id, method, status,
                                 amount_myr, reference_no, proof_file_key,
                                 paid_at, created_at)
            VALUES (${e.id}, ${d.id},
                    ${funding === "hrdc" ? "hrdc" : "stripe_card"},
                    'succeeded', ${price},
                    ${funding === "hrdc" ? `HRDC-${tag.toUpperCase()}` : null},
                    ${funding === "hrdc" ? `demo/hrdc/${tag}.pdf` : null},
                    ${sold}, ${sold})`;
      }
    }

    // The spend side. Upserted on (ad_id, day) like the real pull, so
    // re-running the seed is as harmless as re-running the sync.
    let adRows = 0;
    if (await hasAdInsights(tx)) {
      const rows = adInsightRows();
      await tx`
        INSERT INTO meta_ad_insight ${tx(rows)}
        ON CONFLICT (ad_id, day) DO UPDATE SET
          spend = EXCLUDED.spend,
          impressions = EXCLUDED.impressions,
          clicks = EXCLUDED.clicks,
          leads = EXCLUDED.leads,
          objective = EXCLUDED.objective,
          inline_link_clicks = EXCLUDED.inline_link_clicks,
          messages = EXCLUDED.messages,
          checkouts = EXCLUDED.checkouts,
          url_tags = EXCLUDED.url_tags,
          synced_at = now()`;
      adRows = rows.length;
    }

    console.log(
      `Seeded ${COURSES.length} courses, ${RUNS.length} class runs, ` +
        `${people} people, ${enrolments} enrolments, ${touchpoints} touchpoints.`,
    );
    console.log(
      adRows > 0
        ? `Seeded ${adRows} meta_ad_insight rows under ${DEMO_AD_ACCOUNT}.`
        : "meta_ad_insight is not in this database (migration 014); no ad spend seeded.",
    );
  });
}

const mode = process.argv.includes("--clean") ? clean : seed;
await mode();
await sql.end();
