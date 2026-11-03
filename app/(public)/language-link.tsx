"use client";

import { usePathname, useSearchParams } from "next/navigation";
import {
  LOCALE_LABEL,
  LOCALE_LANG,
  otherLocale,
  otherLocaleHref,
} from "./locale";
import type { Locale } from "./locale";

// The language control (§10.5). A plain link, so it works with no JavaScript,
// can be opened in a new tab, and is reachable by keyboard without anything
// extra (§14). It reads the current URL rather than being told it, because
// the chrome that renders it is a layout and a layout is given neither the
// pathname nor the query string.
//
// usePathname and useSearchParams both run while this is server-rendered, so
// the href is in the HTML. useSearchParams is what needs the Suspense
// boundary around this component in public-chrome.tsx.

export function LanguageLink({
  locale,
  label,
}: {
  locale: Locale;
  label: string;
}) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  return (
    <Anchor
      locale={locale}
      label={label}
      href={otherLocaleHref(locale, pathname, search)}
    />
  );
}

// The same link without the query string, for the Suspense fallback: the
// right page in the right language, only without the class or campaign the
// query carried. Degraded, never broken or absent.
//
// usePathname needs no Suspense boundary - only useSearchParams does - so the
// fallback reads the page it is actually on rather than being handed one. A
// hardcoded path here would send a no-JS visitor on any other public page to
// the wrong page in the other language.
export function LanguageLinkFallback({
  locale,
  label,
}: {
  locale: Locale;
  label: string;
}) {
  const pathname = usePathname();
  return (
    <Anchor
      locale={locale}
      label={label}
      href={otherLocaleHref(locale, pathname)}
    />
  );
}

function Anchor({
  locale,
  label,
  href,
}: {
  locale: Locale;
  label: string;
  href: string;
}) {
  const other = otherLocale(locale);
  return (
    // Not next/link: this is the other locale's own server-rendered page, and
    // a plain navigation is what guarantees that render rather than a client
    // cache entry for the locale we are leaving.
    //
    // §14: the visible word is the other language's name in its own script,
    // so it carries that language's `lang`; the off-screen prefix says what
    // the link does, and stays part of the accessible name rather than
    // replacing it. hrefLang tells a crawler what is on the other end.
    <a
      href={href}
      hrefLang={other}
      className="text-ink-muted hover:text-ink focus-visible:ring-focus-ring rounded-sm text-sm focus-visible:ring-2 focus-visible:outline-none"
    >
      <span className="sr-only">{label}: </span>
      <span lang={LOCALE_LANG[other]}>{LOCALE_LABEL[other]}</span>
    </a>
  );
}
