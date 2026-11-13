// Integration tests for the §9.0 Home panels against the seeded dev
// database. Each test rolls back. Skipped when DATABASE_URL isn't set.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { PermissionError, type Viewer } from "../lib/auth/permissions.ts";
import {
  myOpenDeals,
  myTasks,
  needsAttention,
  upcomingClasses,
} from "../lib/home/service.ts";
import { setWorkshopGoal, upcomingWorkshops } from "../lib/home/workshops.ts";
import { parseWorkshopForm } from "../lib/import/ghl-forms.ts";
import { listClasses } from "../lib/classes/service.ts";
import { classListQuerySchema } from "../lib/validation/class-query.ts";
import { closeDb, db, rollbackAfter } from "../lib/sql.ts";

after(closeDb);

const it = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !process.env.DATABASE_URL && "no DATABASE_URL" }, () =>
    rollbackAfter(fn),
  );

// A user created inside the rolled-back transaction owns nothing yet, so
// every count a test asserts is only what that test inserted.
async function newUser(role: Viewer["role"]): Promise<Viewer> {
  const [u] = await db()`
    INSERT INTO app_user (email, full_name, role_code)
    VALUES (${`${crypto.randomUUID()}@lead.test`}, 'Test user', ${role})
    RETURNING id`;
  return { id: u.id, role };
}

async function newPerson(
  fields: {
    needsReview?: boolean;
    deleted?: boolean;
    mergedInto?: string;
  } = {},
): Promise<string> {
  const [p] = await db()`
    INSERT INTO person (full_name, needs_review, needs_review_reason,
                        deleted_at, merged_into_id)
    VALUES ('Test person', ${fields.needsReview ?? false},
            ${fields.needsReview ? "possible_duplicate_phone" : null},
            ${fields.deleted ? db()`now()` : null}, ${fields.mergedInto ?? null})
    RETURNING id`;
  return p.id;
}

async function newCourse(): Promise<string> {
  const [c] = await db()`
    INSERT INTO course (code, name_en, track, duration_days)
    VALUES (${`T-${crypto.randomUUID()}`}, 'Test course', 'workshop', 1)
    RETURNING id`;
  return c.id;
}

// `days` from today in Kuala Lumpur, which is what §9.0's window counts in.
async function newClass(
  course: string,
  days: number,
  opts: { capacity?: number; status?: string; endDays?: number } = {},
): Promise<string> {
  const [c] = await db()`
    INSERT INTO class (course_id, code, start_date, end_date, language, mode,
                       online_url, capacity, status)
    VALUES (${course}, ${`C-${crypto.randomUUID()}`},
            (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date + ${days}::int,
            (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date + ${opts.endDays ?? days}::int,
            'en', 'online', 'https://example.test/class',
            ${opts.capacity ?? 20}, ${opts.status ?? "open"})
    RETURNING id`;
  return c.id;
}

async function enrol(
  classId: string,
  status: string,
  reservedUntil: "past" | "future" | null = null,
): Promise<void> {
  await db()`
    INSERT INTO enrolment (person_id, class_id, status, seat_reserved_until)
    VALUES (${await newPerson()}, ${classId}, ${status},
            ${
              reservedUntil === "past"
                ? db()`now() - interval '1 hour'`
                : reservedUntil === "future"
                  ? db()`now() + interval '1 day'`
                  : null
            })`;
}

async function newTask(
  user: Viewer,
  dueHours: number | null,
  opts: { done?: boolean; assignee?: string; person?: string } = {},
): Promise<string> {
  const [t] = await db()`
    INSERT INTO task (type, title, assigned_user_id, person_id, due_at,
                      done_at, done_by)
    VALUES ('call', 'Test task', ${opts.assignee ?? user.id},
            ${opts.person ?? null},
            ${dueHours === null ? null : db()`now() + make_interval(hours => ${dueHours})`},
            ${opts.done ? db()`now()` : null}, ${opts.done ? user.id : null})
    RETURNING id`;
  return t.id;
}

async function newDeal(
  owner: Viewer,
  stage: string,
  amount: string,
  pipeline: "individual" | "corporate" = "individual",
): Promise<void> {
  await db()`
    INSERT INTO deal (pipeline, stage, person_id, owner_user_id, amount_myr,
                      won_at, lost_at, lost_reason_id)
    VALUES (${pipeline}, ${stage}, ${await newPerson()}, ${owner.id}, ${amount},
            ${stage === "won" ? db()`now()` : null},
            ${stage === "lost" ? db()`now()` : null},
            ${stage === "lost" ? db()`(SELECT id FROM lost_reason WHERE is_active LIMIT 1)` : null})`;
}

// --- tasks -----------------------------------------------------------------

it("overdue first, then today; nothing else", async () => {
  const user = await newUser("sales");
  await newTask(user, -48); // two days late
  await newTask(user, -2); // two hours late
  await newTask(user, 2); // later today or tomorrow
  await newTask(user, null); // undated
  await newTask(user, 24 * 7); // next week
  await newTask(user, -24, { done: true }); // completed
  await newTask(user, -24, { assignee: (await newUser("sales")).id }); // someone else's

  const { tasks, overdueCount } = await myTasks(user);

  assert.equal(overdueCount, 2);
  assert.equal(tasks[0].isOverdue, true);
  assert.equal(tasks[1].isOverdue, true);
  // The +2h task only counts when it still lands inside today in KL.
  assert.ok(tasks.length === 2 || (tasks.length === 3 && !tasks[2].isOverdue));
  assert.ok(new Date(tasks[0].dueAt) < new Date(tasks[1].dueAt));
});

it("a task row links to the record it hangs off", async () => {
  const user = await newUser("support");
  const person = await newPerson();
  await newTask(user, -1, { person });

  const { tasks } = await myTasks(user);
  assert.equal(tasks[0].href, `/people/${person}`);
  assert.equal(tasks[0].who, "Test person");
});

it("a part-timer is asked only for their own tasks", async () => {
  const partTimer = await newUser("part_time");
  const other = await newUser("sales");
  await newTask(other, -3);
  await newTask(partTimer, -1);

  const { tasks } = await myTasks(partTimer);
  assert.equal(tasks.length, 1);
});

// --- deals -----------------------------------------------------------------

it("totals cover every owned deal, won and lost excluded", async () => {
  const user = await newUser("sales");
  for (let i = 0; i < 30; i++) await newDeal(user, "new", "100.50");
  await newDeal(user, "engaged", "1000.00");
  await newDeal(user, "won", "9000.00");
  await newDeal(user, "lost", "4000.00");
  await newDeal(user, "discovery", "500.00", "corporate");

  const [individual, corporate] = await myOpenDeals(user);

  assert.equal(individual.pipeline, "individual");
  assert.equal(individual.openCount, 31);
  assert.equal(individual.openTotalMyr, "4015.00");
  assert.ok(!individual.stages.some((s) => ["won", "lost"].includes(s.stage)));
  assert.deepEqual(
    individual.stages.map((s) => s.stage),
    ["new", "engaged", "qualified", "checkout_sent"],
  );
  assert.equal(corporate.openCount, 1);
  assert.equal(corporate.openTotalMyr, "500.00");
});

it("a colleague's deal is not in my totals", async () => {
  const me = await newUser("sales");
  const colleague = await newUser("sales");
  await newDeal(colleague, "engaged", "7000.00");

  const [individual] = await myOpenDeals(me);
  assert.equal(individual.openCount, 0);
  assert.equal(individual.openTotalMyr, "0.00");
});

// --- classes ---------------------------------------------------------------

it("the window is today to 14 days, cancelled and started excluded", async () => {
  const user = await newUser("operations");
  const course = await newCourse();
  const today = await newClass(course, 0);
  const edge = await newClass(course, 14);
  await newClass(course, 15);
  await newClass(course, -7, { endDays: 7 });
  await newClass(course, 3, { status: "cancelled" });

  const found = (await upcomingClasses(user)).filter(
    (c) => c.courseName === "Test course",
  );
  assert.deepEqual(
    found.map((c) => c.id),
    [today, edge],
  );
});

it("seats sold follows §12.1", async () => {
  const user = await newUser("operations");
  const course = await newCourse();
  const classId = await newClass(course, 2, { capacity: 20 });
  for (const status of ["confirmed", "confirmed", "onboarded", "attended"])
    await enrol(classId, status);
  await enrol(classId, "reserved", "future");
  await enrol(classId, "reserved", "past"); // expired: frees its seat
  await enrol(classId, "waitlisted");
  await enrol(classId, "cancelled");
  await enrol(classId, "refunded");

  const found = (await upcomingClasses(user)).find((c) => c.id === classId);
  assert.equal(found?.sold, 5);
  assert.equal(found?.capacity, 20);
});

// --- needs attention -------------------------------------------------------

it("flagged people count; deleted and merged ones do not", async () => {
  const user = await newUser("sales");
  const before = (await needsAttention(user)).needsReview ?? 0;
  const survivor = await newPerson();
  await newPerson({ needsReview: true });
  await newPerson({ needsReview: true, deleted: true });
  await newPerson({ needsReview: true, mergedInto: survivor });

  assert.equal((await needsAttention(user)).needsReview, before + 1);
});

// §9.0: a row per item, each gated on its own permission. Operations approves
// notices (§9.10) and only reads people, so it sees one count and not the other.
it("each needs-attention item is counted only for the roles that can act", async () => {
  const ops = await newUser("operations");
  const sales = await newUser("sales");
  const classId = await newClass(await newCourse(), 7);
  const before = (await needsAttention(ops)).pendingNotices ?? 0;
  await db()`
    INSERT INTO class_notice (class_id, changed_fields, recipient_count)
    VALUES (${classId}, ${db().json({ startDate: { from: "2026-10-06", to: "2026-10-13" } })}, 3)`;

  const forOps = await needsAttention(ops);
  assert.equal(forOps.pendingNotices, before + 1);
  assert.equal(forOps.needsReview, null);

  const forSales = await needsAttention(sales);
  assert.equal(forSales.pendingNotices, null);
  assert.equal(typeof forSales.needsReview, "number");
});

// --- permissions -----------------------------------------------------------

it("§6 decides which panels a role may read", async () => {
  const partTimer = await newUser("part_time");
  const management = await newUser("management");
  const marketing = await newUser("marketing");

  await assert.rejects(() => myOpenDeals(partTimer), PermissionError);
  await assert.rejects(() => needsAttention(partTimer), PermissionError);
  // Read-only on people: no queue to work through (§6).
  await assert.rejects(() => needsAttention(management), PermissionError);
  // Marketing reads deals and writes tasks, so both panels load.
  await myOpenDeals(marketing);
  await myTasks(marketing);
  await upcomingClasses(partTimer);
});

// §9.0: the count and the link must agree. The panel sends Operations to the
// §9.8 list filtered to pending notices, and that list is upcoming by
// default — so a notice left on a class that has already run is in neither.
it("the pending-notice count matches the list its link opens", async () => {
  const ops = await newUser("operations");
  const course = await newCourse();
  const upcoming = await newClass(course, 7);
  const ran = await newClass(course, -30, { endDays: -29 });
  const before = (await needsAttention(ops)).pendingNotices ?? 0;

  const sql = db();
  const fields = sql.json({ venueName: { from: "A", to: "B" } });
  await sql`
    INSERT INTO class_notice (class_id, changed_fields, recipient_count)
    VALUES (${upcoming}, ${fields}, 3), (${ran}, ${fields}, 2)`;

  // Two pending notices exist, but only the upcoming one is counted.
  assert.equal((await needsAttention(ops)).pendingNotices, before + 1);

  const listed = (
    await listClasses(
      classListQuerySchema.parse({ pendingNotice: "true", limit: 100 }),
      ops,
    )
  ).data;
  assert.equal(
    listed.some((c) => c.id === upcoming),
    true,
  );
  assert.equal(
    listed.some((c) => c.id === ran),
    false,
  );
});

// Opt-ins on the class cards (Home, 12 Nov): people whose click-to-WhatsApp
// chat came from a Meta campaign linked to the class (migration 023).
const numericId = () => String(Math.floor(Math.random() * 1e15));

async function linkCampaign(classId: string): Promise<string> {
  const campaign = numericId();
  await db()`
    INSERT INTO class_meta_campaign (class_id, meta_campaign_id, campaign_name)
    VALUES (${classId}, ${campaign}, 'LEAD | Nov2026 | WhatsApp | Test')`;
  return campaign;
}

// One ad in the campaign, as the daily Meta sync stores it, and one ctwa
// touch through that ad for the person.
async function optIn(
  campaign: string,
  person: string,
  at: Date = new Date(),
): Promise<void> {
  const ad = numericId();
  await db()`
    INSERT INTO meta_ad_insight (ad_id, day, account_id, campaign_id, campaign_name,
                                 adset_id, adset_name, ad_name, currency, spend,
                                 impressions, clicks)
    VALUES (${ad}, (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date, 'act_test',
            ${campaign}, 'LEAD | Nov2026 | WhatsApp | Test', 'set1', 'Set 1',
            'Ad', 'MYR', '1.00', 10, 1)`;
  await db()`
    INSERT INTO touchpoint (person_id, channel, utm_ad_id, occurred_at)
    VALUES (${person}, 'ctwa', ${ad}, ${at})`;
}

it("opt-ins count people on the class's linked campaigns", async () => {
  const user = await newUser("operations");
  const classId = await newClass(await newCourse(), 3);
  const campaign = await linkCampaign(classId);
  await optIn(campaign, await newPerson());
  await optIn(campaign, await newPerson());

  const found = (await upcomingClasses(user)).find((c) => c.id === classId);
  assert.deepEqual(found?.optins, { linkedCampaigns: 1, people: 2 });
});

it("counts a returning chatter once", async () => {
  const user = await newUser("operations");
  const classId = await newClass(await newCourse(), 3);
  const first = await linkCampaign(classId);
  const second = await linkCampaign(classId);
  const person = await newPerson();
  await optIn(first, person);
  await optIn(first, person);
  await optIn(second, person);

  const found = (await upcomingClasses(user)).find((c) => c.id === classId);
  assert.deepEqual(found?.optins, { linkedCampaigns: 2, people: 1 });
});

it("counts a person only where their first WhatsApp chat came from", async () => {
  // Same rule as the ads report's Opt-ins: a contact who first chatted from
  // another campaign is a returning chat here, not an opt-in.
  const user = await newUser("operations");
  const classId = await newClass(await newCourse(), 3);
  const linked = await linkCampaign(classId);
  const elsewhere = numericId();
  const person = await newPerson();
  await optIn(elsewhere, person, new Date(Date.now() - 864e5));
  await optIn(linked, person);

  const found = (await upcomingClasses(user)).find((c) => c.id === classId);
  assert.deepEqual(found?.optins, { linkedCampaigns: 1, people: 0 });
});

it("ignores another class's campaign and deleted people", async () => {
  const user = await newUser("operations");
  const course = await newCourse();
  const classA = await newClass(course, 3);
  const classB = await newClass(course, 4);
  const campaignA = await linkCampaign(classA);
  const campaignB = await linkCampaign(classB);
  await optIn(campaignB, await newPerson());
  await optIn(campaignA, await newPerson({ deleted: true }));

  const found = (await upcomingClasses(user)).find((c) => c.id === classA);
  assert.deepEqual(found?.optins, { linkedCampaigns: 1, people: 0 });
});

it("a class with no campaign linked", async () => {
  const user = await newUser("operations");
  const classId = await newClass(await newCourse(), 3);

  const found = (await upcomingClasses(user)).find((c) => c.id === classId);
  assert.deepEqual(found?.optins, { linkedCampaigns: 0, people: 0 });
});

it("part_time sees no opt-ins", async () => {
  const user = await newUser("part_time");
  const classId = await newClass(await newCourse(), 3);
  await optIn(await linkCampaign(classId), await newPerson());

  const found = (await upcomingClasses(user)).find((c) => c.id === classId);
  assert.ok(found, "part_time still sees the class");
  assert.equal(found.optins, null);
});

// Free workshops (Home, 12 Nov): registrations are GHL form submissions,
// imported by ghl:forms as touchpoints named after the form.
const MON = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

// A registration form name for a workshop `days` from today in Kuala Lumpur.
function workshopForm(
  title: string,
  days: number,
  spelling: { prefix?: string; dash?: boolean } = {},
): string {
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
  });
  const at = new Date(Date.parse(`${today}T00:00:00Z`) + days * 864e5);
  return `${spelling.prefix ?? ".02"} LEAD - ${title}${spelling.dash ? " -" : ""} ${at.getUTCDate()} ${MON[at.getUTCMonth()]} ${at.getUTCFullYear()}`;
}

async function signUp(form: string, person: string): Promise<void> {
  await db()`
    INSERT INTO touchpoint (person_id, channel, form_name, external_ref)
    VALUES (${person}, 'import', ${form}, ${`ghl-form:${crypto.randomUUID()}`})`;
}

const uniqueTitle = () => `Test Workshop ${crypto.randomUUID().slice(0, 8)}`;

it("two forms for one workshop make one card; a person on both counts once", async () => {
  const user = await newUser("marketing");
  const title = uniqueTitle();
  const first = workshopForm(title, 5);
  const second = workshopForm(title.toLowerCase(), 5, {
    prefix: ".05",
    dash: true,
  });
  const [a, b, c] = [await newPerson(), await newPerson(), await newPerson()];
  await signUp(first, a);
  await signUp(first, b);
  await signUp(second, b);
  await signUp(second, c);

  const found = (await upcomingWorkshops(user)).filter(
    (w) => w.title.toLowerCase() === title.toLowerCase(),
  );
  assert.equal(found.length, 1);
  assert.equal(found[0].signups, 3);
  assert.equal(found[0].forms, 2);
  assert.equal(found[0].language, "en");
});

// After the GHL switch-off (14 Dec) workshop ads send people to the CRM's
// own form (POST /api/public/leads, formName named like the GHL form), which
// records a web_form touchpoint. Those count too, merged with GHL ones.
it("a CRM web form registration counts, merged with the GHL form", async () => {
  const user = await newUser("marketing");
  const title = uniqueTitle();
  const form = workshopForm(title, 6);
  const [a, b] = [await newPerson(), await newPerson()];
  await signUp(form, a);
  await db()`
    INSERT INTO touchpoint (person_id, channel, form_name, utm_source)
    VALUES (${b}, 'web_form', ${workshopForm(title, 6, { prefix: "" })}, 'tiktok')`;
  await db()`
    INSERT INTO touchpoint (person_id, channel, form_name)
    VALUES (${a}, 'web_form', ${form})`;
  await db()`
    INSERT INTO touchpoint (person_id, channel, form_name)
    VALUES (${await newPerson()}, 'web_form', 'enquiry')`;

  const found = (await upcomingWorkshops(user)).filter(
    (w) => w.title === title,
  );
  assert.equal(found.length, 1);
  assert.equal(found[0].signups, 2);
});

it("a lead campaign without a registration no longer counts", async () => {
  const user = await newUser("marketing");
  const title = uniqueTitle();
  await db()`
    INSERT INTO touchpoint (person_id, channel, utm_campaign, form_name)
    VALUES (${await newPerson()}, 'import',
            ${`LEAD | Nov2026 | Lead | ${title} EN 20 Nov`}, 'ghl-attribution')`;
  const titles = (await upcomingWorkshops(user)).map((w) => w.title);
  assert.equal(titles.includes(title), false);
});

it("skips interest forms, deleted people and workshops past 14 days", async () => {
  const user = await newUser("marketing");
  const paid = uniqueTitle();
  const far = uniqueTitle();
  const near = uniqueTitle();
  await signUp(`.03 LEAD - EN - ${paid} Interest Form`, await newPerson());
  await signUp(workshopForm(far, 15), await newPerson());
  await signUp(workshopForm(near, 14), await newPerson({ deleted: true }));
  await signUp(workshopForm(near, 14), await newPerson());

  const titles = (await upcomingWorkshops(user)).map((w) => w.title);
  assert.equal(titles.includes(paid), false);
  assert.equal(titles.includes(far), false);
  const shown = (await upcomingWorkshops(user)).find((w) => w.title === near);
  assert.equal(shown?.signups, 1);
});

it("part_time is refused the free workshops", async () => {
  const user = await newUser("part_time");
  await assert.rejects(upcomingWorkshops(user), PermissionError);
});

// Sign-up goals on the Free workshops cards (Zixuan, 12 Nov): app_setting
// rows, set by super_admin, management, marketing and operations.
async function upcomingOne(user: Viewer, title: string) {
  return (await upcomingWorkshops(user)).find(
    (w) => w.title.toLowerCase() === title.toLowerCase(),
  );
}

async function workshopKey(title: string, days: number) {
  const name = workshopForm(title, days);
  await signUp(name, await newPerson());
  const parsed = parseWorkshopForm(name);
  assert.ok(parsed);
  return parsed;
}

it("a workshop has no goal until someone sets one", async () => {
  const user = await newUser("marketing");
  const title = uniqueTitle();
  await workshopKey(title, 4);
  const w = await upcomingOne(user, title);
  assert.equal(w?.goal, null);
  assert.equal(w?.goalVersion, null);
});

it("marketing sets a goal and Home shows it, whatever the title's case", async () => {
  const user = await newUser("marketing");
  const title = uniqueTitle();
  const key = await workshopKey(title, 4);
  const saved = await setWorkshopGoal(user, {
    ...key,
    title: key.title.toUpperCase(),
    goal: 120,
    version: null,
  });
  assert.deepEqual(saved, { ok: true, goal: 120, version: 1 });
  const w = await upcomingOne(user, title);
  assert.equal(w?.goal, 120);
  assert.equal(w?.goalVersion, 1);
});

it("a stale goal edit is refused, a current one moves the version", async () => {
  const user = await newUser("operations");
  const key = await workshopKey(uniqueTitle(), 4);
  await setWorkshopGoal(user, { ...key, goal: 50, version: null });
  assert.deepEqual(
    await setWorkshopGoal(user, { ...key, goal: 60, version: null }),
    { ok: false, reason: "conflict" },
  );
  assert.deepEqual(
    await setWorkshopGoal(user, { ...key, goal: 60, version: 1 }),
    {
      ok: true,
      goal: 60,
      version: 2,
    },
  );
});

it("every goal change is audited", async () => {
  const user = await newUser("management");
  const key = await workshopKey(uniqueTitle(), 4);
  await setWorkshopGoal(user, { ...key, goal: 80, version: null });
  const [row] = await db()`
    SELECT action, before, after FROM audit_log
    WHERE user_id = ${user.id} AND entity = 'workshop_goal'`;
  assert.equal(row?.action, "create");
  assert.equal(row?.after.goal, 80);
});

it("sales may not set a goal", async () => {
  const user = await newUser("sales");
  const key = await workshopKey(uniqueTitle(), 4);
  await assert.rejects(
    setWorkshopGoal(user, { ...key, goal: 10, version: null }),
    PermissionError,
  );
});
