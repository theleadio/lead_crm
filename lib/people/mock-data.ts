import type { Language, LifecycleStage } from "./types.ts";

// ponytail: in-memory fake data until Shawn's schema + generated client land
// (spec §5, frozen 16 Oct). Swap service.ts to the real client; delete this file.
// Fake data only — spec §2: never production customer data outside production.
// Resets whenever the dev server restarts.

export type PersonRecord = {
  id: string;
  fullName: string;
  preferredName: string | null;
  email: string | null;
  emailNorm: string | null;
  phone: string | null;
  phoneE164: string | null;
  whatsappE164: string | null; // spec §5: defaults to phone_e164
  preferredLanguage: Language;
  jobTitle: string | null;
  notes: string | null;
  stage: LifecycleStage;
  owner: { id: string; fullName: string } | null;
  lastActivityAt: string | null;
  tags: string[];
  needsReview: boolean;
  needsReviewReason: string | null;
  companyName: string | null; // real version: company_membership join
  hasOpenDeal: boolean; // real version: computed from deal stage
  createdAt: string;
  updatedAt: string;
};

export const MOCK_OWNERS = [
  { id: "u-1", fullName: "Wei Ping" },
  { id: "u-2", fullName: "Daphne" },
  { id: "u-3", fullName: "Lee Yee" },
];

export const MOCK_TAGS = [
  "[source] meta",
  "[workshop] 25 Sep",
  "vip",
  "hrdc",
  "corporate",
  "follow-up",
];

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
const COMPANIES = ["Acme Sdn Bhd", "Maju Holdings", null, null];
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

function build(i: number): PersonRecord {
  const name = NAMES[i % NAMES.length];
  const suffix =
    i >= NAMES.length ? ` ${Math.floor(i / NAMES.length) + 1}` : "";
  const local = String(12_000_0000 + i * 7919).slice(0, 9);
  const daysAgo = [0, 2, 5, 12, 40, null][i % 6];
  const email = `${name.split(" ")[0].toLowerCase()}${i}@example.com`;
  const created = new Date(NOW - i * DAY).toISOString();
  return {
    id: `p-${String(i + 1).padStart(4, "0")}`,
    fullName: name + suffix,
    preferredName: null,
    email,
    emailNorm: email,
    phone: `0${local.slice(0, 2)}-${local.slice(2, 5)} ${local.slice(5)}`,
    phoneE164: `+60${local}`,
    whatsappE164: `+60${local}`,
    preferredLanguage: LANGS[i % LANGS.length],
    jobTitle: null,
    notes: null,
    stage: STAGES[i % STAGES.length],
    owner: i % 4 === 3 ? null : MOCK_OWNERS[i % MOCK_OWNERS.length],
    lastActivityAt:
      daysAgo === null ? null : new Date(NOW - daysAgo * DAY).toISOString(),
    tags: TAG_SETS[i % TAG_SETS.length],
    needsReview: i % 11 === 3,
    needsReviewReason:
      i % 11 === 3
        ? "Possible duplicate: same name and company as another person"
        : null,
    companyName: COMPANIES[i % COMPANIES.length],
    hasOpenDeal: i % 3 === 0,
    createdAt: created,
    updatedAt: created,
  };
}

export const MOCK_PEOPLE: PersonRecord[] = [
  ...Array.from({ length: 60 }, (_, i) => build(i)),
  // Spec §11.2: WhatsApp-only contact created by the WATI webhook, no name.
  {
    ...build(60),
    id: "p-0061",
    fullName: "",
    email: null,
    emailNorm: null,
    phone: "+60 17-888 1234",
    phoneE164: "+60178881234",
    whatsappE164: "+60178881234",
  },
  // Spec §4: phone that could not be normalised is kept and flagged.
  {
    ...build(61),
    id: "p-0062",
    fullName: "Unknown Format",
    phone: "12345",
    phoneE164: null,
    whatsappE164: null,
    needsReview: true,
    needsReviewReason: "Phone number could not be normalised",
  },
];
