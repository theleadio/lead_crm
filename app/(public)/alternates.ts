import { localePath, type Locale } from "./locale.ts";

// The canonical and hreflang block every public page declares (§10.5).
//
// One function rather than the same object literal in eight route files: each
// locale must name itself canonical and point at the other, or a crawler
// reads the pair as duplicates and picks one. Written out per page, a missing
// or crossed entry was a thing only a regex over the source could catch —
// here it is a value a test can read.
//
// `x-default` is the page a searcher gets when none of the languages matches
// theirs, and it is the English path: English is the unprefixed, canonical
// path (§10.5) and the one a visitor with no Chinese can read.
//
// A plain module with no React and no server imports, so the route files, the
// pages and the tests can all share it.
export function alternates(
  locale: Locale,
  path: string,
): {
  canonical: string;
  languages: Record<string, string>;
} {
  return {
    canonical: localePath(locale, path),
    languages: {
      "x-default": path,
      en: path,
      zh: localePath("zh", path),
    },
  };
}
