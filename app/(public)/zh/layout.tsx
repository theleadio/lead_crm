import type { Metadata } from "next";
import { PublicChrome } from "../public-chrome";
import { PublicRoot } from "../public-root";
import { siteUrl } from "../site-url";

// The Chinese public pages, served under /zh (§10.5).
//
// A root layout of its own, so <html lang> is zh-Hans here and en on the
// English pages. §14 requires WCAG 2.1 AA and 3.1.1 (Language of Page, Level
// A) is met through the html element: a lang on an inner element leaves
// Chrome's translate prompt and every crawler reading a Chinese page as
// English. The language control is already a full <a> navigation, so moving
// between the two roots costs nothing that was not already a page load, and
// no URL changed. See ../public-root.tsx for the shell both roots share.
//
// shortcut: each public page still needs a thin route file here as well as
// under (en)/, because English keeps the unprefixed path and a single
// `app/[lang]` segment cannot serve a locale with no prefix. Upgrade to
// `app/[lang]` plus a proxy rewrite when a third locale arrives, or when the
// public site grows past roughly six pages — the duplication is cheaper than
// the rewrite only while there are few pages.

const base = siteUrl();

export const metadata: Metadata = base ? { metadataBase: base } : {};

export default function ChinesePublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PublicRoot locale="zh">
      <PublicChrome locale="zh">{children}</PublicChrome>
    </PublicRoot>
  );
}
