import type { Metadata } from "next";
import { AttributionScript } from "./attribution-script";

// The public website's shell (§10). It reads no session and imports nothing
// from lib/auth: a visitor must never be bounced to sign-in, and a marketing
// page must not depend on the sign-in provider being reachable. proxy.ts skips
// these paths for the same reason.
//
// Locale-agnostic on purpose. The header and every word on it live in
// ./public-chrome.tsx, which each locale's own layout renders — (en)/ for the
// unprefixed English pages and zh/ for the Chinese ones (§10.5).

// Absolute URLs for the canonical and hreflang links each locale's pages
// declare. Unset or unparseable leaves them relative — a weaker signal to a
// crawler, but a public page may not 500 over a metadata variable.
//
// Read once, when this module first loads — which for the prerendered
// schedule pages is at BUILD time, not per request. A host with separate
// build and runtime environments (Netlify) must carry APP_BASE_URL in the
// build one, or these come out relative with nothing to see at runtime: the
// warning below lands in the build log and nowhere else.
function siteUrl(): URL | null {
  const raw = process.env.APP_BASE_URL?.trim();
  if (!raw) return null;
  try {
    return new URL(raw);
  } catch {
    console.error(
      "APP_BASE_URL is not a URL (read in the build environment); canonical and hreflang will be relative",
    );
    return null;
  }
}

const base = siteUrl();

export const metadata: Metadata = base ? { metadataBase: base } : {};

export default function PublicLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="bg-surface text-ink flex min-h-screen flex-col">
      {/* §10.2: the attribution cookies are written on every public
          page, so a visitor who lands on the schedule and enquires
          later still carries the campaign that found them. The script is
          locale-blind — the locale is not attribution (§10.2). */}
      <AttributionScript />
      {children}
    </div>
  );
}
