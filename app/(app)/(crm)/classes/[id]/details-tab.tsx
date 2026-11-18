import { Panel, Row } from "@/components/detail-kit";
import { formatMoneyMyr } from "@/lib/format/money";
import type { ClassRecord } from "@/lib/classes/service";
import { enumLabel } from "@/lib/classes/types";
import { formatDate } from "@/lib/format/date";
import type { CampaignChoice, LinkedCampaign } from "@/lib/classes/campaigns";
import { CancelClass } from "./cancel-class";
import { ClassCampaigns } from "./class-campaigns";

// §9.10 Details tab: the §5 class fields, read-only. Editing is the 9.9
// form's job; the writes offered here are Edit (in the header) and Cancel
// class, both for super_admin and operations only (§6), plus linking Meta
// campaigns, which marketing and management may do too (12 Nov 2026).

const NOT_SET = "Not set";
// Today in Kuala Lumpur (§4), the day the cancel rule counts from.
const todayKl = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
const LANGUAGES: Record<string, string> = { en: "English", zh: "中文" };

function value(v: string | number | null | undefined): string {
  if (v === null || v === undefined || String(v).trim() === "") return NOT_SET;
  return String(v);
}

export function DetailsTab({
  cls,
  canWrite,
  seatHolders,
  courseListPriceMyr,
  campaigns,
  canLinkCampaigns,
}: {
  cls: ClassRecord;
  canWrite: boolean;
  // The Meta campaigns that sell this class, and the ones that could
  // (lib/classes/campaigns.ts); linking is open to more roles than editing.
  campaigns: { linked: LinkedCampaign[]; choices: CampaignChoice[] };
  canLinkCampaigns: boolean;
  // A class with no price of its own sells at its course's list price (§5).
  courseListPriceMyr: string | null;
  // How many students the cancel dialog will name. Counted on the server
  // again inside the transaction, so this number is only for the wording.
  seatHolders: number;
}) {
  return (
    <div
      role="tabpanel"
      id="panel-details"
      aria-labelledby="tab-details"
      className="grid gap-6 lg:grid-cols-2"
    >
      <Panel title="Course and dates">
        <Row>
          <span className="text-ink-muted">Course</span>
          <span>{cls.courseName}</span>
        </Row>
        <Row>
          <span className="text-ink-muted">Class code</span>
          <span>{cls.code}</span>
        </Row>
        <Row>
          <span className="text-ink-muted">Starts</span>
          <span>{formatDate(`${cls.startDate}T00:00:00Z`)}</span>
        </Row>
        <Row>
          <span className="text-ink-muted">Ends</span>
          <span>{formatDate(`${cls.endDate}T00:00:00Z`)}</span>
        </Row>
        <Row>
          <span className="text-ink-muted">Start time</span>
          <span>{value(cls.startTime)}</span>
        </Row>
        <Row>
          <span className="text-ink-muted">End time</span>
          <span>{value(cls.endTime)}</span>
        </Row>
        <Row>
          <span className="text-ink-muted">Language</span>
          <span>{LANGUAGES[cls.language] ?? cls.language}</span>
        </Row>
        <Row>
          <span className="text-ink-muted">Status</span>
          <span>{enumLabel(cls.status)}</span>
        </Row>
      </Panel>

      <Panel title="Where and how much">
        <Row>
          <span className="text-ink-muted">Format</span>
          <span>{enumLabel(cls.mode)}</span>
        </Row>
        <Row>
          <span className="text-ink-muted">Venue</span>
          <span>{value(cls.venueName)}</span>
        </Row>
        <Row>
          <span className="text-ink-muted">Address</span>
          <span>{value(cls.venueAddress)}</span>
        </Row>
        <Row>
          <span className="text-ink-muted">City</span>
          <span>{value(cls.city)}</span>
        </Row>
        <Row>
          <span className="text-ink-muted">Joining link</span>
          <span className="truncate">{value(cls.onlineUrl)}</span>
        </Row>
        <Row>
          <span className="text-ink-muted">Capacity</span>
          <span>{cls.capacity}</span>
        </Row>
        <Row>
          <span className="text-ink-muted">Few-seats threshold</span>
          <span>{cls.fewSeatsThreshold}</span>
        </Row>
        <Row>
          <span className="text-ink-muted">Price</span>
          <span>
            {cls.priceMyr
              ? formatMoneyMyr(cls.priceMyr)
              : courseListPriceMyr
                ? `${formatMoneyMyr(courseListPriceMyr)} (course list price)`
                : "Not set"}
          </span>
        </Row>
        <Row>
          <span className="text-ink-muted">HRDC claimable</span>
          <span>{cls.hrdcClaimable ? "Yes" : "No"}</span>
        </Row>
        <Row>
          <span className="text-ink-muted">On the website</span>
          <span>{cls.isPublic ? "Yes" : "No"}</span>
        </Row>
      </Panel>

      <Panel title="Meta campaigns">
        <ClassCampaigns
          classId={cls.id}
          linked={campaigns.linked}
          choices={campaigns.choices}
          canLink={canLinkCampaigns}
        />
      </Panel>

      {canWrite && (
        <Panel title="Cancel this class">
          <p className="text-ink-muted mb-3 text-sm">
            Calls the class off and cancels every seat it is holding. Refunds
            are handled in Stripe, not here.
          </p>
          <CancelClass
            id={cls.id}
            code={cls.code}
            version={cls.version}
            seatHolders={seatHolders}
            alreadyCancelled={cls.status === "cancelled"}
            started={cls.startDate <= todayKl()}
          />
        </Panel>
      )}
    </div>
  );
}
