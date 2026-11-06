// Which CRM seats the LMS sync (scripts/sync-lms.ts) lets an LMS enrollment
// adopt: import seats, refunded ones included, and active seats staff added by
// hand. Seats that already carry an LMS id, and inactive hand seats, are not.
import { after } from "node:test";
import assert from "node:assert/strict";
import { seatsToAdopt } from "../lib/import/lms-adopt.ts";
import { closeDb, db } from "../lib/sql.ts";
import { enrol, it, newClass } from "./seed.ts";

after(closeDb);

it("adopts import seats and active hand seats, not LMS seats or inactive hand seats", async () => {
  const classId = await newClass({ capacity: 10 });
  const importSeat = await enrol(classId, "confirmed");
  const importRefunded = await enrol(classId, "refunded");
  const hand = await enrol(classId, "confirmed", { payerType: "company" });
  const handOnboarded = await enrol(classId, "onboarded");
  const handCancelled = await enrol(classId, "cancelled");
  const lmsSeat = await enrol(classId, "confirmed");
  const mine = [importSeat, importRefunded, hand, handOnboarded, handCancelled, lmsSeat];

  const got = (await seatsToAdopt(db(), [importSeat, importRefunded], [lmsSeat]))
    .map((s) => s.id)
    .filter((id) => mine.includes(id));

  assert.deepEqual(got.sort(), [importSeat, importRefunded, hand, handOnboarded].sort());
});

it("with no import and no LMS ids, every active seat is a candidate", async () => {
  const classId = await newClass({ capacity: 10 });
  const hand = await enrol(classId, "confirmed");
  const got = (await seatsToAdopt(db(), [], [])).map((s) => s.id);
  assert.ok(got.includes(hand));
});
