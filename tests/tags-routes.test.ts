// Spec §9.15 Tags / §7.1 / §6: what PATCH /api/tags/:id and POST
// /api/tags/:id/merge answer. With no session here, the route's pieces are
// checked the way the route runs them.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { forbidden, readIfMatch } from "../lib/api/errors.ts";
import { permissionFor } from "../lib/auth/permissions.ts";
import {
  tagMergeResponse,
  tagWriteResponse,
} from "../lib/settings/responses.ts";
import { updateTag } from "../lib/settings/tags.ts";
import { closeDb, db } from "../lib/sql.ts";
import { tagUpdateSchema } from "../lib/validation/tag.ts";
import { it, newUser } from "./seed.ts";

after(closeDb);

test("support can't change tags; sales still reads them", () => {
  assert.equal(
    permissionFor({ id: "u", role: "support" }, "settings", "write").allowed,
    false,
  );
  // GET /api/tags is unchanged: person read.
  assert.ok(permissionFor({ id: "u", role: "sales" }, "person", "read").allowed);
});

it("403 for support writes a permission_denied row", async () => {
  const support = await newUser("support");
  const req = new Request("http://localhost/api/tags/abc", { method: "PATCH" });
  const res = await forbidden(support, req, {
    what: "change tags",
    resource: "tag",
  });
  assert.equal(res.status, 403);
  const [row] = await db()`
    SELECT entity FROM audit_log
    WHERE user_id = ${support.id} AND action = 'permission_denied'`;
  assert.equal(row.entity, "tag");
});

test("system_tag is a 422 from both routes; duplicate_name names the tag", async () => {
  for (const res of [
    tagWriteResponse({ kind: "system_tag" }),
    tagMergeResponse({ kind: "system_tag" }),
  ]) {
    assert.equal(res.status, 422);
    assert.equal((await res.json()).error.code, "system_tag");
  }
  const dup = tagWriteResponse({
    kind: "duplicate_name",
    existing: { id: "t1", name: "VIP" },
  });
  assert.equal(dup.status, 409);
  const body = await dup.json();
  assert.equal(body.error.code, "duplicate_name");
  assert.deepEqual(body.error.existingTag, { id: "t1", name: "VIP" });
  assert.equal(tagMergeResponse({ kind: "bad_target" }).status, 422);
  assert.equal(tagWriteResponse({ kind: "stale" }).status, 409);
});

test("PATCH with neither header is a 428", () => {
  assert.equal(
    readIfMatch(new Request("http://localhost/api/tags/x", { method: "PATCH" })),
    null,
  );
});

it("PATCH with only X-Row-Version is saved", async () => {
  const admin = await newUser("super_admin");
  const [tag] = await db()`
    INSERT INTO tag (name) VALUES (${`t-${crypto.randomUUID()}`}) RETURNING id`;
  const req = new Request("http://localhost/api/tags/x", {
    method: "PATCH",
    headers: { "X-Row-Version": "1" },
  });
  const res = tagWriteResponse(
    await updateTag(
      tag.id,
      tagUpdateSchema.parse({ name: "Renamed on the live site" }),
      readIfMatch(req)!,
      admin,
    ),
  );
  assert.equal(res.status, 200);
  assert.equal((await res.json()).name, "Renamed on the live site");
});
