import type { Metadata } from "next";
import { dictionary } from "../../dictionaries";
import { SchedulePage } from "../../schedule/schedule-page";

// /zh/schedule — the same §10.1 page in Chinese. Same feed read, same
// classes, Chinese words and Chinese links.

const t = dictionary("zh");

export const metadata: Metadata = {
  title: t["schedule.title"],
  description: t["schedule.description"],
  // Each locale names itself canonical and points at the other, so a crawler
  // serves a Chinese searcher this page and does not read the pair as
  // duplicates (website-localisation).
  alternates: {
    canonical: "/zh/schedule",
    languages: { en: "/schedule", zh: "/zh/schedule" },
  },
};

export default function Page() {
  return <SchedulePage locale="zh" />;
}
