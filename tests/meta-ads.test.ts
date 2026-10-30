import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchInsights, fetchUrlTags, mapInsight } from "../lib/ads/meta.ts";

const raw = (over: Record<string, unknown> = {}) => ({
  account_id: "111",
  campaign_id: "c1",
  campaign_name: "agentic_202610_leads_en",
  adset_id: "s1",
  adset_name: "KL 25-45",
  ad_id: "a1",
  ad_name: "Video 1",
  account_currency: "MYR",
  date_start: "2026-10-28",
  spend: "12.34",
  impressions: "1000",
  clicks: "25",
  actions: [
    { action_type: "link_click", value: "20" },
    { action_type: "lead", value: "3" },
  ],
  ...over,
});

test("mapInsight reads strings, picks the lead action", () => {
  const r = mapInsight(raw());
  assert.equal(r.spend, "12.34");
  assert.equal(r.impressions, 1000);
  assert.equal(r.clicks, 25);
  assert.equal(r.leads, 3);
  assert.equal(r.day, "2026-10-28");
});

test("mapInsight: no actions and no clicks means zeros, not NaN", () => {
  const r = mapInsight(raw({ actions: undefined, clicks: undefined }));
  assert.equal(r.leads, 0);
  assert.equal(r.clicks, 0);
});

test("fetchInsights follows paging.next, sends the token as a header", async () => {
  process.env.META_ACCESS_TOKEN = "tok";
  process.env.META_AD_ACCOUNT_ID = "111";
  const seen: { url: string; auth: string | null }[] = [];
  const pages = [
    { data: [raw()], paging: { next: "https://graph.facebook.com/page2" } },
    { data: [raw({ ad_id: "a2" })] },
  ];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    seen.push({
      url,
      auth: new Headers(init?.headers).get("authorization"),
    });
    return new Response(JSON.stringify(pages.shift()), { status: 200 });
  }) as typeof fetch;
  const rows = await fetchInsights({
    days: 7,
    now: new Date("2026-10-29T00:00:00Z"),
    fetchImpl,
  });
  assert.deepEqual(
    rows.map((r) => r.adId),
    ["a1", "a2"],
  );
  assert.match(seen[0].url, /act_111\/insights/);
  assert.ok(!seen[0].url.includes("tok"));
  assert.equal(seen[0].auth, "Bearer tok");
  assert.match(decodeURIComponent(seen[0].url), /"since":"2026-10-23"/);
});

test("fetchInsights throws Meta's error message", async () => {
  process.env.META_ACCESS_TOKEN = "tok";
  process.env.META_AD_ACCOUNT_ID = "act_111";
  const fetchImpl = (async () =>
    new Response(
      JSON.stringify({ error: { message: "Invalid OAuth token", code: 190 } }),
      { status: 400 },
    )) as typeof fetch;
  await assert.rejects(
    fetchInsights({ days: 1, fetchImpl }),
    /Invalid OAuth token.*190/,
  );
});

test("mapInsight reads objective as-is, messages, checkouts, inline_link_clicks", () => {
  const r = mapInsight(
    raw({
      objective: "OUTCOME_SALES",
      inline_link_clicks: "18",
      actions: [
        { action_type: "link_click", value: "20" },
        {
          action_type: "onsite_conversion.messaging_conversation_started_7d",
          value: "4",
        },
        {
          action_type: "offsite_conversion.fb_pixel_initiate_checkout",
          value: "2",
        },
        { action_type: "offsite_conversion.fb_pixel_purchase", value: "9" },
        { action_type: "lead", value: "3" },
      ],
    }),
  );
  assert.equal(r.objective, "OUTCOME_SALES");
  assert.equal(r.messages, 4);
  assert.equal(r.checkouts, 2);
  assert.equal(r.inlineLinkClicks, 18);
  assert.equal(r.leads, 3);
  assert.equal(r.clicks, 25);
  assert.equal(r.urlTags, null);
});

test("mapInsight: missing or zero new fields mean 0 and null objective, not NaN", () => {
  for (const over of [{ actions: undefined }, { actions: [], objective: "" }]) {
    const r = mapInsight(raw(over));
    assert.equal(r.objective, null);
    assert.equal(r.messages, 0);
    assert.equal(r.checkouts, 0);
    assert.equal(r.inlineLinkClicks, 0);
    assert.equal(r.urlTags, null);
  }
});

test("fetchInsights asks Meta for objective and inline_link_clicks", async () => {
  process.env.META_ACCESS_TOKEN = "tok";
  process.env.META_AD_ACCOUNT_ID = "111";
  let url = "";
  const fetchImpl = (async (u: string) => {
    url = u;
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  }) as typeof fetch;
  await fetchInsights({ days: 1, fetchImpl });
  const fields = new URL(url).searchParams.get("fields")?.split(",");
  assert.ok(fields?.includes("objective"));
  assert.ok(fields?.includes("inline_link_clicks"));
});

test("fetchUrlTags pages, token only in the header, maps null for missing", async () => {
  process.env.META_ACCESS_TOKEN = "tok";
  process.env.META_AD_ACCOUNT_ID = "111";
  const seen: { url: string; auth: string | null }[] = [];
  const pages = [
    {
      data: [
        {
          id: "a1",
          creative: { url_tags: "utm_source=facebook&utm_campaign=x" },
        },
        { id: "a2" },
      ],
      paging: { next: "https://graph.facebook.com/page2" },
    },
    {
      data: [
        { id: "a3", creative: { url_tags: "" } },
        { id: "a4", creative: { id: "9" } },
      ],
    },
  ];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    seen.push({ url, auth: new Headers(init?.headers).get("authorization") });
    return new Response(JSON.stringify(pages.shift()), { status: 200 });
  }) as typeof fetch;
  const m = await fetchUrlTags({ fetchImpl });
  assert.deepEqual(
    [...m],
    [
      ["a1", "utm_source=facebook&utm_campaign=x"],
      ["a2", null],
      ["a3", null],
      ["a4", null],
    ],
  );
  assert.equal(seen.length, 2);
  assert.match(seen[0].url, /act_111\/ads\?/);
  assert.ok(!seen[0].url.includes("tok"));
  assert.equal(seen[0].auth, "Bearer tok");
  assert.equal(seen[1].auth, "Bearer tok");
  const q = new URL(seen[0].url).searchParams;
  assert.equal(q.get("fields"), "id,creative{url_tags}");
  assert.equal(q.get("limit"), "500");
  assert.match(decodeURIComponent(seen[0].url), /creative\{url_tags\}/);
  assert.match(q.get("effective_status") ?? "", /ARCHIVED/);
  // The ads edge rejects DELETED outright (code 100, subcode 1815001).
  assert.doesNotMatch(q.get("effective_status") ?? "", /DELETED/);
});

test("fetchUrlTags throws Meta's error message in the same format", async () => {
  process.env.META_ACCESS_TOKEN = "tok";
  process.env.META_AD_ACCOUNT_ID = "act_111";
  const fetchImpl = (async () =>
    new Response(
      JSON.stringify({ error: { message: "Invalid OAuth token", code: 190 } }),
      { status: 400 },
    )) as typeof fetch;
  await assert.rejects(
    fetchUrlTags({ fetchImpl }),
    /^Error: Meta API 400: Invalid OAuth token \(code 190\)$/,
  );
});
