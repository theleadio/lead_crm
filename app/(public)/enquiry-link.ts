// Where "talk to us" goes until §10.3 builds the enquiry form. The marketing
// site's own root already takes enquiries, so this is a real destination
// rather than an invented address; swap it for the form in one line when 10.3
// lands. Null when PUBLIC_WEBSITE_URL is unset, and the link is then not shown
// at all — a dead link is worse than no link.
export function enquiryUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const base = (env.PUBLIC_WEBSITE_URL ?? "").trim().replace(/\/+$/, "");
  return base || null;
}
