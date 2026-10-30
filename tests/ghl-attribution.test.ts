import assert from "node:assert/strict";
import { test } from "node:test";
import { mapContact } from "../lib/import/ghl-attribution.ts";

const base = { id: "C1", dateAdded: "2026-10-20T03:00:00.000Z" };

test("a Meta record keeps ids, click id and a cleaned URL, and drops the personal fields", () => {
  const m = mapContact({
    ...base,
    attributions: [
      {
        isFirst: true,
        medium: "facebook",
        utmCampaign: "LEAD | Oct2026 | Sales | Claude EN 1 Nov",
        utmCampaignId: "6878812432797",
        utmAdId: "120210000000001",
        utmFbclid: "IwAR123",
        url: "https://ai.thelead.io/en/workshop/x?utm_source=fb&email=a%40b.com&fbclid=IwAR123#frag",
        referrer: "https://l.facebook.com/?token=secret",
        // @ts-expect-error not part of the type on purpose: must never be kept
        ip: "1.2.3.4",
        fbp: "fb.1.x",
      },
    ],
  });
  assert.equal(m.rows.length, 1);
  const r = m.rows[0];
  assert.equal(r.external_ref, "ghl-attr:first:C1");
  assert.equal(r.utm_source, "facebook");
  assert.equal(r.utm_campaign_id, "6878812432797");
  assert.equal(r.utm_ad_id, "120210000000001");
  assert.equal(r.fbclid, "IwAR123");
  assert.equal(
    r.landing_url,
    "https://ai.thelead.io/en/workshop/x?utm_source=fb&fbclid=IwAR123",
  );
  assert.equal(r.referrer, "https://l.facebook.com/");
  assert.ok(!JSON.stringify(r).includes("1.2.3.4"));
  assert.ok(!JSON.stringify(r).includes("fb.1.x"));
  assert.equal(r.occurred_at.toISOString(), base.dateAdded);
});

test("'Paid Social' alone proves nothing: no evidence, no row; a real utmSource is kept as is", () => {
  const none = mapContact({
    ...base,
    attributions: [{ isFirst: true, medium: "form" }],
  });
  assert.equal(none.rows.length, 0);
  assert.equal(none.noEvidence, 1);
  const tiktok = mapContact({
    ...base,
    attributions: [
      { isFirst: true, utmCampaign: "tt_launch", utmSource: "TikTok" },
    ],
  });
  assert.equal(tiktok.rows[0].utm_source, "tiktok");
  const unknown = mapContact({
    ...base,
    attributions: [{ isFirst: true, utmCampaign: "broad", medium: "form" }],
  });
  assert.equal(unknown.rows[0].utm_source, null);
});

test("an unfilled {{placeholder}} is dropped and counted; a numeric campaign id in the name field is kept", () => {
  const m = mapContact({
    ...base,
    attributions: [
      { isFirst: true, utmCampaign: "{{campaign.name}}", utmAdId: "99" },
    ],
  });
  assert.equal(m.rows[0].utm_campaign, null);
  assert.equal(m.rows[0].utm_ad_id, "99");
  assert.equal(m.placeholders, 1);
  const n = mapContact({
    ...base,
    attributions: [{ isFirst: true, utmCampaign: "6896591113197" }],
  });
  assert.equal(n.rows[0].utm_campaign, "6896591113197");
});

test("first and latest that differ become two rows; identical ones become one", () => {
  const two = mapContact({
    ...base,
    attributions: [
      { isFirst: true, utmCampaign: "A", medium: "facebook" },
      { isLast: true, utmCampaign: "B", medium: "facebook" },
    ],
  });
  assert.deepEqual(
    two.rows.map((r) => r.external_ref),
    ["ghl-attr:first:C1", "ghl-attr:last:C1"],
  );
  const same = mapContact({
    ...base,
    attributions: [
      { isFirst: true, utmCampaign: "A" },
      { isLast: true, utmCampaign: "A" },
    ],
  });
  assert.equal(same.rows.length, 1);
});

test("a contact with no usable dateAdded keeps nothing", () => {
  const m = mapContact({
    id: "C2",
    attributions: [{ isFirst: true, utmCampaign: "A" }],
  });
  assert.equal(m.noDate, true);
  assert.equal(m.rows.length, 0);
});
