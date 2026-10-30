import { trimUrl } from "../../app/(public)/attribution.ts";

// SalesProcess (GoHighLevel) contact -> the touchpoint rows we keep from its
// attribution records. Pure: no network, no database.
//
// What is deliberately NOT kept: ip, userAgent, fbp, fbc, gaClientId. The spec
// keeps IP addresses out (§14) and treats _fbp as marketing storage (§10.2).
// What the records do not carry: an event date. Every touchpoint is dated by
// the contact's dateAdded, so the date is the contact's, not the touch's.

export type GhlAttribution = {
  isFirst?: boolean;
  isLast?: boolean;
  medium?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmCampaignId?: string;
  utmAdId?: string;
  utmContent?: string;
  utmTerm?: string;
  utmKeyword?: string;
  utmFbclid?: string;
  url?: string;
  pageUrl?: string;
  referrer?: string;
};

export type GhlContact = {
  id: string;
  dateAdded?: string;
  attributions?: GhlAttribution[];
};

export type TouchRow = {
  external_ref: string;
  occurred_at: Date;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  utm_campaign_id: string | null;
  utm_ad_id: string | null;
  fbclid: string | null;
  landing_url: string | null;
  referrer: string | null;
};

export type Mapped = {
  rows: TouchRow[];
  placeholders: number; // values like {{campaign.name}} that were never filled in
  noEvidence: number; // records with no campaign, id or click id
  noDate: boolean; // the contact has no usable dateAdded: nothing is kept
};

// A medium that says the click came from Meta. "Paid Social" is SalesProcess's
// own grouping and proves nothing, so it is not here.
const META_MEDIUMS = new Set([
  "facebook",
  "instagram",
  "facebook_chat_widget",
  "instagram_chat_widget",
]);

export function mapContact(c: GhlContact): Mapped {
  const out: Mapped = {
    rows: [],
    placeholders: 0,
    noEvidence: 0,
    noDate: false,
  };
  const when = c.dateAdded ? new Date(c.dateAdded) : null;
  if (!when || Number.isNaN(when.getTime())) {
    out.noDate = true;
    return out;
  }
  const clean = (v: unknown, max = 200): string | null => {
    const s =
      typeof v === "string" || typeof v === "number" ? String(v).trim() : "";
    if (!s) return null;
    if (s.includes("{{")) {
      out.placeholders++;
      return null;
    }
    return s.slice(0, max);
  };
  const seen = new Set<string>();
  const used = new Set<string>();
  for (const a of c.attributions ?? []) {
    const campaign = clean(a.utmCampaign);
    const campaignId = clean(a.utmCampaignId, 100);
    const adId = clean(a.utmAdId, 100);
    const fbclid = clean(a.utmFbclid, 500);
    if (!campaign && !campaignId && !adId && !fbclid) {
      out.noEvidence++;
      continue;
    }
    const medium = (a.medium ?? "").toLowerCase();
    const isMeta = !!(fbclid || campaignId || adId || META_MEDIUMS.has(medium));
    const row: TouchRow = {
      external_ref: "",
      occurred_at: when,
      utm_source:
        clean(a.utmSource)?.toLowerCase() ?? (isMeta ? "facebook" : null),
      utm_medium: clean(a.utmMedium),
      utm_campaign: campaign,
      utm_content: clean(a.utmContent),
      utm_term: clean(a.utmTerm) ?? clean(a.utmKeyword),
      utm_campaign_id: campaignId,
      utm_ad_id: adId,
      fbclid,
      landing_url: trimUrl(a.url ?? a.pageUrl),
      referrer: trimUrl(a.referrer),
    };
    // The same evidence twice (first and latest agree) is kept once.
    const sig = JSON.stringify({ ...row, external_ref: "" });
    if (seen.has(sig)) continue;
    seen.add(sig);
    let kind = a.isLast && !a.isFirst ? "last" : "first";
    if (used.has(kind)) kind = kind === "first" ? "last" : "first";
    if (used.has(kind)) continue;
    used.add(kind);
    row.external_ref = `ghl-attr:${kind}:${c.id}`;
    out.rows.push(row);
  }
  return out;
}
