// Source naming, the "why no source" rules, and the cookie carrying utm_id /
// utm_ad_id and the whole first touch. No database.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attributionPayload,
  parseTouch,
  serialiseTouch,
  touchFrom,
} from "../app/(public)/attribution.ts";
import { noSourceReason } from "../lib/attribution/no-source.ts";
import { normalizeSource, resolveSource } from "../lib/attribution/source.ts";
import { attributionSchema } from "../lib/validation/public.ts";

test("known spellings fold to one source name, others are kept", () => {
  for (const raw of ["fb_ad", "FB", " Facebook ", "m.facebook.com"])
    assert.equal(normalizeSource(raw), "facebook", raw);
  for (const raw of ["ig", "Instagram"])
    assert.equal(normalizeSource(raw), "instagram", raw);
  assert.equal(normalizeSource("newsletter"), "newsletter");
  assert.equal(normalizeSource("self:referral"), "self:referral");
  assert.equal(normalizeSource("  "), null);
  assert.equal(normalizeSource(null), null);
});

test("a click id names the source when the link lost its utm_source", () => {
  assert.equal(resolveSource({ fbclid: "abc" }), "facebook");
  assert.equal(resolveSource({ gclid: "abc" }), "google");
  assert.equal(resolveSource({ utmSource: "ig", fbclid: "abc" }), "instagram");
  assert.equal(resolveSource({}), null);
});

const ADS_URL =
  "https://lead.test/register/demo-class?utm_source=facebook&utm_medium=paid" +
  "&utm_campaign=Demo%20Campaign&utm_id=120000000001&utm_content=120000000002" +
  "&utm_term=120000000003";

test("the standard ad URL parameter set survives the cookie and the payload", () => {
  const t = touchFrom(ADS_URL, null, new Date("2026-11-10T02:00:00.000Z"));
  assert.equal(t.utmId, "120000000001");
  assert.equal(t.utmContent, "120000000002");
  assert.equal(t.utmTerm, "120000000003");
  assert.match(t.landingUrl ?? "", /utm_id=120000000001/);
  assert.deepEqual(parseTouch(serialiseTouch(t)), t);

  const payload = attributionPayload(t, t)!;
  assert.equal(payload.utmId, "120000000001");
  const parsed = attributionSchema.parse(payload);
  assert.equal(parsed.utmId, "120000000001");
});

test("utm_ad_id is read and kept in the landing URL", () => {
  const t = touchFrom("https://lead.test/?utm_ad_id=555&fbclid=f1", null);
  assert.equal(t.utmAdId, "555");
  assert.match(t.landingUrl ?? "", /utm_ad_id=555/);
});

test("the first touch keeps the ad id, ad set and click id, not just the campaign", () => {
  const first = touchFrom(ADS_URL + "&fbclid=f1", null);
  const last = touchFrom("https://lead.test/enquiry?utm_source=google", null);
  const a = attributionPayload(first, last)!;
  const parsed = attributionSchema.parse(a);
  assert.equal(parsed.firstTouch?.utmContent, "120000000002");
  assert.equal(parsed.firstTouch?.utmTerm, "120000000003");
  assert.equal(parsed.firstTouch?.utmId, "120000000001");
  assert.equal(parsed.firstTouch?.fbclid, "f1");
  assert.match(parsed.firstTouch?.landingUrl ?? "", /register\/demo-class/);
});

test("why a signup has no source", () => {
  const base = {
    touches: 0,
    informativeBefore: 0,
    informativeAfter: 0,
    sheetSourceAfter: false,
  };
  assert.equal(
    noSourceReason({ ...base, touches: 2, informativeBefore: 1 }),
    "has_source",
  );
  assert.equal(noSourceReason(base), "no_touchpoints");
  assert.equal(noSourceReason({ ...base, touches: 1 }), "bare_import_only");
  assert.equal(
    noSourceReason({ ...base, touches: 2, informativeAfter: 1 }),
    "source_after_signup",
  );
  assert.equal(
    noSourceReason({
      ...base,
      touches: 2,
      informativeAfter: 1,
      sheetSourceAfter: true,
    }),
    "sheet_source_dated_late",
  );
});
