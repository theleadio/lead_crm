// SalesProcess opportunity import (lib/import/ghl-opportunities.ts): pure
// mapping, then the load against the CRM schema. DB tests are rolled back.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  courseCodeFor,
  importOpportunities,
  mapStage,
  type GhlOpportunity,
  type GhlPipeline,
} from "../lib/import/ghl-opportunities.ts";
import { closeDb, db } from "../lib/sql.ts";
import { it, newClass, newPerson } from "./seed.ts";

after(closeDb);

test("stage: by SalesProcess stage name; status won/lost wins over the stage", () => {
  assert.deepEqual(mapStage("New Lead (Opt-in)", "open"), { stage: "new" });
  assert.deepEqual(mapStage("Contact Attempted", "open"), {
    stage: "new",
    tag: "contact_attempted",
  });
  assert.deepEqual(mapStage("Engaged / Qualifying", "open"), {
    stage: "engaged",
  });
  assert.deepEqual(mapStage("Proposal / Quote Sent", "open"), {
    stage: "qualified",
  });
  assert.deepEqual(mapStage("Pending Payment / HRDF", "open"), {
    stage: "checkout_sent",
  });
  assert.deepEqual(mapStage("Closed Won", "open"), { stage: "won" });
  assert.deepEqual(mapStage("Closed Lost", "open"), { stage: "lost" });
  assert.deepEqual(mapStage("Engaged / Qualifying", "won"), { stage: "won" });
  assert.deepEqual(mapStage("New Lead (Opt-in)", "abandoned"), {
    stage: "lost",
  });
  assert.equal(mapStage("Something New", "open"), null);
});

test("course: from the pipeline's programme code", () => {
  assert.equal(
    courseCodeFor("AIA8 - Sales Pipeline"),
    "lms-ai-agentic-automation-certification",
  );
  assert.equal(
    courseCodeFor("AIEC - Sales Pipeline"),
    "lms-professional-ai-engineering-certification",
  );
  assert.equal(
    courseCodeFor("AIVC - Sales Pipeline"),
    "lms-ai-full-stack-building-certification",
  );
  assert.equal(
    courseCodeFor("AIDA - Sales Pipeline"),
    "lms-ai-for-data-science-certification",
  );
  assert.equal(courseCodeFor("Other Pipeline"), null);
});

// ---- the load ---------------------------------------------------------------

const PIPELINES: GhlPipeline[] = [
  {
    id: "P-AIEC",
    name: "AIEC - Sales Pipeline",
    stages: [
      { id: "S-new", name: "New Lead (Opt-in)" },
      { id: "S-try", name: "Contact Attempted" },
      { id: "S-eng", name: "Engaged / Qualifying" },
      { id: "S-lost", name: "Closed Lost" },
      { id: "S-odd", name: "Something New" },
    ],
  },
];

async function setup() {
  // The AIEC course, with one class on 17 Oct 2026.
  const [c] = await db()`
    INSERT INTO course (code, name_en, track, duration_days, list_price_myr)
    VALUES ('lms-professional-ai-engineering-certification', 'Professional AI Engineering', 'certification', 2, 3200)
    ON CONFLICT (code) DO UPDATE SET name_en = EXCLUDED.name_en
    RETURNING id`;
  const classId = await newClass({ courseId: c.id });
  await db()`UPDATE class SET start_date = '2026-10-17', end_date = '2026-10-18' WHERE id = ${classId}`;
  const owner = await db()`
    INSERT INTO app_user (email, full_name, role_code)
    VALUES (${`Sales-${crypto.randomUUID().slice(0, 6)}@lead.test`}, 'Sales person', 'sales')
    RETURNING id, email`;
  return { courseId: c.id as string, classId, owner: owner[0] };
}

// A person the contacts import made: it holds the 'ghl:<contact id>' touchpoint.
async function imported(contactId: string): Promise<string> {
  const p = await newPerson(`Imported ${contactId}`);
  await db()`
    INSERT INTO touchpoint (person_id, channel, form_name, external_ref, occurred_at)
    VALUES (${p}, 'import', 'ghl-export', ${`ghl:${contactId}`}, '2026-09-01')`;
  return p;
}

const opp = (o: Partial<GhlOpportunity>): GhlOpportunity => ({
  id: `O-${crypto.randomUUID().slice(0, 8)}`,
  name: "Someone",
  monetaryValue: 0,
  pipelineId: "P-AIEC",
  pipelineStageId: "S-new",
  status: "open",
  source: "Facebook",
  contactId: "C-x",
  createdAt: "2026-10-01T02:00:00.000Z",
  lastStageChangeAt: "2026-10-02T02:00:00.000Z",
  ...o,
});

it("one deal per opportunity: stage, course, class, amount, owner, source and dates", async () => {
  const s = await setup();
  const person = await imported("C-1");
  const o = opp({
    contactId: "C-1",
    pipelineStageId: "S-try",
    monetaryValue: 3200,
    assignedTo: "U-1",
    source:
      "Professional AI Engineering (English) | 17-18 Oct | AI365 Hub, Oval Damansara",
  });
  const outboxBefore = (
    await db()`SELECT count(*)::int AS n FROM event_outbox`
  )[0].n;

  const stats = await importOpportunities({
    opportunities: [o],
    pipelines: PIPELINES,
    users: [{ id: "U-1", email: s.owner.email.toUpperCase() }],
  });
  assert.equal(stats["new deal"], 1);

  const [d] =
    await db()`SELECT * FROM deal WHERE external_ref = ${`ghl-opp:${o.id}`}`;
  assert.equal(d.pipeline, "individual");
  assert.equal(d.stage, "new");
  assert.equal(d.person_id, person);
  assert.equal(d.course_id, s.courseId);
  assert.equal(
    d.class_id,
    s.classId,
    "class from the source text, existing class only",
  );
  assert.equal(d.amount_myr, "3200.00");
  assert.equal(d.owner_user_id, s.owner.id, "owner by email, any case");
  assert.equal(d.created_at.toISOString(), "2026-10-01T02:00:00.000Z");
  assert.equal(d.stage_changed_at.toISOString(), "2026-10-02T02:00:00.000Z");
  const [t] =
    await db()`SELECT channel, form_name FROM touchpoint WHERE id = ${d.source_touchpoint_id}`;
  assert.deepEqual(
    { ...t },
    {
      channel: "import",
      form_name:
        "Professional AI Engineering (English) | 17-18 Oct | AI365 Hub, Oval Damansara",
    },
  );
  const h =
    await db()`SELECT from_stage, to_stage FROM deal_stage_history WHERE deal_id = ${d.id}`;
  assert.deepEqual(
    h.map((r) => [r.from_stage, r.to_stage]),
    [[null, "new"]],
  );
  const tags = await db()`
    SELECT t.name FROM person_tag pt JOIN tag t ON t.id = pt.tag_id WHERE pt.person_id = ${person}`;
  assert.deepEqual(
    tags.map((r) => r.name),
    ["contact_attempted"],
  );
  assert.equal(
    (await db()`SELECT count(*)::int AS n FROM event_outbox`)[0].n,
    outboxBefore,
    "an import fires no events",
  );
});

it("skips: not imported yet, unknown stage, an open CRM deal for the course; a re-run adds nothing", async () => {
  const s = await setup();
  const busy = await imported("C-busy");
  await db()`INSERT INTO deal (pipeline, stage, person_id, course_id) VALUES ('individual', 'engaged', ${busy}, ${s.courseId})`;
  await imported("C-ok");
  await imported("C-lost");
  const opps = [
    opp({ contactId: "C-missing" }),
    opp({ contactId: "C-ok", pipelineStageId: "S-odd" }),
    opp({ contactId: "C-busy" }),
    opp({ contactId: "C-ok", pipelineStageId: "S-eng", source: "Facebook" }),
    opp({
      contactId: "C-lost",
      pipelineStageId: "S-lost",
      lastStatusChangeAt: "2026-10-05T00:00:00.000Z",
    }),
  ];
  const input = { opportunities: opps, pipelines: PIPELINES, users: [] };

  const first = await importOpportunities(input);
  assert.equal(first["new deal"], 2);
  assert.equal(first["skip: contact not imported yet"], 1);
  assert.equal(first["skip: unknown stage Something New"], 1);
  assert.equal(first["skip: open CRM deal for this course"], 1);

  const [lost] = await db()`
    SELECT d.stage, d.lost_at, r.code FROM deal d JOIN lost_reason r ON r.id = d.lost_reason_id
    WHERE d.external_ref = ${`ghl-opp:${opps[4].id}`}`;
  assert.equal(lost.code, "imported_unknown");
  assert.equal(lost.lost_at.toISOString(), "2026-10-05T00:00:00.000Z");
  const [eng] =
    await db()`SELECT class_id FROM deal WHERE external_ref = ${`ghl-opp:${opps[3].id}`}`;
  assert.equal(eng.class_id, null, "no date in the text: no class");

  const again = await importOpportunities(input);
  assert.equal(again["new deal"] ?? 0, 0);
  assert.equal(again["skip: already imported"], 2);
});

it("a deactivated user does not become the owner", async () => {
  const s = await setup();
  await db()`UPDATE app_user SET is_active = false WHERE id = ${s.owner.id}`;
  await imported("C-off");
  const o = opp({ contactId: "C-off", assignedTo: "U-off" });
  await importOpportunities({
    opportunities: [o],
    pipelines: PIPELINES,
    users: [{ id: "U-off", email: s.owner.email }],
  });
  const [d] =
    await db()`SELECT owner_user_id FROM deal WHERE external_ref = ${`ghl-opp:${o.id}`}`;
  assert.equal(d.owner_user_id, null);
});
