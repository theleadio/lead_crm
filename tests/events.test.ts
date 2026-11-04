import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EVENT_AGGREGATE,
  EVENT_TYPES,
  INTERNAL_EVENT_TYPES,
  SPEC_EVENT_TYPES,
} from "../lib/events/types.ts";

// Spec §11.1 order.
test("SPEC_EVENT_TYPES are the 13 §11.1 names in order", () => {
  assert.deepEqual(
    [...SPEC_EVENT_TYPES],
    [
      "LeadCaptured",
      "DealStageChanged",
      "EnrolmentCreated",
      "EnrolmentConfirmed",
      "EnrolmentCancelled",
      "EnrolmentTransferred",
      "PaymentRecorded",
      "ClassChanged",
      "ClassNoticeApproved",
      "ClassCancelled",
      "ClassPublished",
      "EnquiryConverted",
      "ConsentChanged",
    ],
  );
});

test("EVENT_TYPES are the §11.1 names, then the internal LMS hand-off ones", () => {
  assert.deepEqual(
    [...EVENT_TYPES],
    [...SPEC_EVENT_TYPES, ...INTERNAL_EVENT_TYPES],
  );
  assert.deepEqual(
    [...INTERNAL_EVENT_TYPES],
    ["LmsNotice", "LmsAccountReady", "PersonContactChanged"],
  );
});

test("every event has an aggregate type", () => {
  assert.deepEqual(Object.keys(EVENT_AGGREGATE), [...EVENT_TYPES]);
});
