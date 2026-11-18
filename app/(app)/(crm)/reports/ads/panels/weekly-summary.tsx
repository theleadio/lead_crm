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
import type { WeeklySummary, WeekRow } from "@/lib/reports/weekly";
import { PanelCard } from "./panel-card";

// The weekly summary the owner asked for (18 Nov): signups, pending and ad
// spend for the latest week, then by class, by ad and by week. Numbers only:
// no student is named on this screen.

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

function Delta({ now, before }: { now: number; before: number }) {
  const d = now - before;
  if (d === 0) return <span>Same as this point last week</span>;
  return (
    <span>
      {d > 0 ? "+" : "−"}
      {Math.abs(d)} vs this point last week
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

const pct = (part: number, whole: number) =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—";

export function WeeklyCards({ summary }: { summary: WeeklySummary }) {
  const w = summary.latest;
  return (
    <PanelCard
      eyebrow="THIS WEEK"
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
      description="The last week in the date range, Monday to Sunday in Kuala Lumpur time. Meta spend is synced daily at 03:00, so today's spend arrives tomorrow."
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Signups" value={w.signups}>
          From Meta ads {w.metaSignups} · {pct(w.metaSignups, w.signups)}
          <br />
          <Delta now={w.signups} before={summary.previous.signups} />
        </Stat>
        <Stat label="Pending" value={w.pending}>
          Signed up, not paid yet
          <br />
          <Delta now={w.pending} before={summary.previous.pending} />
        </Stat>
        <Stat label="Ad spend" value={money(w.spend)}>
          Meta
        </Stat>
        <Stat
          label="Cost per Meta signup"
          value={perSignup(w.spend, w.metaSignups)}
        >
          Spend ÷ signups from Meta ads
        </Stat>
      </div>
      <p className="text-ink-muted text-sm">
        In the whole date range: {summary.sources.seat} paid seats in the CRM
        and {summary.sources.order} paid SalesProcess orders with no seat yet.
        One person in one class counts once.
      </p>
    </PanelCard>
  );
}

const CLASS_COLUMNS = 9;

export function SignupsByClass({ summary }: { summary: WeeklySummary }) {
  const t = summary.totals;
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
                  <TableCell>
                    {c.name ?? (
                      <span className="text-ink-muted italic">
                        Course not known
                      </span>
                    )}
                  </TableCell>
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

const MATCH_TEXT = {
  meta: "Their first Meta ad touch names a campaign",
  meta_no_id: "Came from Meta, but no campaign or ad id",
  other: "Has a source, but not Meta",
  none: "No source recorded",
} as const;

export function AdMatch({ summary }: { summary: WeeklySummary }) {
  const m = summary.match;
  const notMatched = m.meta_no_id + m.other + m.none;
  return (
    <PanelCard
      eyebrow="ADS"
      title="How signups were matched to ads"
      description="Each signup's person is matched to the first Meta ad they came through: a Lead Ads form, a click-to-WhatsApp chat, or a link carrying the ad's id. Expect many not matched at first; this rises as every ad carries the standard URL parameters."
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Matched to an ad" value={m.meta}>
          {pct(m.meta, summary.totals.signups)} of signups
        </Stat>
        {(["meta_no_id", "other", "none"] as const).map((k) => (
          <Stat key={k} label={MATCH_TEXT[k]} value={m[k]} />
        ))}
      </div>
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
