// saveCtwaTouch against a real database: person matching, idempotency and the
// first-touch rule. Each test rolls back. Skipped when DATABASE_URL isn't set.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { saveCtwaTouch, type CtwaReferral } from "../lib/import/wati-ctwa.ts";
import { closeDb, db, rollbackAfter } from "../lib/sql.ts";

after(closeDb);

const it = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !process.env.DATABASE_URL && "no DATABASE_URL" }, () =>
    rollbackAfter(fn),
  );

// A Malaysian mobile no seed uses; random tail so tests never collide.
const waId = () => `6011${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
const r = (clid: string | null, adId = "52508930802001"): CtwaReferral => ({
  adId,
  ctwaClid: clid,
  headline: null,
  url: "https://fb.me/x",
});
const AT = new Date("2031-03-10T02:00:00Z");

it("a new number becomes a person with a first-touch ctwa touchpoint", async () => {
  const wa = waId();
  const res = await saveCtwaTouch(wa, "Ada", r("clid-1"), AT);
  assert.equal(res.kind, "saved");
  assert.ok(res.kind === "saved" && res.firstTouch && res.newPerson);
  const [t] = await db()`
    SELECT t.channel, t.utm_source, t.utm_ad_id, t.utm_content, t.ctwa_clid,
           t.is_first_touch, p.first_touchpoint_id = t.id AS linked, p.full_name
    FROM touchpoint t JOIN person p ON p.id = t.person_id
    WHERE p.phone_e164 = ${`+${wa}`}`;
  assert.deepEqual(
    { ...t },
    {
      channel: "ctwa",
      utm_source: "facebook",
      utm_ad_id: "52508930802001",
      utm_content: "52508930802001",
      ctwa_clid: "clid-1",
      is_first_touch: true,
      linked: true,
      full_name: "Ada",
    },
  );
});

it("the same click again adds nothing", async () => {
  const wa = waId();
  await saveCtwaTouch(wa, "Ada", r("clid-2"), AT);
  assert.equal((await saveCtwaTouch(wa, "Ada", r("clid-2"), AT)).kind, "exists");
  const [{ n }] = await db()`
    SELECT count(*)::int n FROM touchpoint t JOIN person p ON p.id = t.person_id
    WHERE p.phone_e164 = ${`+${wa}`}`;
  assert.equal(n, 1);
});

it("a known person's later ad click is not a first touch", async () => {
  const wa = waId();
  await saveCtwaTouch(wa, "Ada", r("clid-3"), AT);
  const res = await saveCtwaTouch(wa, "Ada", r("clid-4", "52509437936001"), new Date(AT.getTime() + 86_400_000));
  assert.ok(res.kind === "saved" && !res.firstTouch && !res.newPerson);
});

it("matches an existing person by phone and never renames them", async () => {
  const wa = waId();
  const [p] = await db()`
    INSERT INTO person (full_name, phone, phone_e164)
    VALUES ('Existing Name', ${`+${wa}`}, ${`+${wa}`}) RETURNING id`;
  const res = await saveCtwaTouch(wa, "WhatsApp Name", r("clid-5"), AT);
  assert.ok(res.kind === "saved" && !res.newPerson && res.firstTouch);
  const [q] = await db()`SELECT full_name FROM person WHERE id = ${p.id}`;
  assert.equal(q.full_name, "Existing Name");
});

it("a referral without a click id is kept once per ad per day", async () => {
  const wa = waId();
  assert.equal((await saveCtwaTouch(wa, null, r(null), AT)).kind, "saved");
  assert.equal((await saveCtwaTouch(wa, null, r(null), new Date(AT.getTime() + 3_600_000))).kind, "exists");
});

it("skips a number that is not a phone", async () => {
  assert.deepEqual(await saveCtwaTouch("abc", null, r("clid-6"), AT), {
    kind: "skipped",
    reason: "no usable phone",
  });
});
