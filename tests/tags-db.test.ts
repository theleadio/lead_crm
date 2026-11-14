// Spec §9.15 Tags against the database: system tags are read-only, renames
// clash case-insensitively, deactivation keeps people tagged, and a merge
// moves people once, deactivates the source and audits the count (design 8).
// Rolled back. Skipped without DATABASE_URL.
import { after } from "node:test";
import assert from "node:assert/strict";
import { listTagOptions } from "../lib/people/service.ts";
import { listAllTags, mergeTag, updateTag } from "../lib/settings/tags.ts";
import { closeDb, db } from "../lib/sql.ts";
import { it, newPerson, newUser } from "./seed.ts";

after(closeDb);

async function newTag(
  name: string,
  opts: { system?: boolean; active?: boolean } = {},
): Promise<string> {
  const [t] = await db()`
    INSERT INTO tag (name, is_system, is_active)
    VALUES (${name}, ${opts.system ?? false}, ${opts.active ?? true})
    RETURNING id`;
  return t.id as string;
}

async function tagPeople(tagId: string, people: string[]) {
  for (const p of people)
    await db()`INSERT INTO person_tag (person_id, tag_id) VALUES (${p}, ${tagId})`;
}

const people = async (n: number) =>
  Promise.all(Array.from({ length: n }, (_, i) => newPerson(`P${i}`)));

const countOn = async (tagId: string) =>
  Number(
    (await db()`SELECT count(*) AS n FROM person_tag WHERE tag_id = ${tagId}`)[0]
      .n,
  );

const name = `t-${crypto.randomUUID().slice(0, 8)}`;

it("list: every tag with system flag, active flag and person count", async () => {
  const id = await newTag(`${name} old`, { active: false });
  await tagPeople(id, await people(2));
  const row = (await listAllTags()).find((t) => t.id === id)!;
  assert.equal(row.isActive, false);
  assert.equal(row.isSystem, false);
  assert.equal(row.personCount, 2);
  assert.equal(row.version, 1);
});

it("update: a system tag can't be renamed or deactivated", async () => {
  const admin = await newUser("super_admin");
  const id = await newTag(`[source] ${name}`, { system: true });
  assert.equal(
    (await updateTag(id, { name: "renamed" }, 1, admin)).kind,
    "system_tag",
  );
  assert.equal(
    (await updateTag(id, { isActive: false }, 1, admin)).kind,
    "system_tag",
  );
  const [t] = await db()`SELECT name, is_active FROM tag WHERE id = ${id}`;
  assert.equal(t.name, `[source] ${name}`);
  assert.equal(t.is_active, true);
});

it("update: a name that differs only in case is duplicate_name", async () => {
  const admin = await newUser("super_admin");
  const vip = await newTag(`${name} VIP`);
  const other = await newTag(`${name} vip2`);
  const r = await updateTag(other, { name: `${name} vip` }, 1, admin);
  assert.equal(r.kind, "duplicate_name");
  assert.deepEqual(r.kind === "duplicate_name" && r.existing, {
    id: vip,
    name: `${name} VIP`,
  });
});

it("update: rename writes old and new name; a stale version is refused", async () => {
  const admin = await newUser("super_admin");
  const id = await newTag(`${name} fb`);
  const r = await updateTag(id, { name: `${name} Facebook` }, 1, admin);
  assert.equal(r.kind === "ok" && r.tag.name, `${name} Facebook`);
  const [row] = await db()`
    SELECT before, after FROM audit_log
    WHERE entity = 'tag' AND entity_id = ${id} AND action = 'update'`;
  assert.deepEqual(row.before, { name: `${name} fb` });
  assert.deepEqual(row.after, { name: `${name} Facebook` });
  assert.equal(
    (await updateTag(id, { name: "x" }, 1, admin)).kind,
    "stale",
  );
  assert.equal(
    (await updateTag(crypto.randomUUID(), { name: "x" }, 1, admin)).kind,
    "not_found",
  );
});

it("update: a deactivated tag leaves the pickers, people keep it", async () => {
  const admin = await newUser("super_admin");
  const id = await newTag(`${name} roadshow`);
  await tagPeople(id, await people(3));
  assert.equal(
    (await updateTag(id, { isActive: false }, 1, admin)).kind,
    "ok",
  );
  assert.equal(
    (await listTagOptions()).some((t) => t.id === id),
    false,
  );
  assert.equal(await countOn(id), 3);
});

it("merge: 30 + 50 with 10 shared ends at 70, source emptied and off, audit says 30", async () => {
  const admin = await newUser("super_admin");
  const source = await newTag(`${name} vip`);
  const into = await newTag(`${name} VIP2`);
  const all = await people(70);
  await tagPeople(source, all.slice(0, 30));
  await tagPeople(into, all.slice(20, 70));
  const r = await mergeTag(source, into, admin);
  // "Moved" counts the people taken off the source (spec: 30), not the
  // 20 rows the target gained.
  assert.deepEqual(r, { kind: "ok", moved: 30 });
  assert.equal(await countOn(into), 70);
  assert.equal(await countOn(source), 0);
  const [t] = await db()`SELECT is_active FROM tag WHERE id = ${source}`;
  assert.equal(t.is_active, false);
  const [row] = await db()`
    SELECT user_id, after FROM audit_log
    WHERE entity = 'tag' AND entity_id = ${source} AND action = 'update'`;
  assert.equal(row.user_id, admin.id);
  assert.deepEqual(row.after, { mergedInto: into, moved: 30 });
});

it("merge: refuses itself, an inactive or unknown target, and a system source", async () => {
  const admin = await newUser("super_admin");
  const source = await newTag(`${name} a`);
  const off = await newTag(`${name} off`, { active: false });
  const system = await newTag(`[source] ${name}`, { system: true });
  await tagPeople(source, await people(2));
  for (const into of [source, off, crypto.randomUUID()])
    assert.equal((await mergeTag(source, into, admin)).kind, "bad_target");
  assert.equal((await mergeTag(system, source, admin)).kind, "system_tag");
  assert.equal(
    (await mergeTag(crypto.randomUUID(), source, admin)).kind,
    "not_found",
  );
  assert.equal(await countOn(source), 2);
});

it("merge: an active system tag is allowed as the target", async () => {
  const admin = await newUser("super_admin");
  const source = await newTag(`${name} fb lead`);
  const system = await newTag(`[source] ${name}`, { system: true });
  await tagPeople(source, await people(2));
  assert.deepEqual(await mergeTag(source, system, admin), {
    kind: "ok",
    moved: 2,
  });
  assert.equal(await countOn(system), 2);
});
