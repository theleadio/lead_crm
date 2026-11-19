// Spec §9.15 Lost reasons / §7.1 / §6: what the lost reason routes answer.
// A route is `getCurrentUser` plus the §6 gate, readIfMatch, the schema, the
// service and one response per result; with no session here, the pieces are
// checked the way the route runs them.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readIfMatch, validationError } from "../lib/api/errors.ts";
import { ROLES, permissionFor } from "../lib/auth/permissions.ts";
import {
  lostReasonReorderResponse,
  lostReasonWriteResponse,
} from "../lib/settings/responses.ts";
import { updateLostReason } from "../lib/settings/lost-reasons.ts";
import { closeDb, db } from "../lib/sql.ts";
import { lostReasonUpdateSchema } from "../lib/validation/lost-reason.ts";
import { it, newUser } from "./seed.ts";

after(closeDb);

test("writes are super_admin only; GET stays open to every deal reader", () => {
  for (const role of ROLES) {
    const viewer = { id: "u", role };
    // POST, PATCH and reorder gate on settings write.
    assert.equal(
      permissionFor(viewer, "settings", "write").allowed,
      role === "super_admin",
      role,
    );
  }
  // GET is unchanged: deal read, so sales still gets the Lost dialog list.
  assert.ok(permissionFor({ id: "u", role: "sales" }, "deal", "read").allowed);
});

test("a PATCH body with a code is a 422", async () => {
  const parsed = lostReasonUpdateSchema.safeParse({ code: "x", labelEn: "X" });
  assert.equal(parsed.success, false);
  const res = validationError(parsed.error!, 422);
  assert.equal(res.status, 422);
});

test("PATCH with neither header is a 428", () => {
  const req = new Request("http://localhost/api/lost-reasons/x", {
    method: "PATCH",
  });
  assert.equal(readIfMatch(req), null);
});

test("each result has one status and code", async () => {
  const cases = [
    [lostReasonWriteResponse({ kind: "not_found" }), 404, "not_found"],
    [lostReasonWriteResponse({ kind: "stale" }), 409, "stale_edit"],
    [lostReasonWriteResponse({ kind: "duplicate_code" }), 409, "duplicate_code"],
    [lostReasonReorderResponse({ kind: "incomplete" }), 422, "incomplete"],
  ] as const;
  for (const [res, status, code] of cases) {
    assert.equal(res.status, status, code);
    assert.equal((await res.json()).error.code, code);
  }
  const dup = await lostReasonWriteResponse({ kind: "duplicate_code" }).json();
  assert.ok(dup.error.fields.code);
  assert.equal(lostReasonReorderResponse({ kind: "ok" }).status, 204);
});

it("PATCH with only X-Row-Version is saved", async () => {
  const admin = await newUser("super_admin");
  const [price] = await db()`SELECT id, version FROM lost_reason WHERE code = 'price'`;
  const req = new Request("http://localhost/api/lost-reasons/x", {
    method: "PATCH",
    headers: { "X-Row-Version": String(price.version) },
  });
  const res = lostReasonWriteResponse(
    await updateLostReason(
      price.id,
      lostReasonUpdateSchema.parse({ labelEn: "Price too high" }),
      readIfMatch(req)!,
      admin,
    ),
  );
  assert.equal(res.status, 200);
  assert.equal((await res.json()).labelEn, "Price too high");
});
