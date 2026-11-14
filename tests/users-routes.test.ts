// Spec §9.15 Users / §7 / §6: what GET /api/users and PATCH /api/users/:id
// answer. A route is `getCurrentUser` plus the §6 gate, readIfMatch, the
// schema, the service and one response per result; with no session here,
// those pieces are checked one by one, the way the route runs them. 401 is
// the route's first line (no viewer → 401) and has no piece of its own.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { forbidden, readIfMatch } from "../lib/api/errors.ts";
import { versionHeaders } from "../lib/api/version-headers.ts";
import { ROLES, permissionFor, type Viewer } from "../lib/auth/permissions.ts";
import { closeDb, db } from "../lib/sql.ts";
import { userWriteResponse } from "../lib/users/responses.ts";
import { updateUser } from "../lib/users/service.ts";
import { userUpdateSchema } from "../lib/validation/user.ts";
import { it, newUser } from "./seed.ts";

after(closeDb);

const patch = (headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/users/abc", { method: "PATCH", headers });

test("§6 settings row: only super_admin manages users", () => {
  for (const role of ROLES)
    for (const action of ["read", "write"] as const)
      assert.equal(
        permissionFor({ id: "u", role }, "settings", action).allowed,
        role === "super_admin",
        `${role} ${action}`,
      );
});

test("PATCH: neither If-Match nor X-Row-Version is a 428", () => {
  assert.equal(readIfMatch(patch()), null);
  assert.equal(readIfMatch(patch({ "X-Row-Version": "abc" })), null);
  // What the live site sends: If-Match dropped, X-Row-Version kept.
  assert.equal(readIfMatch(patch({ "X-Row-Version": "4" })), 4);
  assert.equal(readIfMatch(patch(versionHeaders(5))), 5);
});

test("each write result has one status and code", async () => {
  const cases = [
    [{ kind: "not_found" }, 404, "not_found"],
    [{ kind: "stale" }, 409, "stale_edit"],
    [{ kind: "self_change" }, 422, "self_change"],
    [{ kind: "last_super_admin" }, 422, "last_super_admin"],
  ] as const;
  for (const [result, status, code] of cases) {
    const res = userWriteResponse(result);
    assert.equal(res.status, status, result.kind);
    assert.equal((await res.json()).error.code, code, result.kind);
  }
});

it("403 for sales writes a permission_denied row", async () => {
  const sales = await newUser("sales");
  const req = new Request("http://localhost/api/users", { method: "GET" });
  // The route: permissionFor(viewer, "settings", "read"), else forbidden().
  assert.equal(permissionFor(sales, "settings", "read").allowed, false);
  const res = await forbidden(sales, req, { what: "users", resource: "app_user" });
  assert.equal(res.status, 403);
  const rows = await db()`
    SELECT entity, after FROM audit_log
    WHERE user_id = ${sales.id} AND action = 'permission_denied'`;
  assert.deepEqual(
    rows.map((r) => [r.entity, r.after]),
    [["app_user", { route: "/api/users", method: "GET" }]],
  );
});

it("PATCH with only X-Row-Version is saved", async () => {
  const admin: Viewer = await newUser("super_admin");
  const target = await newUser("sales");
  const req = patch({ "X-Row-Version": "1" });
  const version = readIfMatch(req);
  assert.equal(version, 1);
  const body = userUpdateSchema.parse({ roleCode: "support" });
  const res = userWriteResponse(
    await updateUser(target.id, body, version!, admin),
  );
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.roleCode, "support");
  assert.equal(json.version, 2);
});
