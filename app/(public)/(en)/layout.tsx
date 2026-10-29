import type { Metadata } from "next";
import { PublicChrome } from "../public-chrome";
import { PublicRoot } from "../public-root";
import { siteUrl } from "../site-url";

// The English public pages. A route group adds no URL segment, so these are
// served at /schedule, /enquiry and /register — the paths they had before the
// Chinese site existed, unchanged and still canonical (§10.5).
//
// A root layout of its own, so these pages carry <html lang="en"> while the
// Chinese ones carry zh-Hans (§14, WCAG 3.1.1). See ../public-root.tsx.

const base = siteUrl();

export const metadata: Metadata = base ? { metadataBase: base } : {};

export default function EnglishPublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PublicRoot locale="en">
      <PublicChrome locale="en">{children}</PublicChrome>
    </PublicRoot>
  );
}
