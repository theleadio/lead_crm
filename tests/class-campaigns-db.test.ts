// Linking Meta campaigns to a class (class page, 12 Nov; migration 023).
// Runs on the test DB; each test rolls back.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { PermissionError, type Viewer } from "../lib/auth/permissions.ts";
import {
  classCampaigns,
  linkCampaign,
  unlinkCampaign,
} from "../lib/classes/campaigns.ts";
import { closeDb, db, rollbackAfter } from "../lib/sql.ts";

after(closeDb);

const it = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !process.env.DATABASE_URL && "no DATABASE_URL" }, () =>
    rollbackAfter(fn),
  );

async function newUser(role: Viewer["role"]): Promise<Viewer> {
  const [u] = await db()`
    INSERT INTO app_user (email, full_name, role_code)
    VALUES (${`${crypto.randomUUID()}@lead.test`}, 'Test user', ${role})
    RETURNING id`;
  return { id: u.id, role };
}

async function newClass(code: string, startDays = 10): Promise<string> {
  const [co] = await db()`
    INSERT INTO course (code, name_en, track, duration_days)
    VALUES (${`T-${crypto.randomUUID()}`}, 'Test course', 'workshop', 1)
    RETURNING id`;
  const [c] = await db()`
    INSERT INTO class (course_id, code, start_date, end_date, language, mode,
                       online_url, capacity, status)
    VALUES (${co.id}, ${code}, current_date + ${startDays}::int,
            current_date + ${startDays}::int, 'en', 'online', 'https://x.test', 30, 'open')
    RETURNING id`;
  return c.id;
}

const numericId = () => String(Math.floor(1e14 + Math.random() * 8e14));

// One spend row for a campaign, `daysAgo` days back, as the Meta sync writes it.
async function metaCampaign(
  name: string,
  daysAgo = 1,
  id = numericId(),
): Promise<string> {
  await db()`
    INSERT INTO meta_ad_insight (ad_id, day, account_id, campaign_id, campaign_name,
                                 adset_id, adset_name, ad_name, currency, spend,
                                 impressions, clicks)
    VALUES (${numericId()}, current_date - ${daysAgo}::int, 'act_test', ${id},
            ${name}, 's', 's', 'a', 'MYR', '1.00', 1, 1)`;
  return id;
}

async function auditRows(classId: string) {
  return db()`
    SELECT action, after, before FROM audit_log
    WHERE entity = 'class' AND entity_id = ${classId} ORDER BY created_at, id`;
}

it("marketing links a campaign; it is listed and audited", async () => {
  const user = await newUser("marketing");
  const classId = await newClass(`C-${crypto.randomUUID()}`);
  const campaign = await metaCampaign("LEAD | Nov2026 | Sales | Test 21 Nov");

  assert.deepEqual(await linkCampaign(user, classId, campaign), { ok: true });
  const { linked, choices } = await classCampaigns(classId, user);
  assert.deepEqual(
    linked.map((l) => [l.campaignId, l.name]),
    [[campaign, "LEAD | Nov2026 | Sales | Test 21 Nov"]],
  );
  assert.equal(
    choices.some((c) => c.campaignId === campaign),
    false,
  );
  const [row] = await auditRows(classId);
  assert.equal(row.action, "create");
  assert.equal(row.after.linkedCampaign.id, campaign);
});

it("linking the same campaign again is a no-op", async () => {
  const user = await newUser("operations");
  const classId = await newClass(`C-${crypto.randomUUID()}`);
  const campaign = await metaCampaign("LEAD | Nov2026 | Sales | Test");
  await linkCampaign(user, classId, campaign);
  assert.deepEqual(await linkCampaign(user, classId, campaign), { ok: true });
  assert.equal((await classCampaigns(classId, user)).linked.length, 1);
  assert.equal((await auditRows(classId)).length, 1);
});

it("a campaign already selling another class is refused with that class", async () => {
  const user = await newUser("management");
  const codeA = `C-${crypto.randomUUID()}`;
  const classA = await newClass(codeA);
  const classB = await newClass(`C-${crypto.randomUUID()}`);
  const campaign = await metaCampaign("LEAD | Nov2026 | Sales | Test");
  await linkCampaign(user, classA, campaign);

  assert.deepEqual(await linkCampaign(user, classB, campaign), {
    ok: false,
    reason: "linked_elsewhere",
    classCode: codeA,
  });
  const choice = (await classCampaigns(classB, user)).choices.find(
    (c) => c.campaignId === campaign,
  );
  assert.equal(choice?.linkedTo, codeA);
});

it("an unknown campaign or class is refused", async () => {
  const user = await newUser("super_admin");
  const classId = await newClass(`C-${crypto.randomUUID()}`);
  assert.deepEqual(await linkCampaign(user, classId, numericId()), {
    ok: false,
    reason: "unknown_campaign",
  });
  const campaign = await metaCampaign("LEAD | Nov2026 | Sales | Test");
  assert.deepEqual(
    await linkCampaign(user, "00000000-0000-4000-8000-0000000000ff", campaign),
    { ok: false, reason: "not_found" },
  );
});

it("unlinking removes the link and is audited", async () => {
  const user = await newUser("marketing");
  const classId = await newClass(`C-${crypto.randomUUID()}`);
  const campaign = await metaCampaign("LEAD | Nov2026 | Sales | Test");
  await linkCampaign(user, classId, campaign);

  assert.deepEqual(await unlinkCampaign(user, classId, campaign), {
    ok: true,
    removed: true,
  });
  assert.deepEqual(await unlinkCampaign(user, classId, campaign), {
    ok: true,
    removed: false,
  });
  assert.equal((await classCampaigns(classId, user)).linked.length, 0);
  assert.deepEqual(
    (await auditRows(classId)).map((r) => r.action),
    ["create", "delete"],
  );
});

it("sales can read the links but not change them", async () => {
  const user = await newUser("sales");
  const classId = await newClass(`C-${crypto.randomUUID()}`);
  const campaign = await metaCampaign("LEAD | Nov2026 | Sales | Test");
  await assert.doesNotReject(classCampaigns(classId, user));
  await assert.rejects(linkCampaign(user, classId, campaign), PermissionError);
  await assert.rejects(
    unlinkCampaign(user, classId, campaign),
    PermissionError,
  );
});

it("choices: last 90 days, Meta's latest name, suggested first", async () => {
  const user = await newUser("marketing");
  // Class 10 days out; a campaign naming that day and month is suggested.
  const classId = await newClass(`C-${crypto.randomUUID()}`, 10);
  const [start] = await db()`
    SELECT to_char(start_date, 'YYYY-MM-DD') AS d FROM class WHERE id = ${classId}`;
  const d = new Date(`${start.d}T00:00:00Z`);
  const mon = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ")[
    d.getUTCMonth()
  ];
  const tag = crypto.randomUUID().slice(0, 6);

  const renamed = await metaCampaign(`LEAD | X | Sales | Old ${tag}`, 5);
  await metaCampaign(`LEAD | X | Sales | New ${tag}`, 1, renamed);
  const suggested = await metaCampaign(
    `LEAD | X | Sales | ${tag} ${d.getUTCDate()} ${mon}`,
    30,
  );
  const stale = await metaCampaign(`LEAD | X | Sales | Stale ${tag}`, 120);

  const choices = (await classCampaigns(classId, user)).choices.filter((c) =>
    c.name.includes(tag),
  );
  assert.deepEqual(
    choices.map((c) => [c.campaignId, c.suggested]),
    [
      [suggested, true],
      [renamed, false],
    ],
  );
  assert.equal(choices[1].name, `LEAD | X | Sales | New ${tag}`);
  assert.equal(
    choices.some((c) => c.campaignId === stale),
    false,
  );
});
