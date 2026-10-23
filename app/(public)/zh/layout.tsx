import { PublicChrome } from "../public-chrome";
import { LOCALE_LANG } from "../locale";

// The Chinese public pages, served under /zh (§10.5).
//
// shortcut: each public page needs a thin route file here as well as under
// (en)/, because English keeps the unprefixed path and a single `app/[lang]`
// segment cannot serve a locale with no prefix. Upgrade to `app/[lang]` plus
// a proxy rewrite when a third locale arrives, or when the public site grows
// past roughly six pages — the duplication is cheaper than the rewrite only
// while there are few pages.
//
// shortcut: <html lang> stays "en" on these pages, so Chrome's translate
// prompt and any crawler reading it see English on a Chinese page while the
// same page's hreflang says zh. A screen reader resolves language from the
// nearest ancestor, so the div below is enough for §14 and only the
// top-level signal is wrong. Upgrade when the app moves under a dynamic
// locale segment for some other reason - doing it for this alone would
// restructure every CRM route too.
//
// Inter is loaded with subsets: ["latin"] (app/layout.tsx), so Chinese
// already falls back to a system font; the stack names which one rather than
// leaving it to the browser. A CJK webfont is hundreds of kilobytes at best,
// against §10.5's 1MB page budget, for a few dozen short strings.
const CJK_STACK =
  '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC", sans-serif';

export default function ChinesePublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div lang={LOCALE_LANG.zh} style={{ fontFamily: CJK_STACK }}>
      <PublicChrome locale="zh">{children}</PublicChrome>
    </div>
  );
}
