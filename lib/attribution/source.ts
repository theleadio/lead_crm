// One name per traffic source, applied where a touchpoint is written.
//
// `utm_source` is free text. Ads were tagged "fb_ad" or "facebook" by hand,
// Meta's own macro gives "fb" or "ig", and a link with only a click id carries
// no source at all. The reports fold these together when they read
// (`platformSql` in lib/reports/ads.ts); storing one name keeps every other
// reader, and the Weekly tab's "where from" column, consistent too.

const ALIASES: Record<string, string> = {
  fb: "facebook",
  fb_ad: "facebook",
  "fb-ad": "facebook",
  facebook: "facebook",
  "facebook.com": "facebook",
  "m.facebook.com": "facebook",
  "l.facebook.com": "facebook",
  ig: "instagram",
  instagram: "instagram",
  "l.instagram.com": "instagram",
};

// The canonical name for a known spelling; anything else is kept as typed
// (trimmed), and blank is null. The sheet's "self:..." values pass through.
export function normalizeSource(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  return ALIASES[s.toLowerCase()] ?? s;
}

// The source to store: the tagged one, else what a click id proves. An
// `fbclid` is only ever added by Meta and `gclid` by Google Ads, so a link
// that lost its utm_source but kept the click id is still an ad visit.
export function resolveSource(t: {
  utmSource?: string | null;
  fbclid?: string | null;
  gclid?: string | null;
}): string | null {
  return (
    normalizeSource(t.utmSource) ??
    (t.fbclid ? "facebook" : t.gclid ? "google" : null)
  );
}
