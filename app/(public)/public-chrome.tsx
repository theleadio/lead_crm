import Link from "next/link";
import { Suspense } from "react";
import { dictionary } from "./dictionaries";
import { enquiryUrl } from "./enquiry-link";
import { LanguageLink, LanguageLinkFallback } from "./language-link";
import { localePath, type Locale } from "./locale";

// The public site's header, once, for both locales (§10.1, §10.5). Its words
// come from the active locale's dictionary and every link it emits is built
// through localePath, so a visitor reading Chinese stays on the Chinese site.
//
// The language control lives here and nowhere else: the schedule page has a
// *language filter* over the classes it lists, which is a different thing,
// and the two are kept apart so a visitor cannot mistake one for the other.

export function PublicChrome({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  const t = dictionary(locale);
  return (
    <>
      <header className="border-line border-b">
        <nav className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          {/* A brand name, not copy: the same in both locales. */}
          <Link
            href={localePath(locale, "/schedule")}
            className="text-ink text-base font-semibold"
          >
            LEAD
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <Link
              href={localePath(locale, "/schedule")}
              className="text-ink-muted hover:text-ink"
            >
              {t["chrome.schedule"]}
            </Link>
            <Link
              href={enquiryUrl(locale)}
              className="text-ink-muted hover:text-ink"
            >
              {t["chrome.enquiry"]}
            </Link>
            {/* The control reads the query string, which opts its subtree
                into a client render; the boundary keeps that off the rest of
                the page. The fallback is the same link without the query. */}
            <Suspense
              fallback={
                <LanguageLinkFallback
                  locale={locale}
                  label={t["chrome.language"]}
                />
              }
            >
              <LanguageLink locale={locale} label={t["chrome.language"]} />
            </Suspense>
          </div>
        </nav>
      </header>
      {children}
    </>
  );
}
