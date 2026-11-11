// §9.13 convert to deal (lib/enquiries/convert.ts): one transaction opens the
// deal, closes the enquiry as converted and linked, writes history and audit,
// and raises EnquiryConverted. Each test is rolled back.
import { after } from "node:test";
import assert from "node:assert/strict";
import { createEnquiry } from "../lib/enquiries/create.ts";
import { convertEnquiry } from "../lib/enquiries/convert.ts";
import { closeDb, db } from "../lib/sql.ts";
import { it, newPerson, newUser } from "./seed.ts";

after(closeDb);

async function enquiry(category = "price") {
  const r = await createEnquiry(
    {
      personId: await newPerson("Convert Customer"),
      channel: "whatsapp",
      category,
      subject: "How much is AIM?",
    },
    null,
    new Set(),
  );
  if (r.kind !== "ok") throw new Error(r.kind);
  return r.enquiry.id;
}

const versionOf = async (id: string) =>
  Number((await db()`SELECT version FROM enquiry WHERE id = ${id}`)[0].version);

it("converting opens a deal for the person and closes the enquiry as converted", async () => {
  const sales = await newUser("sales");
  // Sales reads enquiries by role; writing this one comes from the team.
  await db()`
    INSERT INTO team_member (team_id, user_id)
    SELECT id, ${sales.id} FROM team WHERE code = 'sales'`;
  const id = await enquiry();
  const r = await convertEnquiry(
    id,
    { pipeline: "individual" },
    await versionOf(id),
    sales,
  );
  assert.equal(r.kind, "ok");
  if (r.kind !== "ok") return;
  assert.equal(r.enquiry.status, "converted");
  assert.equal(r.enquiry.dealId, r.dealId);
  const [d] = await db()`
    SELECT d.pipeline, d.stage, d.owner_user_id, d.person_id = e.person_id AS same_person
    FROM deal d JOIN enquiry e ON e.deal_id = d.id WHERE e.id = ${id}`;
  assert.deepEqual(
    [d.pipeline, d.stage, d.owner_user_id, d.same_person],
    ["individual", "new", sales.id, true],
  );
  const [e] = await db()`
    SELECT closed_at, handled_by FROM enquiry WHERE id = ${id}`;
  assert.ok(e.closed_at);
  assert.equal(e.handled_by, "user");
  const [ev] = await db()`
    SELECT type, aggregate_type, aggregate_id, payload FROM event_outbox
    WHERE type = 'EnquiryConverted' AND aggregate_id = ${id}`;
  assert.deepEqual(ev.payload, { enquiryId: id, dealId: r.dealId });
  assert.equal(ev.aggregate_type, "enquiry");
  const [hist] = await db()`
    SELECT after FROM enquiry_event WHERE enquiry_id = ${id} AND kind = 'status'`;
  assert.equal(hist.after.status, "converted");
});

it("a stale version, a closed enquiry, or a role without deal write is refused and opens no deal", async () => {
  const support = await newUser("support");
  const id = await enquiry("other");
  const deals = async () =>
    (
      await db()`SELECT count(*)::int AS n FROM deal WHERE created_by = ${support.id}`
    )[0].n;
  assert.equal(
    (
      await convertEnquiry(
        id,
        { pipeline: "individual" },
        (await versionOf(id)) + 1,
        support,
      )
    ).kind,
    "stale",
  );
  // Operations reads enquiries but has no deal write (§6).
  const ops = await newUser("operations");
  assert.equal(
    (
      await convertEnquiry(
        id,
        { pipeline: "individual" },
        await versionOf(id),
        ops,
      )
    ).kind,
    "forbidden",
  );
  await db()`UPDATE enquiry SET status = 'closed', closed_at = now(), resolution = 'x' WHERE id = ${id}`;
  assert.equal(
    (
      await convertEnquiry(
        id,
        { pipeline: "individual" },
        await versionOf(id),
        support,
      )
    ).kind,
    "not_open",
  );
  assert.equal(await deals(), 0);
});

it("a deal the deal rules refuse rolls the whole convert back", async () => {
  const support = await newUser("support");
  const id = await enquiry("other");
  const v = await versionOf(id);
  const r = await convertEnquiry(
    id,
    { pipeline: "individual", courseId: crypto.randomUUID() },
    v,
    support,
  );
  assert.equal(r.kind, "invalid");
  const [e] =
    await db()`SELECT status, deal_id, version FROM enquiry WHERE id = ${id}`;
  assert.deepEqual([e.status, e.deal_id, Number(e.version)], ["open", null, v]);
});
