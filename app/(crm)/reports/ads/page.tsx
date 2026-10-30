import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { permissionFor } from "@/lib/auth/permissions";
import { formatDate } from "@/lib/format/date";
import {
  campaignRows,
  earliestMetaTouchpoint,
  leadsPerWeek,
  signupsPerCampaign,
  sourceRows,
} from "@/lib/reports/ads";
import { fundingSplit, priceAgainstHrdcShare } from "@/lib/reports/funding";
import {
  byCampaign,
  efficiencyPoints,
  rankAds,
  roasRows,
  spendByObjective,
  type AdSpendRow,
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
import { LeadsOverTimePanel } from "./panels/leads-over-time";
import { PriceHrdcPanel } from "./panels/price-hrdc";
import { RoasPanel } from "./panels/roas";
import { SpendSplitPanel } from "./panels/spend-split";
import { TopAdsPanel } from "./panels/top-ads";
import { WaitingPanel } from "./panels/waiting";
import { WhoPaysPanel } from "./panels/who-pays";
import { CampaignTable, SourceTable } from "./tables";

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
  const [campaigns, sources, earliest, funding, priceShare, weekly, signups] =
    await Promise.all([
      panel("campaign table", () => campaignRows(user, query)),
      panel("source table", () => sourceRows(user, query)),
      panel("earliest touchpoint", () => earliestMetaTouchpoint(user)),
      panel("who pays", () => fundingSplit(user, query)),
      panel("price against HRDC share", () =>
        priceAgainstHrdcShare(user, query),
      ),
      panel("leads per week", () => leadsPerWeek(user, query)),
      panel("signups per campaign", () => signupsPerCampaign(user, query)),
    ]);

  // The cost side of the report. §5 defers the ad tables, so the pull writes
  // nothing yet and every spend panel falls through to what it waits for.
  // When Shawn's Meta pull lands, reading the rows here is the whole change:
  // the panels below already draw them.
  const adSpend: AdSpendRow[] = [];
  const campaignSpend = byCampaign(adSpend);
  // Revenue per campaign stays empty while O30 stands: a deal records no
  // touchpoint, so crediting orders to a campaign would be a guess shown as a
  // measurement. The panel is wired, not fed.
  const campaignRevenue = new Map<string, { stripe: string; hrdc: string }>();
  const returns = roasRows(campaignSpend, campaignRevenue);
  const whatsappAds = rankAds(adSpend, "messages");
  const conversionAds = rankAds(adSpend, "checkouts");
  const spendSplit = spendByObjective(adSpend);

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

      {weekly.ok ? (
        <LeadsOverTimePanel data={weekly.data} />
      ) : (
        <PanelError what="leads per week" />
      )}

      {signups.ok ? (
        <EfficiencyMapPanel
          points={efficiencyPoints(
            // No spend table yet, so the x axis is empty and the panel says
            // so. The moment the ad pull lands, this map is the only change.
            new Map(),
            new Map(
              signups.data.map((s) => [
                s.campaign,
                { signups: s.signups, hrdcSignups: s.hrdcSignups },
              ]),
            ),
          )}
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

      {funding.ok ? (
        <WhoPaysPanel rows={funding.data} />
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

      {campaigns.ok ? (
        <CampaignTable table={campaigns.data} />
      ) : (
        <PanelError what="the campaign table" />
      )}
      {sources.ok ? (
        <SourceTable table={sources.data} />
      ) : (
        <PanelError what="the source table" />
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
