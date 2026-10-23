// The two dictionaries behind the public site's copy (§10.1, §10.3). The
// shape is a compile-time fact — Chinese is `Partial<Dict>`, so a key it
// invents does not type-check — and these are the parts a compiler cannot
// see: an English string left empty, a Chinese key that no longer exists in
// English, and the fallback actually falling back.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dictionary,
  fill,
  untranslatedKeys,
} from "../app/(public)/dictionaries.ts";
import { en } from "../app/(public)/dictionaries/en.ts";
import { zh } from "../app/(public)/dictionaries/zh.ts";

test("every English string is present and non-empty", () => {
  const empty = Object.entries(en)
    .filter(([, v]) => typeof v !== "string" || v.trim() === "")
    .map(([k]) => k);
  assert.deepEqual(
    empty,
    [],
    `English is the fallback, so it may not be blank:\n  ${empty.join("\n  ")}`,
  );
});

test("the Chinese dictionary invents no key", () => {
  // A typo in the Chinese file is a key English never had. The overlay would
  // ignore it in silence and the page would show English for the key that
  // was meant.
  const unknown = Object.keys(zh).filter((k) => !(k in en));
  assert.deepEqual(
    unknown,
    [],
    `not keys of the English dictionary — a typo, or a key since renamed:\n  ${unknown.join("\n  ")}`,
  );
});

test("an untranslated or empty key renders English", () => {
  const dict = dictionary("zh");
  // "LEAD" is a brand, not copy, so nothing in the dictionary needs to be
  // identical across locales — but the fallback must be exercised with a key
  // that is genuinely absent.
  const absent = untranslatedKeys("zh");
  for (const key of absent) assert.equal(dict[key], en[key]);
  // And the translated ones are Chinese, not English.
  assert.equal(dict["schedule.heading"], zh["schedule.heading"]);
  assert.notEqual(dict["schedule.heading"], en["schedule.heading"]);
});

test("English asks for no overlay", () => {
  assert.deepEqual(dictionary("en"), { ...en });
  assert.deepEqual(untranslatedKeys("en"), Object.keys(en));
});

test("the consent line names the same two channels in both locales", () => {
  // §10.3's permission. A translation may not narrow or widen what the
  // visitor agrees to, and the two channels are the part a paraphrase loses.
  const line = dictionary("zh")["form.consent"];
  assert.match(line, /WhatsApp/);
  assert.match(line, /电子邮件|邮箱/);
  assert.match(line, /LEAD/);
  assert.notEqual(line, en["form.consent"]);
});

test("fill puts values in the template's own order", () => {
  assert.equal(
    fill("starts {date}", { date: "22 Sep 2026" }),
    "starts 22 Sep 2026",
  );
  assert.equal(
    fill("{code} · {date} 开课 · {city}", {
      code: "AIA-2611-KL",
      date: "22 Sep 2026",
      city: "Kuala Lumpur",
    }),
    "AIA-2611-KL · 22 Sep 2026 开课 · Kuala Lumpur",
  );
  // An unfilled placeholder stays visible rather than eating the sentence.
  assert.equal(fill("starts {date}", {}), "starts {date}");
});

test("report what the L5 review still has to translate", () => {
  const absent = untranslatedKeys("zh");
  if (absent.length > 0)
    console.log(
      `${absent.length} key(s) still untranslated (rendering English):\n  ${absent.join("\n  ")}`,
    );
  // Not an assertion: an untranslated key degrades to English rather than
  // blocking a deploy (design D8). This prints the checklist.
  assert.ok(absent.length <= Object.keys(en).length);
});
