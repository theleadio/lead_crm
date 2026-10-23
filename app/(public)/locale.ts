// The public site's two locales (§10.5, §1183) and the URL arithmetic that
// keeps them apart. English is served at the plain path and Chinese under a
// /zh prefix, so every URL that worked before the Chinese site existed still
// works and still serves English.
//
// A plain module with no React and no server imports: the chrome, the pages,
// the enquiry links and the tests all share it, and the language control is a
// client component.

export type Locale = "en" | "zh";

export const LOCALES: readonly Locale[] = ["en", "zh"];

// Each language named in its own script, which is what the language control
// shows (§14: a visitor picks the language they read, not the one they left).
export const LOCALE_LABEL: Record<Locale, string> = {
  en: "English",
  zh: "中文",
};

// The `lang` attribute for each locale's subtree. zh-Hans rather than zh:
// LEAD teaches in Simplified Chinese, and a screen reader picks its voice
// from the script.
export const LOCALE_LANG: Record<Locale, string> = {
  en: "en",
  zh: "zh-Hans",
};

export function otherLocale(locale: Locale): Locale {
  return locale === "en" ? "zh" : "en";
}

export function isLocale(value: string): value is Locale {
  return value === "en" || value === "zh";
}

// A locale's path for a page. `path` is the English path, which is also the
// canonical one: localePath("zh", "/schedule") is "/zh/schedule".
// Only "zh" is tested for, never "not en": a value that reaches this from
// somewhere the type does not guard — an `any`, a config read, a third locale
// added without revisiting here — then falls back to the English path instead
// of silently routing a visitor into the Chinese tree.
export function localePath(locale: Locale, path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  if (locale !== "zh") return clean;
  return clean === "/" ? "/zh" : `/zh${clean}`;
}

// The English path behind a locale's pathname. Given the locale rather than
// sniffed from the prefix, so a path that does not carry the prefix it should
// is left alone instead of being silently re-rooted.
export function stripLocale(locale: Locale, pathname: string): string {
  if (locale !== "zh") return pathname;
  if (pathname === "/zh") return "/";
  return pathname.startsWith("/zh/") ? pathname.slice(3) : pathname;
}

// Where the language control points: the same page in the other language,
// with the query string kept whole so a visitor who arrived about a class, or
// from a campaign, is still about that class and still carries the campaign
// (§10.2).
export function otherLocaleHref(
  locale: Locale,
  pathname: string,
  search = "",
): string {
  const query =
    !search || search === "?"
      ? ""
      : search.startsWith("?")
        ? search
        : `?${search}`;
  return localePath(otherLocale(locale), stripLocale(locale, pathname)) + query;
}
