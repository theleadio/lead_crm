import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { permissionFor } from "@/lib/auth/permissions";
import { formatDate } from "@/lib/format/date";
import { earliestMetaTouchpoint, signupsPerCampaign } from "@/lib/reports/ads";
import {
  fundingBreakdowns,
  fundingSplit,
  priceAgainstHrdcShare,
} from "@/lib/reports/funding";
import { fundingFromLms } from "@/lib/reports/lms-funding";
import { adSpendRows, normaliseCampaign } from "@/lib/reports/ad-spend";
import {
  byCampaign,
  efficiencyPoints,
  rankAds,
  roasRows,
  spendByObjective,
  type AdSpendRow,
  type CampaignRevenue,
  type ObjectiveSplit,
} from "@/lib/reports/spend";
import { SPEND_UNAVAILABLE } from "@/lib/reports/types";
import {
  adsReportQuerySchema,
  readAdsReportParams,
} from "@/lib/validation/report";
// The §9.0 panel error: a client component that retries the server render in
// place. Imported where it lives rather than moved, so Home stays untouched.
import { PanelError } from "../../dashboard/panel-kit";
import { EfficiencyMapPanel } from "./panels/efficiency-map";
import { FundingDonutsPanel } from "./panels/funding-donuts";
import { PriceHrdcPanel } from "./panels/price-hrdc";
import { RoasPanel } from "./panels/roas";
import { SpendSplitPanel } from "./panels/spend-split";
import { TopAdsPanel } from "./panels/top-ads";
import { WaitingPanel } from "./panels/waiting";
import { WhoPaysPanel } from "./panels/who-pays";

// Spec §9.18. The ads dashboard, in the app now that the BI tool is dropped
// (O67). Two panels are drawn from tables that exist; five name what they
// wait for, because §5 defers the ad tables and O30 blocks any return-on-spend
// figure. Read-only: nothing here writes.
const META_DEFINITION =
  "A Meta lead is a touchpoint from Lead Ads or click-to-WhatsApp, or one carrying an fbclid or ctwa_clid, or one tagged facebook, instagram, fb, ig or meta.";

// Each read loads on its own: one failing query leaves the rest of the report
// usable (§13), and the reason is logged rather than swallowed. The §9.0 Home
// panels do the same.
async function panel<T>(name: string, load: () => Promise<T>) {
  try {
    return { ok: true as const, data: await load() };
  } catch (err) {
    console.error(`[ads report] ${name} failed`, err);
    return { ok: false as const };
  }
}

export default async function AdsReportPage(props: PageProps<"/reports/ads">) {
  const user = await getCurrentUser();
  // O62: the §6 matrix has no Reports row, so Reports rides on person read
  // that is not the part_time assigned-only kind — the test §9.0 Home already
  // uses for its needs-attention panel. The service re-checks it.
  const person = user ? permissionFor(user, "person", "read") : null;
  if (!user || !person?.allowed || person.assignedOnly) notFound();

  // The URL is the query: a range can be shared, and a reload lands on the
  // same numbers because the server reads it too (§7).
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(await props.searchParams))
    if (typeof value === "string") searchParams.set(key, value);
  const parsed = adsReportQuerySchema.safeParse(
    readAdsReportParams(searchParams),
  );

  // A bad range is refused with the filter still usable, never corrected into
  // a different range the viewer cannot see is different (§9.18).
  if (!parsed.success) {
    return (
      <Shell
        from={searchParams.get("filter[from]") ?? ""}
        to={searchParams.get("filter[to]") ?? ""}
      >
        <p role="alert" className="text-danger text-sm">
          {parsed.error.issues[0]?.message ?? "That date range isn't valid."} No
          counts are shown.
        </p>
      </Shell>
    );
  }

  const query = parsed.data;
  const [earliest, funding, priceShare, signups, spend, lmsFunding] =
    await Promise.all([
      panel("earliest touchpoint", () => earliestMetaTouchpoint(user)),
      panel("who pays", () => fundingSplit(user, query)),
      panel("price against HRDC share", () =>
        priceAgainstHrdcShare(user, query),
      ),
      panel("signups per campaign", () => signupsPerCampaign(user, query)),
      panel("ad spend", () => adSpendRows(user, query)),
      // Read whether or not the CRM has funding: which of the two the panel
      // shows is decided below, and a failing LMS must not take the screen down.
      panel("who pays, from the LMS", () => fundingFromLms(user)),
    ]);

  // The cost side of the report, from `meta_ad_insight` (migration 014). The
  // pull asks Meta for ad-level rows, so campaign totals are summed from
  // those rows and there is no second grain to double-count against.
  const adSpend: AdSpendRow[] = spend.ok ? spend.data : [];
  const campaignSpend = byCampaign(adSpend, "ad");

  // Both halves group on a normalised campaign key, because a touchpoint
  // carries the campaign as a URL did — `+` for a space, percent-escapes, any
  // case. What the screen prints is the name a person would recognise:
  // Meta's own, or the tag the lead arrived with when there is no ad row.
  const displayFor = new Map<string, string>();
  for (const row of adSpend)
    displayFor.set(row.campaignName, row.displayName ?? row.campaignName);
  if (signups.ok)
    for (const s of signups.data) {
      const key = normaliseCampaign(s.campaign);
      if (!displayFor.has(key)) displayFor.set(key, s.campaign);
    }
  const named = (key: string) => displayFor.get(key) ?? key;
  // Revenue per campaign stays empty: `deal.source_touchpoint_id` exists
  // (migration 009) but only public intake sets it, so most deals carry no
  // campaign and a ratio built on the ones that do would read low by an
  // unknown amount. The panel is wired, not fed.
  const campaignRevenue = new Map<string, CampaignRevenue>();
  const returns = roasRows(campaignSpend, campaignRevenue).map((r) => ({
    ...r,
    campaign: named(r.campaign),
  }));
  // Ranked on the two action counts the pull now carries: conversations
  // started, and checkouts started. An ad that counted none of either is not
  // in its list at all.
  const whatsappAds = rankAds(adSpend, "messages").map((r) => ({
    ...r,
    campaign: named(r.campaign),
  }));
  const conversionAds = rankAds(adSpend, "checkouts").map((r) => ({
    ...r,
    campaign: named(r.campaign),
  }));
  // Ad-grain rows, so the split is told to use that grain: campaign rows and
  // ad rows are the same ringgit twice.
  // Funding comes from the CRM when a deal records any, and from the LMS
  // while none does — one decision, so the rings and the bars can never
  // disagree about where their numbers came from.
  const whoPays =
    funding.ok && funding.data.some((r) => r.hrdc > 0)
      ? { rows: funding.data, source: "deal" as const }
      : lmsFunding.ok && lmsFunding.data.length > 0
        ? { rows: lmsFunding.data, source: "lms" as const }
        : funding.ok
          ? { rows: funding.data, source: "deal" as const }
          : null;

  const spendSplit: ObjectiveSplit[] = spendByObjective(adSpend, "ad").map(
    (r) => ({ ...r, campaign: named(r.campaign) }),
  );

  // The panels in the order the agreed dashboard sets them, so this screen and
  // that page can be read side by side.
  return (
    <Shell from={query.from} to={query.to}>
      {earliest.ok && earliest.data && (
        <p className="text-ink-muted text-sm">
          Attribution data starts {formatDate(earliest.data)}; a range reaching
          further back has nothing to count.
        </p>
      )}

      {/* A failed spend read shows the panel's error rather than an empty x
          axis, which would read as "no campaign spent anything". */}
      {signups.ok && spend.ok ? (
        <EfficiencyMapPanel
          points={efficiencyPoints(
            // Spend summed from the ad-level rows of `meta_ad_insight`,
            // matched to signups on the normalised campaign key. A campaign
            // that spent and produced nothing still has a point; so does one
            // that produced signups with no spend recorded against it.
            campaignSpend,
            new Map(
              signups.data.map((s) => [
                normaliseCampaign(s.campaign),
                { signups: s.signups, hrdcSignups: s.hrdcSignups },
              ]),
            ),
          ).map((p) => ({ ...p, campaign: named(p.campaign) }))}
        />
      ) : (
        <PanelError what="spend against signups" />
      )}

      {priceShare.ok ? (
        <PriceHrdcPanel rows={priceShare.data} />
      ) : (
        <PanelError what="course price against HRDC share" />
      )}

      {returns.length > 0 ? (
        <RoasPanel rows={returns} />
      ) : (
        <WaitingPanel
          title="Return on ad spend"
          waitingFor="recorded ad spend, and O30 — a deal does not record the touchpoint that created it, so every order would be credited to advertising and the ratio would be an upper bound shown as a measurement"
        />
      )}

      {whatsappAds.length > 0 ? (
        <TopAdsPanel
          title="Top click-to-WhatsApp ads"
          description="The ads that started the most conversations, with what one message cost and how often the ad was clicked."
          countLabel="Messages"
          costLabel="Cost per message"
          rows={whatsappAds}
          emptyNote="No click-to-WhatsApp ad recorded a message in this date range."
        />
      ) : (
        <WaitingPanel
          title="Top click-to-WhatsApp ads"
          waitingFor="ad-level engagement — messages, cost per message and click-through rate live only in the ad tables"
        />
      )}

      {conversionAds.length > 0 ? (
        <TopAdsPanel
          title="Top conversion ads"
          description="The ads that started the most checkouts, with what one started checkout cost and how often the ad was clicked. A started checkout is not a payment."
          countLabel="Checkouts started"
          costLabel="Cost per checkout"
          rows={conversionAds}
          emptyNote="No conversion ad recorded a started checkout in this date range."
        />
      ) : (
        <WaitingPanel
          title="Top conversion ads"
          waitingFor="ad-level engagement — checkouts started, cost per checkout and click-through rate live only in the ad tables"
        />
      )}

      {/* The CRM's deals are the answer when any of them records funding.
          None do today, so the LMS stands in and both panels say so. The
          rings are the shape of it; the bars are programme by programme. */}
      {whoPays ? (
        <>
          <FundingDonutsPanel
            breakdowns={fundingBreakdowns(whoPays.rows)}
            source={whoPays.source}
          />
          <WhoPaysPanel rows={whoPays.rows} source={whoPays.source} />
        </>
      ) : (
        <PanelError what="the who-pays panel" />
      )}

      {spendSplit.length > 0 ? (
        <SpendSplitPanel rows={spendSplit} />
      ) : (
        <WaitingPanel
          title="Where the spend went"
          waitingFor="recorded ad spend per ad type — the ad tables §5 defers"
        />
      )}
    </Shell>
  );
}

// A plain GET form: the two dates are the whole filter, so the browser can
// submit them into the URL without any client JavaScript.
function Shell({
  from,
  to,
  children,
}: {
  from: string;
  to: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-xl font-semibold">Ads</h1>
        <p className="text-ink-muted text-sm">{META_DEFINITION}</p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">From</span>
          <input
            type="date"
            name="filter[from]"
            defaultValue={from}
            className="border-line focus-visible:outline-focus-ring rounded-md border px-3 py-2 focus-visible:outline-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">To</span>
          <input
            type="date"
            name="filter[to]"
            defaultValue={to}
            className="border-line focus-visible:outline-focus-ring rounded-md border px-3 py-2 focus-visible:outline-2"
          />
        </label>
        <button
          type="submit"
          className="bg-primary focus-visible:outline-focus-ring rounded-md px-4 py-2.5 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Apply
        </button>
      </form>

      {children}

      <p className="text-ink-muted text-sm">{SPEND_UNAVAILABLE}</p>
    </div>
  );
}
