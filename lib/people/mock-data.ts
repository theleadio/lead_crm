import type { Language, LifecycleStage, PersonListItem } from "./types.ts";

// ponytail: in-memory fake data until Shawn's schema + generated client land
// (spec §5, frozen 16 Oct). Swap service.ts to the real client; delete this file.
// Fake data only — spec §2: never production customer data outside production.

const NAMES = [
  "Tan Mei Ling",
  "Ali bin Hassan",
  "Lim Wei Jie",
  "Nur Aisyah binti Ahmad",
  "Wong Kar Wai",
  "Siti Nurhaliza",
  "Chong Wei Ming",
  "Rajesh Kumar",
  "Lee Hui Min",
  "Muhammad Faiz",
  "Ng Pei Shan",
  "Kavitha Raman",
  "Ooi Chee Keong",
  "Farah Nabila",
  "Goh Siew Ling",
  "Arjun Pillai",
];
const OWNERS = [
  { id: "u-1", fullName: "Wei Ping" },
  { id: "u-2", fullName: "Daphne" },
  null,
];
const TAG_SETS = [
  [],
  ["[source] meta"],
  ["[workshop] 25 Sep", "vip"],
  ["[source] meta", "hrdc", "corporate", "follow-up"],
];
const STAGES: LifecycleStage[] = ["lead", "lead", "student", "customer"];
const LANGS: Language[] = ["en", "en", "zh"];

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-09-23T04:00:00Z");

function build(i: number): PersonListItem {
  const name = NAMES[i % NAMES.length];
  const suffix =
    i >= NAMES.length ? ` ${Math.floor(i / NAMES.length) + 1}` : "";
  const local = String(12_000_0000 + i * 7919).slice(0, 9);
  const daysAgo = [0, 2, 5, 12, 40, null][i % 6];
  return {
    id: `p-${String(i + 1).padStart(4, "0")}`,
    fullName: name + suffix,
    preferredName: null,
    email: `${name.split(" ")[0].toLowerCase()}${i}@example.com`,
    phone: `0${local.slice(0, 2)}-${local.slice(2, 5)} ${local.slice(5)}`,
    phoneE164: `+60${local}`,
    preferredLanguage: LANGS[i % LANGS.length],
    stage: STAGES[i % STAGES.length],
    owner: OWNERS[i % OWNERS.length],
    lastActivityAt:
      daysAgo === null ? null : new Date(NOW - daysAgo * DAY).toISOString(),
    tags: TAG_SETS[i % TAG_SETS.length],
    needsReview: i % 11 === 3,
    needsReviewReason:
      i % 11 === 3
        ? "Possible duplicate of another person with the same name and company"
        : null,
    createdAt: new Date(NOW - i * DAY).toISOString(),
  };
}

export const MOCK_PEOPLE: PersonListItem[] = [
  ...Array.from({ length: 60 }, (_, i) => build(i)),
  // Spec §11.2: WhatsApp-only contact created by the WATI webhook, no name.
  {
    ...build(60),
    id: "p-0061",
    fullName: "",
    email: null,
    phone: "+60 17-888 1234",
    phoneE164: "+60178881234",
  },
  // Spec §4: phone that could not be normalised is kept and flagged.
  {
    ...build(61),
    id: "p-0062",
    fullName: "Unknown Format",
    phone: "12345",
    phoneE164: null,
    needsReview: true,
    needsReviewReason: "Phone number could not be normalised",
  },
];
