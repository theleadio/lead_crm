// lib/lms/read.ts: the LMS enrolment read returns the joined shape and
// filters by email. Reads only, so it is safe against a database that holds
// the real LMS rows.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import {
  closeLms,
  listLmsEnrollments,
  lmsHrdcEnrollmentIds,
} from "../lib/lms/read.ts";

after(closeLms);

const it = (name: string, fn: () => Promise<void>) =>
  test(
    name,
    { skip: !process.env.LMS_DATABASE_URL && "no LMS_DATABASE_URL" },
    fn,
  );

it("lists enrolments with participant, cohort and course joined", async () => {
  const rows = await listLmsEnrollments({ limit: 5 });
  assert.ok(rows.length > 0 && rows.length <= 5);
  assert.ok(rows[0].courseName);
  assert.ok(rows[0].participantId);
});

it("filters by email, case-insensitively", async () => {
  const [first] = await listLmsEnrollments({ limit: 1 });
  const found = await listLmsEnrollments({
    email: ` ${first.email!.toUpperCase()} `,
  });
  assert.ok(found.length > 0);
  assert.ok(
    found.every((r) => r.email?.toLowerCase() === first.email!.toLowerCase()),
  );
  assert.equal(
    (await listLmsEnrollments({ email: "nobody@invalid.test" })).length,
    0,
  );
});

it("lists the HRDC enrolment ids, which are uuids", async () => {
  const ids = await lmsHrdcEnrollmentIds();
  assert.ok(ids.length > 0);
  assert.ok(ids.every((id) => /^[0-9a-f-]{36}$/.test(id)));
});
