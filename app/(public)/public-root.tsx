import { Geist_Mono, Inter } from "next/font/google";
import "../globals.css";
import { AttributionScript } from "./attribution-script";
import { LOCALE_LANG, type Locale } from "./locale";

// The public site's root shell (§10).
//
// Each locale's layout is a root layout of its own, which is the only way
// <html lang> can differ per language — §14 requires WCAG 2.1 AA, and 3.1.1
// (Language of Page, Level A) is met through the html element, not through a
// lang on something inside it. So the parts both roots share live here rather
// than being written twice, and each layout is left with its own lang and its
// own metadata.
//
// Next allows this: any layout with no layout above it is a root layout, and
// there is no app/layout.tsx any more — the CRM, the sign-in page and / sit
// under app/(app)/layout.tsx instead. Moving between a public page and the
// CRM is a full page load now, which it already was: nothing links across.
//
// This shell reads no session and imports nothing from lib/auth. A visitor
// must never be bounced to sign-in, and a marketing page must not depend on
// the sign-in provider being reachable; proxy.ts skips these paths for the
// same reason.

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Inter is loaded with subsets: ["latin"], so Chinese already falls back to a
// system font; this stack names which one rather than leaving it to the
// browser. A CJK webfont is hundreds of kilobytes at best, against §10.5's
// 1MB page budget, for a few dozen short strings.
//
// var(--font-inter) leads, so the Latin text on a Chinese page — a class
// code, a city, an English course name — is still set in Inter instead of
// whichever Latin glyphs the first CJK face happens to carry.
const CJK_STACK =
  'var(--font-inter), "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC", sans-serif';

export function PublicRoot({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  return (
    <html
      lang={LOCALE_LANG[locale]}
      // An inline font-family beats globals.css's `html { font-sans }`, which
      // is what makes the Chinese stack apply without a wrapper element.
      style={locale === "zh" ? { fontFamily: CJK_STACK } : undefined}
      className={`dark ${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="bg-surface text-ink flex min-h-full flex-col">
        {/* §10.2: the attribution cookies are written on every public page,
            so a visitor who lands on the schedule and enquires later still
            carries the campaign that found them. The script is locale-blind
            — the locale is not attribution (§10.2). */}
        <AttributionScript />
        {children}
      </body>
    </html>
  );
}
