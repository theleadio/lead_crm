import { en } from "./dictionaries/en.ts";
import { zh } from "./dictionaries/zh.ts";
import type { Locale } from "./locale.ts";

// Where every word the public site renders as its own copy comes from
// (§10.1, §10.3, §13). English is the shape; Chinese is an overlay, so a key
// it has not translated yet — or has left empty — renders the English one
// rather than a blank or a key name.
//
// A plain module: no React, no `process.env`, nothing from lib/public/. The
// pages read it on the server and pass the whole active dictionary to their
// client components as a prop, so only one locale's strings ever reach the
// browser (§10.5 page weight) and no client module imports it.

// The keys are the English file's, exactly; the values are plain strings, so
// a translation is not forced to equal the English literal it replaces.
export type Dict = Record<keyof typeof en, string>;
export type DictKey = keyof Dict;

const OVERLAYS: Record<Locale, Partial<Dict>> = { en: {}, zh };

export function dictionary(locale: Locale): Dict {
  const overlay = OVERLAYS[locale];
  const out: Dict = { ...en };
  for (const [key, value] of Object.entries(overlay))
    // An empty string is "not translated yet", not "render nothing".
    if (value) out[key as DictKey] = value;
  return out;
}

// Fills {braces} in a dictionary string. One placeholder per value the
// sentence names, so a translation can put them in its own order instead of
// English's. An unknown placeholder is left as it is rather than blanked, so
// a typo shows up in review instead of silently eating a value.
export function fill(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values ? String(values[key]) : whole,
  );
}

// Which keys the Chinese dictionary has not translated yet. Read by
// tests/dictionary.test.ts, which prints them as the L5 review's checklist.
export function untranslatedKeys(locale: Locale): DictKey[] {
  const overlay = OVERLAYS[locale];
  return (Object.keys(en) as DictKey[]).filter((key) => !overlay[key]);
}
