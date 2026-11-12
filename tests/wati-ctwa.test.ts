// referralOf / ctwaRef / sentAt: the pure part of the WATI CTWA sync. The
// payload shape is WATI's getMessages item, as read on 11 Nov 2026.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ctwaRef, referralOf, sentAt } from "../lib/import/wati-ctwa.ts";

const ref = {
  headline: "Chat with us",
  body: "ad text",
  url: "https://fb.me/abc",
  sourceId: "52508930802001",
  media: null,
  lastSourceId: null,
  lastSourceUrl: null,
  ctwaClid: "AfjD9bsZGXvF-click",
};

test("reads Meta's referral from a customer message", () => {
  assert.deepEqual(referralOf({ owner: false, messageReferral: ref }), {
    adId: "52508930802001",
    ctwaClid: "AfjD9bsZGXvF-click",
    headline: "Chat with us",
    url: "https://fb.me/abc",
  });
});

test("accepts the referral as a JSON string", () => {
  const r = referralOf({ owner: false, messageReferral: JSON.stringify(ref) });
  assert.equal(r?.adId, "52508930802001");
});

test("ignores our own messages, no referral, and an empty referral", () => {
  assert.equal(referralOf({ owner: true, messageReferral: ref }), null);
  assert.equal(referralOf({ owner: false }), null);
  assert.equal(
    referralOf({ owner: false, messageReferral: { sourceId: null, ctwaClid: "" } }),
    null,
  );
  assert.equal(referralOf({ owner: false, messageReferral: "{not json" }), null);
});

test("keys on the click id, else ad id and day", () => {
  const at = new Date("2026-11-11T04:24:31Z");
  assert.equal(ctwaRef(referralOf({ messageReferral: ref })!, at), "wati:clid:AfjD9bsZGXvF-click");
  assert.equal(
    ctwaRef({ adId: "1", ctwaClid: null, headline: null, url: null }, at),
    "wati:ad:1:2026-11-11",
  );
});

test("message time from seconds, milliseconds or the created date", () => {
  assert.equal(sentAt({ timestamp: "1794371069" })?.toISOString(), "2026-11-11T04:24:29.000Z");
  assert.equal(sentAt({ timestamp: 1794371069000 })?.toISOString(), "2026-11-11T04:24:29.000Z");
  assert.equal(sentAt({ created: "2026-11-11T04:24:31.579Z" })?.toISOString(), "2026-11-11T04:24:31.579Z");
  assert.equal(sentAt({}), null);
});
