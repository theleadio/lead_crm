import Link from "next/link";
import { EmptyRow, TableCard } from "@/components/list-kit";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoneyMyr } from "@/lib/format/money";
import { costPer } from "@/lib/reports/spend";
import {
  SOURCE_BUCKETS,
  type SourceBucket,
  type WeeklySummary,
  type WeekRow,
} from "@/lib/reports/weekly";
import { PanelCard } from "./panel-card";

// The weekly summary the owner asked for (18 Nov): signups, pending and ad
// spend for the latest week, then by class, by ad and by week. The Weekly
// tab's signup list (19 Nov) names each person and links to their page;
// every other panel is numbers only.

const dash = <span className="text-ink-muted">—</span>;

function money(amount: string | null) {
  return amount && amount !== "0.00" ? formatMoneyMyr(amount) : dash;
}

function perSignup(spend: string | null, signups: number) {
  const per = spend ? costPer(spend, signups) : null;
  return per ? formatMoneyMyr(per) : dash;
}

const shortDate = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

function weekLabel(w: WeekRow) {
  return `Week of ${shortDate(w.weekStart)}`;
}

// A full week is compared with the full week before; a week still running
// with the same days of the week before (`previousWindow`).
function Delta({
  now,
  before,
  fullWeek,
}: {
  now: number;
  before: number;
  fullWeek: boolean;
}) {
  const than = fullWeek ? "the week before" : "this point last week";
  const d = now - before;
  if (d === 0) return <span>Same as {than}</span>;
  return (
    <span className={d > 0 ? "text-success" : "text-danger"}>
      {d > 0 ? "+" : "−"}
      {Math.abs(d)} vs {than} ({before})
    </span>
  );
}

function Stat({
  label,
  value,
  children,
}: {
  label: string;
  value: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="bg-surface-raised flex flex-col gap-1 rounded-md p-4">
      <span className="text-ink-muted text-sm">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      {children && <span className="text-ink-muted text-xs">{children}</span>}
    </div>
  );
}

const formatSeen = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kuala_Lumpur",
  });

const pct = (part: number, whole: number) =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—";

// `week`: the Weekly tab, where the range is exactly one week and `current`
// says whether it is still running. Without it, the Ad details tab: the last
// week of whatever range was picked.
export function WeeklyCards({
  summary,
  week,
}: {
  summary: WeeklySummary;
  week?: { current: boolean };
}) {
  const w = summary.latest;
  const fullWeek = w.days === 7;
  const matchedShare = pct(w.metaSignups, w.signups);
  return (
    <PanelCard
      eyebrow={
        week ? (week.current ? "THIS WEEK SO FAR" : "WEEK") : "THIS WEEK"
      }
      title={
        <>
          {weekLabel(w)}
          {w.days < 7 && (
            <span className="text-ink-muted font-normal">
              {" "}
              ({w.days} of 7 days)
            </span>
          )}
        </>
      }
      description={
        week
          ? "Monday to Sunday in Kuala Lumpur time. Meta spend is synced daily at 03:00, so today's spend arrives tomorrow."
          : "The last week in the date range, Monday to Sunday in Kuala Lumpur time. Meta spend is synced daily at 03:00, so today's spend arrives tomorrow."
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Signups" value={w.signups}>
          From Meta ads {w.metaSignups} · {matchedShare}
          <br />
          <Delta
            now={w.signups}
            before={summary.previous.signups}
            fullWeek={fullWeek}
          />
        </Stat>
        <Stat label="Pending" value={w.pending}>
          Signed up, not paid yet
          <br />
          <Delta
            now={w.pending}
            before={summary.previous.pending}
            fullWeek={fullWeek}
          />
        </Stat>
        <Stat label="Ad spend" value={money(w.spend)}>
          Meta · {fullWeek ? "week before" : "this point last week"}{" "}
          {money(summary.previous.spend)}
        </Stat>
        <Stat
          label="Cost per Meta signup"
          value={perSignup(w.spend, w.metaSignups)}
        >
          Spend ÷ {w.metaSignups} signups from Meta ads
        </Stat>
      </div>
      {w.signups > 0 && w.metaSignups < w.signups && (
        <p className="text-warning text-sm">
          Only {w.metaSignups} of {w.signups} signups ({matchedShare}) are
          matched to an ad, so cost per Meta signup reads high.
        </p>
      )}
      {!week && (
        <p className="text-ink-muted text-sm">
          In the whole date range: {summary.sources.seat} paid seats in the CRM,{" "}
          {summary.sources.order} paid SalesProcess orders with no seat yet, and{" "}
          {summary.sources.sheet} people only on the participant sheet. One
          person in one class counts once.
        </p>
      )}
      <p className="text-ink-muted text-sm">
        {summary.sheetLastSeen
          ? `The participant sheet last reached the CRM ${formatSeen(summary.sheetLastSeen)}.`
          : "The participant sheet hasn't reached the CRM yet, so sign-ups only on the sheet aren't counted."}
      </p>
    </PanelCard>
  );
}

const CLASS_COLUMNS = 9;

// `compact`: the Weekly tab's five columns (class, signups, HRDC, pending,
// spend). The Ad details tab keeps all nine.
export function SignupsByClass({
  summary,
  compact = false,
}: {
  summary: WeeklySummary;
  compact?: boolean;
}) {
  const t = summary.totals;
  if (compact) return <SignupsByClassCompact summary={summary} />;
  return (
    <PanelCard
      eyebrow="SIGNUPS"
      title={
        <>
          Signups by class{" "}
          <span className="text-ink-muted font-normal">
            ({t.signups} {t.signups === 1 ? "signup" : "signups"})
          </span>
        </>
      }
      description="Every signup in the date range by the class it is for. A signup is a paid seat, or a paid SalesProcess order not yet given a class. Pending is a seat waiting on payment or a checkout hold that hasn't run out. Spend counts the Meta campaigns linked to the class on its page."
    >
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Class</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Signups</TableHead>
              <TableHead>HRDC</TableHead>
              <TableHead>Meta</TableHead>
              <TableHead>Pending</TableHead>
              <TableHead>Spend</TableHead>
              <TableHead>Per Meta signup</TableHead>
              <TableHead>Top ad</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {summary.classes.length === 0 ? (
              <EmptyRow columns={CLASS_COLUMNS}>
                Nobody signed up in this date range.
              </EmptyRow>
            ) : (
              summary.classes.map((c) => (
                <TableRow key={c.key}>
                  <TableCell>{className(c.name)}</TableCell>
                  <TableCell>
                    {c.workshop === null
                      ? dash
                      : c.workshop
                        ? "Workshop"
                        : "Program"}
                  </TableCell>
                  <TableCell>{c.signups}</TableCell>
                  <TableCell>{c.hrdc}</TableCell>
                  <TableCell>{c.meta}</TableCell>
                  <TableCell>{c.pending}</TableCell>
                  <TableCell>{money(c.spend)}</TableCell>
                  <TableCell>{perSignup(c.spend, c.meta)}</TableCell>
                  <TableCell className="text-ink-muted">
                    {c.topAd ?? "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
            {summary.unlinkedSpend !== "0.00" && (
              <TableRow>
                <TableCell className="text-ink-muted italic">
                  Ads not linked to a class
                </TableCell>
                <TableCell colSpan={5} />
                <TableCell>{money(summary.unlinkedSpend)}</TableCell>
                <TableCell colSpan={2} />
              </TableRow>
            )}
            <TableRow className="font-semibold">
              <TableCell>Total</TableCell>
              <TableCell />
              <TableCell>{t.signups}</TableCell>
              <TableCell>
                {summary.classes.reduce((n, c) => n + c.hrdc, 0)}
              </TableCell>
              <TableCell>{t.metaSignups}</TableCell>
              <TableCell>{t.pending}</TableCell>
              <TableCell>{money(t.spend)}</TableCell>
              <TableCell>{perSignup(t.spend, t.metaSignups)}</TableCell>
              <TableCell />
            </TableRow>
          </TableBody>
        </Table>
      </TableCard>
    </PanelCard>
  );
}

const className = (name: string | null) =>
  name ?? (
    <span className="text-ink-muted italic">
      Class not known (an unmatched sheet class or product)
    </span>
  );

function SignupsByClassCompact({ summary }: { summary: WeeklySummary }) {
  const t = summary.totals;
  return (
    <PanelCard eyebrow="SIGNUPS" title="Signups by class">
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Class</TableHead>
              <TableHead>Signups</TableHead>
              <TableHead>HRDC</TableHead>
              <TableHead>Pending</TableHead>
              <TableHead>Spend</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {summary.classes.length === 0 ? (
              <EmptyRow columns={5}>Nobody signed up this week.</EmptyRow>
            ) : (
              summary.classes.map((c) => (
                <TableRow key={c.key}>
                  <TableCell>{className(c.name)}</TableCell>
                  <TableCell>{c.signups}</TableCell>
                  <TableCell>{c.hrdc}</TableCell>
                  <TableCell>{c.pending}</TableCell>
                  <TableCell>{money(c.spend)}</TableCell>
                </TableRow>
              ))
            )}
            {summary.unlinkedSpend !== "0.00" && (
              <TableRow>
                <TableCell className="text-ink-muted italic">
                  Ads not linked to a class
                </TableCell>
                <TableCell colSpan={3} />
                <TableCell>{money(summary.unlinkedSpend)}</TableCell>
              </TableRow>
            )}
            <TableRow className="font-semibold">
              <TableCell>Total</TableCell>
              <TableCell>{t.signups}</TableCell>
              <TableCell>
                {summary.classes.reduce((n, c) => n + c.hrdc, 0)}
              </TableCell>
              <TableCell>{t.pending}</TableCell>
              <TableCell>{money(t.spend)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableCard>
    </PanelCard>
  );
}

const SOURCE_TEXT: Record<SourceBucket, string> = {
  whatsapp_ad: "WhatsApp ad opt-in",
  lead_form: "Meta Lead Ads form",
  web_form: "Website form",
  utm_link: "Link with ad tracking",
  whatsapp: "WhatsApp, direct",
  referral: "Referral",
  walk_in: "Walk-in",
  self: "Said on the sheet",
  none: "No source recorded",
};

export function SignupSources({ summary }: { summary: WeeklySummary }) {
  const total = summary.totals.signups;
  const rows = SOURCE_BUCKETS.filter(
    (b) => summary.bySource[b] > 0 || b === "none",
  ).sort((a, b) =>
    a === "none"
      ? 1
      : b === "none"
        ? -1
        : summary.bySource[b] - summary.bySource[a],
  );
  return (
    <PanelCard
      eyebrow="SOURCES"
      title="Where signups came from"
      description="Each signup by the latest source the person had before signing up: a WhatsApp chat started from an ad, a Lead Ads form, a website form, a link with ad tracking. Signups whose only record is an import or payment link, with no ad tracking, use the source before it. Ad details credits the first Meta touch instead, so its counts can differ."
    >
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Source</TableHead>
              <TableHead>Signups</TableHead>
              <TableHead>Share</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((b) => (
              <TableRow key={b}>
                <TableCell className={b === "none" ? "text-danger" : undefined}>
                  {SOURCE_TEXT[b]}
                </TableCell>
                <TableCell>{summary.bySource[b]}</TableCell>
                <TableCell>{pct(summary.bySource[b], total)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>
      {summary.campaigns.length > 0 && (
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ad source</TableHead>
                <TableHead>Campaign</TableHead>
                <TableHead>Signups</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.campaigns.map((c) => (
                <TableRow key={`${c.utmSource}|${c.utmCampaign}`}>
                  <TableCell>{c.utmSource ?? dash}</TableCell>
                  <TableCell>{c.utmCampaign}</TableCell>
                  <TableCell>{c.signups}</TableCell>
                </TableRow>
              ))}
              {summary.campaignsDropped > 0 && (
                <TableRow>
                  <TableCell className="text-ink-muted italic" colSpan={2}>
                    Other campaigns
                  </TableCell>
                  <TableCell>{summary.campaignsDropped}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableCard>
      )}
    </PanelCard>
  );
}

// Folded shut: the counts above answer the weekly question, the list is for
// following one up.
export function SignupPeople({ summary }: { summary: WeeklySummary }) {
  return (
    <PanelCard
      eyebrow="SIGNUPS"
      title={`Each signup (${summary.people.length})`}
      description="Newest first. Each name opens the person's page."
      defaultOpen={false}
    >
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Person</TableHead>
              <TableHead>Class</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Campaign</TableHead>
              <TableHead>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {summary.people.length === 0 ? (
              <EmptyRow columns={5}>Nobody signed up this week.</EmptyRow>
            ) : (
              summary.people.map((p, i) => (
                <TableRow key={`${p.personId}-${i}`}>
                  <TableCell>
                    <Link
                      href={`/people/${p.personId}`}
                      className="text-primary hover:underline"
                    >
                      {p.name ?? "Unnamed"}
                    </Link>
                  </TableCell>
                  <TableCell>{className(p.className)}</TableCell>
                  <TableCell
                    className={p.source === "none" ? "text-danger" : undefined}
                  >
                    {SOURCE_TEXT[p.source]}
                  </TableCell>
                  <TableCell className="text-ink-muted">
                    {p.utmCampaign ?? "—"}
                  </TableCell>
                  <TableCell>{shortDate(p.day)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableCard>
    </PanelCard>
  );
}

const MATCH_TEXT = {
  meta: "Their first Meta ad touch names a campaign",
  meta_no_id: "Came from Meta, but no campaign or ad id",
  self: "Said how they came on the sheet (not an ad)",
  other: "Has a source, but not Meta",
  none: "No source recorded",
} as const;

export function AdMatch({ summary }: { summary: WeeklySummary }) {
  const m = summary.match;
  const notMatched = m.meta_no_id + m.self + m.other + m.none;
  return (
    <PanelCard
      eyebrow="ADS"
      title="How signups were matched to ads"
      description="Each signup's person is matched to the first Meta ad they came through: a Lead Ads form, a click-to-WhatsApp chat, or a link carrying the ad's id. Expect many not matched at first; this rises as every ad carries the standard URL parameters."
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Matched to an ad" value={m.meta}>
          {pct(m.meta, summary.totals.signups)} of signups
        </Stat>
        {(["meta_no_id", "self", "other", "none"] as const).map((k) => (
          <Stat key={k} label={MATCH_TEXT[k]} value={m[k]} />
        ))}
      </div>
      {summary.sheetUnmapped.length > 0 && (
        <p className="text-ink-muted text-sm">
          Sheet classes with no CRM class yet, by people:{" "}
          {summary.sheetUnmapped
            .map((u) => `${u.label} (${u.people})`)
            .join(", ")}
          . Map one with <code>npm run participants:map</code>.
        </p>
      )}
      <p className="text-ink-muted text-sm">
        {notMatched} of {summary.totals.signups} signups can&apos;t be credited
        to a specific ad.
      </p>
    </PanelCard>
  );
}

const AD_COLUMNS = 5;

export function SignupsPerAd({ summary }: { summary: WeeklySummary }) {
  return (
    <PanelCard
      eyebrow="ADS"
      title="Signups per ad"
      description="Every ad that brought a signup or spent money in the date range. Ads that spent and brought nobody are listed too."
    >
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ad</TableHead>
              <TableHead>Class</TableHead>
              <TableHead>Signups</TableHead>
              <TableHead>Spend</TableHead>
              <TableHead>Per signup</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {summary.ads.length === 0 ? (
              <EmptyRow columns={AD_COLUMNS}>
                No ad spent or brought a signup in this date range.
              </EmptyRow>
            ) : (
              summary.ads.map((a) => (
                <TableRow key={a.adId}>
                  <TableCell>
                    {a.adName}
                    {a.campaignName && (
                      <div className="text-ink-muted text-xs">
                        {a.campaignName}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-ink-muted">
                    {a.className ?? "Not linked"}
                  </TableCell>
                  <TableCell
                    className={
                      a.signups === 0 && a.spend !== "0.00"
                        ? "text-danger"
                        : undefined
                    }
                  >
                    {a.signups}
                  </TableCell>
                  <TableCell>
                    {a.spentEarlier ? (
                      <span className="text-ink-muted">spent earlier</span>
                    ) : (
                      money(a.spend)
                    )}
                  </TableCell>
                  <TableCell>{perSignup(a.spend, a.signups)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableCard>
      {summary.adsDropped > 0 && (
        <p className="text-ink-muted text-sm">
          Showing the top {summary.ads.length} — {summary.adsDropped} more not
          shown.
        </p>
      )}
    </PanelCard>
  );
}

const COHORT_COLUMNS = 4;

export function ByFirstTouchWeek({ summary }: { summary: WeeklySummary }) {
  return (
    <PanelCard
      eyebrow="SIGNUPS"
      title="By week of first ad touch"
      description="Each Meta signup counts in the week they first met a Meta ad, however long before they signed up. Spend is that week's Meta spend, so the cost per signup is not thrown off by signups that arrive weeks after the ad."
    >
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Week of first touch</TableHead>
              <TableHead>Meta spend</TableHead>
              <TableHead>Meta signups</TableHead>
              <TableHead>Per Meta signup</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {summary.cohorts.length === 0 ? (
              <EmptyRow columns={COHORT_COLUMNS}>No weeks in range.</EmptyRow>
            ) : (
              [...summary.cohorts].reverse().map((c) => (
                <TableRow key={c.weekStart}>
                  <TableCell>{shortDate(c.weekStart)}</TableCell>
                  <TableCell>{money(c.spend)}</TableCell>
                  <TableCell>{c.metaSignups}</TableCell>
                  <TableCell>{perSignup(c.spend, c.metaSignups)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableCard>
      {summary.cohortBefore > 0 && (
        <p className="text-ink-muted text-sm">
          {summary.cohortBefore} more Meta signups first met an ad before the
          first week shown.
        </p>
      )}
    </PanelCard>
  );
}

const WEEK_COLUMNS = 7;

export function ByWeek({ summary }: { summary: WeeklySummary }) {
  return (
    <PanelCard
      eyebrow="SIGNUPS"
      title="By week"
      description="Monday to Sunday, Kuala Lumpur time. Pending counts seats signed up that week that are still waiting on payment now."
    >
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Week</TableHead>
              <TableHead>Signups</TableHead>
              <TableHead>From Meta</TableHead>
              <TableHead>Matched</TableHead>
              <TableHead>Pending</TableHead>
              <TableHead>Spend</TableHead>
              <TableHead>Per Meta signup</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {summary.weeks.length === 0 ? (
              <EmptyRow columns={WEEK_COLUMNS}>No weeks in range.</EmptyRow>
            ) : (
              [...summary.weeks].reverse().map((w) => (
                <TableRow key={w.weekStart}>
                  <TableCell>
                    {shortDate(w.weekStart)}
                    {w.days < 7 && (
                      <span className="text-ink-muted">
                        {" "}
                        ({w.days} of 7 days)
                      </span>
                    )}
                    {w.approx && (
                      <span
                        className="text-ink-muted"
                        title="Some of this week's sheet signups are dated by their class, not by when they signed up."
                      >
                        {" "}
                        (approx.)
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{w.signups}</TableCell>
                  <TableCell>{w.metaSignups}</TableCell>
                  <TableCell>{pct(w.metaSignups, w.signups)}</TableCell>
                  <TableCell>{w.pending}</TableCell>
                  <TableCell>{money(w.spend)}</TableCell>
                  <TableCell>{perSignup(w.spend, w.metaSignups)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableCard>
    </PanelCard>
  );
}
