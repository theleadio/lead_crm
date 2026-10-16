import { test } from "node:test";
import assert from "node:assert/strict";
import { EVENT_AGGREGATE, EVENT_TYPES } from "../lib/events/types.ts";

// Spec §11.1 order.
test("EVENT_TYPES are the 13 §11.1 names in order", () => {
  assert.deepEqual(
    [...EVENT_TYPES],
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

test("every event has an aggregate type", () => {
  assert.deepEqual(Object.keys(EVENT_AGGREGATE), [...EVENT_TYPES]);
});
